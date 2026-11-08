import AppKit

/// Native confirmations hold no reusable permission. The opaque proposal stays
/// on the private stdio channel and the host consumes it exactly once.
final class OpenSesameFamiliarPermissions {
    typealias Call = (String, [String: Any], @escaping ([String: Any]) -> Void) -> Void
    var call: Call!
    var window: NSWindow!
    var authenticated: () -> Bool = { false }
    private var active: UUID?
    private var alert: NSAlert?
    private var cancelAction: (() -> Void)?

    func cancel() { cancelAction?() }

    func request(operation: String, input: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        guard active == nil, authenticated(), window.attachedSheet == nil else {
            completion(["error": "Finish or cancel the current permission request first."]); return
        }
        let ticket = UUID(); active = ticket
        var settled = false
        var proposal: String?
        func finish(_ approved: Bool) {
            guard !settled, self.active == ticket else { return }
            settled = true; self.active = nil; self.cancelAction = nil
            if let sheet = self.alert?.window, self.window.attachedSheet === sheet { self.window.endSheet(sheet, returnCode: .cancel) }
            self.alert = nil
            guard let token = proposal else { completion(["error": "Permission cancelled. Your message is kept."]); return }
            self.call("native.coven.finish", ["token": token, "approved": approved && self.authenticated()], completion)
        }
        cancelAction = { finish(false) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { if self.active == ticket { finish(false) } }
        call("native.coven.prepare", ["operation": operation, "input": input]) { response in
            guard let value = response["result"] as? [String: Any], let token = value["token"] as? String,
                  let name = value["familiar"] as? String, let workspace = value["workspace"] as? String,
                  value["operation"] as? String == operation else {
                if self.active == ticket { self.active = nil; self.cancelAction = nil; completion(response["error"] == nil ? ["error": "Could not verify the permission request."] : response) }
                return
            }
            guard self.active == ticket, !settled, self.authenticated() else {
                self.call("native.coven.finish", ["token": token, "approved": false]) { _ in }; return
            }
            proposal = token
            let alert = NSAlert(); self.alert = alert; alert.alertStyle = .warning
            alert.messageText = operation == "send" ? "Allow full access for this reply?" : "Replace \(name)’s avatar?"
            if operation == "send" {
                let harness = value["harness"] as? String ?? "Coven"
                let prompt = value["message"] as? String ?? ""
                alert.informativeText = "\(name) · \(harness)\nStarting folder: \(workspace)\n\nFull access can edit or delete files, run commands and use the network beyond this folder, without further engine permission prompts. Approval applies only to this message. The next reply returns to read-only. Stop cannot undo changes already made.\n\nMessage begins: \(prompt)"
            } else {
                alert.informativeText = "\(name)\nWorkspace: \(workspace)\n\nReplace avatars/\(input["familiarId"] as? String ?? "familiar").png with the image you selected. This changes the shared workspace avatar; it does not grant the familiar file or command access."
            }
            alert.addButton(withTitle: "Cancel"); alert.addButton(withTitle: operation == "send" ? "Allow this reply" : "Replace avatar")
            alert.buttons[0].keyEquivalent = "\r"; alert.buttons[1].keyEquivalent = ""
            NSApp.activate(ignoringOtherApps: true)
            alert.beginSheetModal(for: self.window) { result in finish(result == .alertSecondButtonReturn) }
        }
    }
}
