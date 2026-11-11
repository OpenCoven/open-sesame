import Foundation
import SQLite3

@main struct WorkspaceStoreTests {
    static func require(_ condition: @autoclosure () throws -> Bool, _ message: String) throws { if try !condition() { throw NSError(domain: message, code: 1) } }
    static func generation(_ revision: Int, _ values: [String: String]) throws -> [String: Any] { ["schemaVersion":1,"revision":revision,"mutationId":UUID().uuidString,"values":values,"digest":try WorkspaceStore.digest(values)] }
    static func main() throws {
        let anchor=Date(timeIntervalSince1970:10000)
        try require(MobileSessionClock.valid(attestedAt:anchor,ticks:100,deadline:160,wall:anchor.addingTimeInterval(20),continuous:120),"same-boot unexpired attestation remains usable")
        try require(!MobileSessionClock.valid(attestedAt:anchor,ticks:100,deadline:160,wall:anchor.addingTimeInterval(-20),continuous:120),"clock rollback requires verification")
        try require(!MobileSessionClock.valid(attestedAt:anchor,ticks:100,deadline:160,wall:anchor.addingTimeInterval(61),continuous:161),"elapsed continuous deadline cannot be extended")
        try require(!MobileSessionClock.valid(attestedAt:anchor,ticks:100,deadline:160,wall:anchor.addingTimeInterval(5),continuous:5),"unverifiable reboot anchor cannot unlock offline")
        print("PASS native account clock: unexpired continuous anchor, rollback, expiry and unverifiable reboot rejection")
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("sesame-native-store-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true); defer { try? FileManager.default.removeItem(at: folder) }
        let url = folder.appendingPathComponent("workspace.sqlite"), key = "open-sesame-items-v1", keys: Set<String> = [key]
        let first = try generation(1, [key:"[]"]), second = try generation(2,[key:"[{\"id\":\"same-id\",\"text\":\"Café 🪷\\n第二行\"}]"])
        let a = try WorkspaceStore(url:url, allowed:keys), b = try WorkspaceStore(url:url, allowed:keys)
        _ = try a.commit(expected:0,next:first,options:[:]); _ = try b.commit(expected:1,next:second,options:["expectedDigest":first["digest"]!,"expectedValues":first["values"]!])
        do { _ = try a.commit(expected:1,next:second,options:["expectedDigest":first["digest"]!,"expectedValues":first["values"]!]); throw NSError(domain:"stale writer accepted",code:1) } catch let error as WorkspaceFailure { try require(error.code == "conflict", "stale scene must conflict") }
        let reopened = try WorkspaceStore(url:url,allowed:keys), state = try reopened.read();try require(try WorkspaceStore.json(state["current"]!) == WorkspaceStore.json(second),"committed Unicode survives reopen");try require(try WorkspaceStore.json(state["previous"]!) == WorkspaceStore.json(first),"predecessor retained")
        var bad = second;bad["digest"] = String(repeating:"0",count:64);bad["revision"] = 3
        do { _ = try a.commit(expected:2,next:bad,options:[:]);throw NSError(domain:"bad digest accepted",code:1) }catch let error as WorkspaceFailure{try require(error.code == "invalid","bad checksum must reject")}
        let third = try generation(3,[key:"[]"]);do { _ = try a.commit(expected:2,next:third,options:["expectedDigest":second["digest"]!,"expectedValues":[key:"tampered"]]);throw NSError(domain:"corrupt expected content accepted",code:1) }catch let error as WorkspaceFailure{try require(error.code == "corrupt","content CAS must reject")}
        do{_ = try a.commit(expected:2,next:third,options:[:]);throw NSError(domain:"CAS bypass accepted",code:1)}catch let error as WorkspaceFailure{try require(error.code=="invalid","expected content cannot be omitted")}
        let future=folder.appendingPathComponent("future.sqlite");var futureDB:OpaquePointer?;sqlite3_open(future.path,&futureDB);sqlite3_exec(futureDB,"PRAGMA user_version=99",nil,nil,nil);sqlite3_close(futureDB)
        let futureOriginal=try Data(contentsOf:future)
        do{_ = try WorkspaceStore(url:future,allowed:keys);throw NSError(domain:"future database admitted",code:1)}catch let error as WorkspaceFailure{try require(error.code=="version","future version must reject")}
        try require(try Data(contentsOf:future)==futureOriginal,"future database bytes must remain unchanged")
        let malformed=folder.appendingPathComponent("malformed-schema.sqlite");var malformedDB:OpaquePointer?;sqlite3_open(malformed.path,&malformedDB);sqlite3_exec(malformedDB,"CREATE TABLE workspace(wrong TEXT); PRAGMA user_version=1",nil,nil,nil);sqlite3_close(malformedDB)
        let malformedOriginal=try Data(contentsOf:malformed)
        do{_ = try WorkspaceStore(url:malformed,allowed:keys);throw NSError(domain:"malformed schema admitted",code:1)}catch let error as WorkspaceFailure{try require(error.code=="corrupt","malformed schema must reject")}
        try require(try Data(contentsOf:malformed)==malformedOriginal,"malformed schema database bytes must remain unchanged")
        var db: OpaquePointer?;try require(sqlite3_open(url.path,&db)==SQLITE_OK,"open interruption fixture");try require(sqlite3_exec(db,"BEGIN IMMEDIATE; UPDATE workspace SET value=x'62726f6b656e' WHERE slot='current';",nil,nil,nil)==SQLITE_OK,"begin interrupted write");sqlite3_close(db)
        try require(try WorkspaceStore.json(a.read()["current"]!) == WorkspaceStore.json(second),"connection loss before commit rolls back")
        _ = try a.commit(expected:2,next:third,options:["preserveRecovery":true,"expectedDigest":second["digest"]!,"expectedValues":second["values"]!]);try require(try WorkspaceStore.json(a.read()["recovery"]!) == WorkspaceStore.json(second),"explicit recovery preserves damaged original slot")
        if CommandLine.arguments.count > 1 {
            let fixture = try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1]))) as! [[String:Any]]
            for record in fixture { let values = record["values"] as! [String:String];try require(try WorkspaceStore.digest(values)==record["digest"] as? String,"native digest must match exact JS Unicode/control bytes") }
        }
        let exported=try MobileFiles.saved(state,allowed:keys),file=try MobileFiles.temporary(exported);defer{try? FileManager.default.removeItem(at:file)}
        let parsed=try JSONSerialization.jsonObject(with:MobileFiles.readImport(file)) as! [String:Any];try require(parsed["format"] as? String=="open-sesame-workspace","actual readable export file")
        try require(try WorkspaceStore.json(parsed["values"]!)==WorkspaceStore.json(second["values"]!),"Unicode export preserves serialized bytes")
        let oversized=folder.appendingPathComponent("oversized.json");try Data(repeating:65,count:WorkspaceStore.maximumBytes+1).write(to:oversized)
        do{_ = try MobileFiles.readImport(oversized);throw NSError(domain:"oversized file admitted",code:1)}catch let error as WorkspaceFailure{try require(error.code=="invalid","native reads must be bounded before parsing")}
        let report=try MobileFiles.recoveryReport(state,allowed:keys);try require(!String(decoding:report,as:UTF8.self).contains("Café"),"recovery report excludes user content")
        let entry=URL(fileURLWithPath:"/bundle/dist/index.html"), request:[String:Any]=["documentID":"unconfigured","method":"workspace.read","params":[:]]
        let valid=MobileBoundary.Context(ownerMatches:true,mainFrame:true,document:entry,entry:entry,active:true,authenticated:true)
        _ = try MobileBoundary.request(request,context:valid)
        let oldText = String(repeating: "x", count: 9 * 1024 * 1024)
        let newText = oldText + "y"
        let large = try generation(2, [key:newText])
        let largeCommit: [String:Any] = ["documentID":"unconfigured", "method":"workspace.commit",
            "params":["expectedRevision":1, "next":large, "options":["expectedValues":[key:oldText]]]]
        let (largeMethod, _) = try MobileBoundary.request(largeCommit,context:valid)
        try require(largeMethod == "workspace.commit", "bridge must fit both bounded workspace generations")

        let denied=[MobileBoundary.Context(ownerMatches:false,mainFrame:true,document:entry,entry:entry,active:true,authenticated:true),MobileBoundary.Context(ownerMatches:true,mainFrame:false,document:entry,entry:entry,active:true,authenticated:true),MobileBoundary.Context(ownerMatches:true,mainFrame:true,document:URL(string:"https://evil.invalid/"),entry:entry,active:true,authenticated:true),MobileBoundary.Context(ownerMatches:true,mainFrame:true,document:entry,entry:entry,active:false,authenticated:true),MobileBoundary.Context(ownerMatches:true,mainFrame:true,document:entry,entry:entry,active:true,authenticated:false)]
        do{_ = try MobileBoundary.request(["documentID":"retired-document","method":"workspace.read","params":[:]],context:valid);throw NSError(domain:"retired document admitted",code:1)}catch let error as WorkspaceFailure{try require(error.code=="denied","retired document generation must reject")}
        for context in denied { do{_ = try MobileBoundary.request(request,context:context);throw NSError(domain:"untrusted request accepted",code:1)}catch let error as WorkspaceFailure{try require(error.code=="denied","frame/account/lifecycle guard")}}
        for raw:[String:Any] in [["documentID":"unconfigured","method":"terminal.input","params":[:]], ["documentID":"unconfigured","method":"workspace.read","params":["platform":"ios"]], ["documentID":"unconfigured","method":"workspace.read","params":[:],"authenticated":true]]{do{_ = try MobileBoundary.request(raw,context:valid);throw NSError(domain:"forged request accepted",code:1)}catch is WorkspaceFailure{}}
        print("PASS receiving boundary: owned local main frame, active native account, unknown methods and forged fields")
        print("PASS native SQLite: reopen/Unicode, generation predecessor, stale connections, content/checksum rejection, interrupted transaction rollback, recovery retention and canonical JS digest vectors")
    }
}
