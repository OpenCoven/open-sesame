import Foundation
import CryptoKit
import SQLite3

struct WorkspaceFailure: Error {
    let code: String
    let message: String
    let committed: Bool?
    init(_ code: String, _ message: String, committed: Bool? = false) { self.code = code; self.message = message; self.committed = committed }
}

// Same serialized generations as the renderer. No item, timer, credential or identity model lives here.
final class WorkspaceStore: @unchecked Sendable {
    static let maximumBytes = 16 * 1024 * 1024
    private var db: OpaquePointer?
    private let lock = NSLock()
    private let allowed: Set<String>
    let url: URL
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    init(url: URL, allowed: Set<String>) throws {
        self.url = url; self.allowed = allowed
        let folder = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: folder.path)
        #endif
        var backupFolder = folder; var policy = URLResourceValues(); policy.isExcludedFromBackup = false
        try backupFolder.setResourceValues(policy)
        guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            if let db { sqlite3_close(db) }; db = nil
            throw WorkspaceFailure("unavailable", "Workspace database could not be opened. Originals remain on disk.")
        }
        do {
            sqlite3_busy_timeout(db, 1500)
            let version = try scalar("PRAGMA user_version")
            guard version == "0" || version == "1" else { throw WorkspaceFailure("version", "Unknown workspace database version. Original retained.") }
            if version == "0" {
                guard try scalar("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")=="0" else{throw WorkspaceFailure("version","Unrecognized workspace schema; original database retained.")}
            }else{
                guard try scalar("SELECT count(*) FROM pragma_table_info('workspace')")=="2",try scalar("SELECT count(*) FROM pragma_table_info('workspace') WHERE name='slot' AND type='TEXT' AND pk=1")=="1",try scalar("SELECT count(*) FROM pragma_table_info('workspace') WHERE name='value' AND type='BLOB'")=="1" else{throw WorkspaceFailure("corrupt","Workspace schema requires recovery; original database retained.")}
            }
            try execute("PRAGMA journal_mode=WAL")
            try execute("PRAGMA synchronous=FULL")
            guard try scalar("PRAGMA journal_mode") == "wal", try scalar("PRAGMA synchronous") == "2" else { throw WorkspaceFailure("unavailable", "Required workspace durability is unavailable.") }
            if version == "0" {
                try execute("BEGIN IMMEDIATE")
                do{try execute("CREATE TABLE workspace(slot TEXT PRIMARY KEY CHECK(slot IN ('current','previous','recovery')), value BLOB NOT NULL)");try execute("PRAGMA user_version=1");try execute("COMMIT")}catch{try? execute("ROLLBACK");throw error}
            }
            #if os(iOS)
            for suffix in ["", "-wal", "-shm"] where FileManager.default.fileExists(atPath: url.path + suffix) {
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path + suffix)
            }
            #endif
        } catch { sqlite3_close(db); db = nil; throw error }
    }
    deinit { sqlite3_close(db) }
    private func execute(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw WorkspaceFailure(sqlite3_errcode(db) == SQLITE_FULL ? "quota" : "unavailable", "Workspace operation failed. Keep open drafts and retry after recovery.") }
    }
    private func scalar(_ sql: String) throws -> String {
        var statement: OpaquePointer?; defer { sqlite3_finalize(statement) }
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, sqlite3_step(statement) == SQLITE_ROW, let text = sqlite3_column_text(statement, 0) else { throw WorkspaceFailure("unavailable", "Workspace metadata could not be read.") }
        return String(cString: text)
    }
    static func json(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes, .fragmentsAllowed]) }
    static func digest(_ values: [String: String]) throws -> String { SHA256.hash(data: try json(values)).map { String(format: "%02x", $0) }.joined() }
    private func record(_ slot: String) throws -> [String: Any]? {
        var statement: OpaquePointer?; defer { sqlite3_finalize(statement) }
        guard sqlite3_prepare_v2(db, "SELECT value FROM workspace WHERE slot=?", -1, &statement, nil) == SQLITE_OK else { throw WorkspaceFailure("unavailable", "Could not read saved workspace.") }
        sqlite3_bind_text(statement, 1, slot, -1, transient)
        let result = sqlite3_step(statement); if result == SQLITE_DONE { return nil }
        guard result == SQLITE_ROW, sqlite3_column_bytes(statement, 0) <= Self.maximumBytes, let blob = sqlite3_column_blob(statement, 0) else { throw WorkspaceFailure("corrupt", "Saved workspace requires recovery; original retained.") }
        let data = Data(bytes: blob, count: Int(sqlite3_column_bytes(statement, 0)))
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw WorkspaceFailure("corrupt", "Saved generation is unreadable; original retained.") }; return value
    }
    func read() throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }; try execute("BEGIN")
        do { let result: [String: Any] = ["current": try record("current") ?? NSNull(), "previous": try record("previous") ?? NSNull(), "recovery": try record("recovery") ?? NSNull()]; try execute("COMMIT"); return result }
        catch { try? execute("ROLLBACK"); throw error }
    }
    private func put(_ slot: String, _ value: [String: Any]) throws {
        let bytes = try Self.json(value); guard bytes.count <= Self.maximumBytes else { throw WorkspaceFailure("quota", "Workspace exceeds its size limit.") }
        var statement: OpaquePointer?; defer { sqlite3_finalize(statement) }
        guard sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO workspace(slot,value) VALUES(?,?)", -1, &statement, nil) == SQLITE_OK else { throw WorkspaceFailure("unavailable", "Workspace transaction could not be prepared.") }
        sqlite3_bind_text(statement, 1, slot, -1, transient)
        _ = bytes.withUnsafeBytes { sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32(bytes.count), transient) }
        guard sqlite3_step(statement) == SQLITE_DONE else { throw WorkspaceFailure(sqlite3_errcode(db) == SQLITE_FULL ? "quota" : "unavailable", "Workspace transaction aborted; original retained.") }
    }
    private func integer(_ value: Any?) -> Int64? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite, n.doubleValue.rounded() == n.doubleValue, n.doubleValue >= 0, n.doubleValue < 9_007_199_254_740_991 else { return nil }; return n.int64Value
    }
    private func validate(_ next: [String: Any]) throws {
        guard Set(next.keys) == Set(["schemaVersion","revision","mutationId","digest","values"]), integer(next["schemaVersion"]) == 1,
              let revision = integer(next["revision"]), revision > 0, let mutation = next["mutationId"] as? String, !mutation.isEmpty, mutation.utf8.count <= 128,
              let values = next["values"] as? [String: String], Set(values.keys).isSubset(of: allowed), let digest = next["digest"] as? String,
              try Self.digest(values) == digest, try Self.json(next).count <= Self.maximumBytes else { throw WorkspaceFailure("invalid", "Invalid workspace generation; original preserved.") }
    }
    func commit(expected: Int64, next: [String: Any], options: [String: Any]) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }; try validate(next)
        guard expected >= 0, expected < 9_007_199_254_740_990, integer(next["revision"]) == expected + 1,
              Set(options.keys).isSubset(of: ["expectedDigest","expectedValues","preserveRecovery"]), options["preserveRecovery"] == nil || ((options["preserveRecovery"] as? NSNumber).map{CFGetTypeID($0)==CFBooleanGetTypeID()} ?? false) else { throw WorkspaceFailure("invalid", "Invalid workspace commit request.") }
        if expected > 0 {
            guard options["expectedValues"] != nil, options["expectedDigest"] is String || options["preserveRecovery"] as? Bool == true else { throw WorkspaceFailure("invalid", "A revision and expected content are required before replacing saved data.") }
        }
        try execute("BEGIN IMMEDIATE")
        do {
            let before = try record("current")
            guard (before == nil ? 0 : integer(before?["revision"])) == expected else { throw WorkspaceFailure("conflict", "Another scene changed the workspace. Preserve drafts and reconcile.") }
            if let digest = options["expectedDigest"] as? String, before?["digest"] as? String != digest { throw WorkspaceFailure("corrupt", "Stored workspace content changed; recover before saving.") }
            if let values = options["expectedValues"] {
                guard let stored = before?["values"], try Self.json(stored) == Self.json(values) else { throw WorkspaceFailure("corrupt", "Stored workspace values changed; original retained.") }
            }
            if let before { try put(options["preserveRecovery"] as? Bool == true ? "recovery" : "previous", before) }
            try put("current", next)
            do { try execute("COMMIT") } catch { try? execute("ROLLBACK"); throw WorkspaceFailure("uncertain", "Workspace commit acknowledgment is uncertain. Reconcile before saving.", committed: nil) }
            return next
        } catch { try? execute("ROLLBACK"); throw error }
    }
}
