import Foundation
import Network
import Security

// All mutable session state is confined to the main queue; Network I/O is asynchronous.
final class VNCTransport {
    struct Stream { let connection: NWConnection; let token: String; var outstanding = 0; var queued = 0 }
    var streams: [String: Stream] = [:]
    var emit: ([String: Any]) -> Void = { _ in }
    func close(_ id: String) {
        guard let stream = streams.removeValue(forKey: id) else { return }
        stream.connection.cancel()
        emit(["event":"vnc.close", "id":id, "token":stream.token])
    }
    func closeAll() { for id in Array(streams.keys) { close(id) } }
    func read(_ id: String, _ token: String) {
        guard let stream = streams[id], stream.token == token, stream.outstanding < 1048576 else { return }
        stream.connection.receive(minimumIncompleteLength: 1, maximumLength: min(65536, 1048576-stream.outstanding)) { [weak self] data, _, complete, error in
            guard let self, var current = self.streams[id], current.token == token else { return }
            if let data, !data.isEmpty {
                current.outstanding += data.count; self.streams[id] = current
                self.emit(["event":"vnc.data", "id":id, "token":token, "data":data.base64EncodedString()])
            }
            if complete || error != nil { self.close(id) }
            else { self.read(id, token) }
        }
    }
    func call(_ method: String, _ p: [String: Any]) throws -> Any {
        guard let id = p["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{1,80}$", options: .regularExpression) != nil else { throw failure() }
        if method.hasPrefix("vnc.credential.") {
            guard let endpoint = p["endpoint"] as? String, endpoint.count < 2048 else { throw failure() }
            let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:"com.perch.widgetstudio.vnc", kSecAttrAccount as String:id+"|"+endpoint]
            if method == "vnc.credential.delete" { let status = SecItemDelete(query as CFDictionary); guard status == errSecSuccess || status == errSecItemNotFound else { throw failure() }; return true }
            if method == "vnc.credential.save" {
                guard let value = p["value"] as? String, value.utf8.count <= 8192 else { throw failure() }
                let bytes = Data(value.utf8)
                let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String:bytes] as CFDictionary)
                if status == errSecItemNotFound { var insert = query; insert[kSecValueData as String] = bytes; insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly; guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw failure() } }
                else if status != errSecSuccess { throw failure() }
                return true
            }
            guard method == "vnc.credential.read" else { throw failure() }
            var read = query; read[kSecReturnData as String] = true; read[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?; let status = SecItemCopyMatching(read as CFDictionary, &result)
            if status == errSecItemNotFound { return "" }
            guard status == errSecSuccess, let bytes = result as? Data else { throw failure() }
            return String(data:bytes, encoding:.utf8) ?? ""
        }
        if method == "vnc.open" {
            guard let host = p["host"] as? String, !host.isEmpty, host.count <= 253, host.rangeOfCharacter(from: .whitespacesAndNewlines) == nil, !host.contains("/"), let port = p["port"] as? Int, port > 0, port <= 65535, streams.count < 4, streams[id] == nil else { throw failure() }
            let token = UUID().uuidString, connection = NWConnection(host:NWEndpoint.Host(host), port:NWEndpoint.Port(rawValue:UInt16(port))!, using:.tcp)
            streams[id] = Stream(connection:connection, token:token)
            connection.stateUpdateHandler = { [weak self] state in
                guard let self, self.streams[id]?.token == token else { return }
                switch state {
                case .ready: self.emit(["event":"vnc.open", "id":id, "token":token]); self.read(id, token)
                case .failed: self.emit(["event":"vnc.error", "id":id, "token":token]); self.close(id)
                default: break
                }
            }
            connection.start(queue:.main)
            DispatchQueue.main.asyncAfter(deadline:.now()+15) { [weak self] in
                guard let self, self.streams[id]?.token == token, connection.state != .ready else { return }; self.close(id)
            }
            return ["token":token]
        }
        guard var stream = streams[id], p["token"] as? String == stream.token else { throw failure() }
        if method == "vnc.close" { close(id); return true }
        if method == "vnc.ack" {
            guard let count = p["bytes"] as? Int, count > 0, count <= stream.outstanding else { throw failure() }
            let paused = stream.outstanding >= 1048576; stream.outstanding -= count; streams[id] = stream
            if paused { read(id, stream.token) }; return true
        }
        guard method == "vnc.write", let encoded = p["data"] as? String, encoded.count <= 87384, let bytes = Data(base64Encoded:encoded), bytes.count <= 65536 else { throw failure() }
        guard stream.queued + bytes.count <= 1048576 else { close(id); throw failure() }
        stream.queued += bytes.count; streams[id] = stream
        let token = stream.token
        stream.connection.send(content:bytes, completion:.contentProcessed { [weak self] error in
            guard let self, var current = self.streams[id], current.token == token else { return }
            current.queued -= bytes.count; self.streams[id] = current
            if error != nil { self.close(id) }
        }); return true
    }
    func failure() -> NSError { NSError(domain:"VNC", code:1, userInfo:[NSLocalizedDescriptionKey:"Could not complete the desktop operation. Check the connection or unlock Keychain."]) }
}
