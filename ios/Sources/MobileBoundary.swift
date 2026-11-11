import Foundation

// Receiving policy takes native observations, never renderer-supplied identity/platform claims.
enum MobileBoundary {
    struct Context {
        let ownerMatches: Bool
        let mainFrame: Bool
        let document: URL?
        let entry: URL?
        let active: Bool
        let authenticated: Bool
        var documentID:String = "unconfigured"
    }
    // A compare-and-swap request carries both the next generation and the previous values.
    private static let maximumRequestBytes = 2 * WorkspaceStore.maximumBytes + 8192

    static func request(_ raw: Any, context: Context) throws -> (String,[String:Any]) {
        guard context.ownerMatches,context.mainFrame,context.active,context.authenticated,
              let url=context.document,let entry=context.entry,url.isFileURL,entry.isFileURL,url.standardizedFileURL==entry.standardizedFileURL,
              let body=raw as? [String:Any],Set(body.keys)==Set(["documentID","method","params"]),body["documentID"] as? String == context.documentID,let method=body["method"] as? String,let params=body["params"] as? [String:Any],
              JSONSerialization.isValidJSONObject(body),let bytes=try? JSONSerialization.data(withJSONObject:body),bytes.count<=maximumRequestBytes else {throw WorkspaceFailure("denied","Untrusted or inactive workspace request.")}
        guard ["workspace.read","workspace.commit"].contains(method) else{throw WorkspaceFailure("unsupported","This operation is unavailable on the local mobile host.")}
        if method=="workspace.read",!params.isEmpty{throw WorkspaceFailure("invalid","Unexpected workspace read parameters.")}
        return(method,params)
    }
}
