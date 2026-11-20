import Foundation

enum MobileFiles {
    static func saved(_ state:[String:Any],allowed:Set<String>) throws -> Data {
        guard let current=state["current"] as? [String:Any],current["schemaVersion"] as? Int==1,
              let values=current["values"] as? [String:String],Set(values.keys).isSubset(of:allowed),try WorkspaceStore.digest(values)==current["digest"] as? String else{throw WorkspaceFailure("corrupt","Recover the saved generation before exporting.")}
        return try WorkspaceStore.json(["format":"open-sesame-workspace","schemaVersion":1,"values":values])
    }
    static func recoveryReport(_ state:[String:Any],allowed:Set<String>) throws -> Data {
        func describe(_ raw:Any?) -> Any {
            guard let record=raw as? [String:Any] else{return NSNull()}
            let values=record["values"] as? [String:Any] ?? [:]
            var result:[String:Any]=["sections":values.keys.filter(allowed.contains).sorted().map{key -> [String:Any] in ["key":key,"bytes":(values[key] as? String)?.utf8.count ?? -1]}]
            for key in ["schemaVersion","revision"] { if let n=record[key] as? NSNumber,CFGetTypeID(n) != CFBooleanGetTypeID(),n.doubleValue.isFinite {result[key]=n} }
            return result
        }
        return try WorkspaceStore.json(["format":"open-sesame-workspace-recovery-report","contentIncluded":false,"originalPreservedInStorage":true,"current":describe(state["current"]),"previous":describe(state["previous"]),"recovery":describe(state["recovery"])])
    }
    static func readImport(_ url:URL) throws -> Data {
        let handle=try FileHandle(forReadingFrom:url);defer{try? handle.close()};var result=Data()
        while let chunk=try handle.read(upToCount:65536),!chunk.isEmpty {
            guard result.count+chunk.count<=WorkspaceStore.maximumBytes else{throw WorkspaceFailure("invalid","Import exceeds the workspace file limit.")};result.append(chunk)
        }
        return result
    }
    static func temporary(_ data:Data) throws -> URL {
        guard data.count<=WorkspaceStore.maximumBytes else{throw WorkspaceFailure("invalid","Export exceeds the workspace file limit.")}
        let url=FileManager.default.temporaryDirectory.appendingPathComponent("open-sesame-"+UUID().uuidString+".json")
        #if os(iOS)
        try data.write(to:url,options:[.atomic,.completeFileProtection])
        #else
        try data.write(to:url,options:.atomic)
        #endif
        return url
    }
}
