import XCTest
import WebKit
@testable import OpenSesameMobile

@MainActor private final class FixtureAccount: MobileAccount {
    var authenticated=true,busy=false
    var message="Synthetic verified account fixture"
    var window:UIWindow?
    var changed:(()->Void)?
    func restore(){changed?()}
    func signIn(){}
    func signOut(endRemoteSession:Bool){authenticated=false;changed?()}
    func shutdown(){}
    func validateClock(){}
}

@MainActor final class MobileIntegrationTests: XCTestCase {
    private func javascript(_ web:WKWebView,_ source:String) async throws -> Any {
        try await web.callAsyncJavaScript(source,arguments:[:],in:nil,contentWorld:.page)
    }
    func testPhysicalFileProtectionAttributes() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("Simulator does not expose real protected-file attributes; physical-device acceptance remains open.")
        #else
        let folder=FileManager.default.temporaryDirectory.appendingPathComponent("native-protection-"+UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:folder)}
        let store=try WorkspaceStore(url:folder.appendingPathComponent("workspace.sqlite"),allowed:[])
        let protection=try FileManager.default.attributesOfItem(atPath:store.url.path)[.protectionKey] as? FileProtectionType
        XCTAssertEqual(protection,.complete)
        #endif
    }
    func testRealWKWebViewUsesSQLiteAndRejectsUntrustedFrames() async throws {
        let folder=FileManager.default.temporaryDirectory.appendingPathComponent("native-integration-"+UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:folder)}
        let account=FixtureAccount(),controller=MobileWorkspaceController(account:account,storageFolder:folder)
        guard let scene=UIApplication.shared.connectedScenes.first as? UIWindowScene else {XCTFail("Missing test scene");return}
        let window=UIWindow(windowScene:scene);window.rootViewController=controller;window.makeKeyAndVisible()
        defer{window.isHidden=true}
        controller.loadViewIfNeeded();controller.sceneChanged(active:true)
        defer{controller.shutdown()}
        guard let web=controller.view.subviews.compactMap({$0 as? WKWebView}).first else{XCTFail("Native WK workspace did not mount");return}
        for _ in 0..<200 {
            if (try? await javascript(web,"return window.OpenSesameWorkspaceBoot?.ready===true")) as? Bool == true {break}
            try await Task.sleep(for:.milliseconds(100))
        }
        let state=try await javascript(web,"return {ready:OpenSesameWorkspaceBoot.ready,error:OpenSesameWorkspaceBoot.error||'',platform:window.__OPEN_SESAME_PLATFORM__,native:!!window.OpenSesameWorkspaceNative,mobile:window.OpenSesameMobile?.active,body:document.body.innerText.slice(0,600)}") as! [String:Any]
        XCTAssertEqual(state["ready"] as? Bool,true,state.description);XCTAssertEqual(state["platform"] as? String,"ios");XCTAssertEqual(state["native"] as? Bool,true);XCTAssertEqual(state["mobile"] as? Bool,true)
        _ = try await javascript(web,"await OpenSesameWorkspaceData.setItem('open-sesame-items-v1',JSON.stringify([{id:'native-same-id',kind:'note',text:'Café 🪷',body:'第二行\\nExact bytes'}]));return true")
        let saved=try WorkspaceStore(url:folder.appendingPathComponent("workspace.sqlite"),allowed:["open-sesame-items-v1"])
        let record=try saved.read()["current"] as! [String:Any],values=record["values"] as! [String:String]
        XCTAssertTrue(values["open-sesame-items-v1"]!.contains("native-same-id"));XCTAssertTrue(values["open-sesame-items-v1"]!.contains("第二行"))
        _ = try await javascript(web,"focusRunning=true;focusSessionId='native-focus';focusRemaining=90;focusEnd=Date.now()+90000;await persistFocusSnapshot();return true")
        let deadline=try await javascript(web,"return focusEnd") as! NSNumber
        _ = try await javascript(web,"window.__oldDocument=true;return true");web.reload()
        for _ in 0..<200 {if (try? await javascript(web,"return window.OpenSesameWorkspaceBoot?.ready===true&&!window.__oldDocument")) as? Bool==true {break};try await Task.sleep(for:.milliseconds(100))}
        let restoredDeadline=try await javascript(web,"return focusEnd") as? NSNumber;XCTAssertEqual(restoredDeadline,deadline)
        let restoredID=try await javascript(web,"return focusSessionId") as? String;XCTAssertEqual(restoredID,"native-focus")
        let running=try await javascript(web,"return focusRunning") as? Bool;XCTAssertEqual(running,true)
        _ = try await javascript(web,"document.getElementById('focus-start').click();await OpenSesameWorkspaceData.flush();return true")
        _ = try await javascript(web,"window.__oldDocument=true;return true");web.reload()
        for _ in 0..<200 {if (try? await javascript(web,"return window.OpenSesameWorkspaceBoot?.ready===true&&!window.__oldDocument")) as? Bool==true {break};try await Task.sleep(for:.milliseconds(100))}
        let paused=try await javascript(web,"return focusRunning") as? Bool;XCTAssertEqual(paused,false)
        let restoredBody=try await javascript(web,"return items.find(n=>n.id==='native-same-id').body") as? String;XCTAssertEqual(restoredBody,"第二行\nExact bytes")
        let policy=try folder.resourceValues(forKeys:[.isExcludedFromBackupKey]);XCTAssertEqual(policy.isExcludedFromBackup,false)
        let exported=try MobileFiles.saved(saved.read(),allowed:Set(((try saved.read()["current"] as! [String:Any])["values"] as! [String:String]).keys))
        let file=try MobileFiles.temporary(exported);defer{try? FileManager.default.removeItem(at:file)}
        let exportValues=(try JSONSerialization.jsonObject(with:Data(contentsOf:file)) as! [String:Any])["values"] as! [String:String]
        XCTAssertTrue(exportValues["open-sesame-items-v1"]!.contains("native-same-id"))
        let crownWidth=try await javascript(web,"return document.querySelector('[data-mobile-destination=console] svg').getBBox().width") as! NSNumber
        XCTAssertGreaterThan(crownWidth.doubleValue,0,"Approved crown must actually render in a bundled file-origin WKWebView")
        let geometry=try await javascript(web,"return JSON.stringify({innerHeight,viewport:visualViewport.height,anchor:document.getElementById('widget-anchor').getBoundingClientRect().toJSON(),panel:document.getElementById('widget-panel').getBoundingClientRect().toJSON(),nav:document.querySelector('.mobile-navigation').getBoundingClientRect().toJSON(),scale:getComputedStyle(document.getElementById('widget-panel')).transform})") as! String
        let dimensions=XCTAttachment(string:geometry+" native web bounds: "+web.bounds.debugDescription);dimensions.name="Native workspace geometry";dimensions.lifetime = .keepAlways;add(dimensions)
        let navBottom=try await javascript(web,"return document.querySelector('.mobile-navigation').getBoundingClientRect().bottom") as! NSNumber
        let viewportHeight=try await javascript(web,"return visualViewport.height") as! NSNumber
        XCTAssertEqual(navBottom.doubleValue,viewportHeight.doubleValue,accuracy:40,"Navigation should reach the usable native viewport bottom")
        let image=UIGraphicsImageRenderer(bounds:window.bounds).image{_ in window.drawHierarchy(in:window.bounds,afterScreenUpdates:true)}
        let attachment=XCTAttachment(image:image);attachment.name="Synthetic native workspace after durable reload";attachment.lifetime = .keepAlways;add(attachment)
        let unknown=try await javascript(web,"return (await webkit.messageHandlers.workspace.postMessage({documentID:__OPEN_SESAME_DOCUMENT__,method:'terminal.input',params:{}})).error.code") as? String;XCTAssertEqual(unknown,"unsupported")
        let frame=try await javascript(web,"return await new Promise(resolve=>{const frame=document.createElement('iframe');window.addEventListener('message',event=>{if(event.source===frame.contentWindow)resolve(event.data)});frame.srcdoc='<script>webkit.messageHandlers.workspace.postMessage({documentID:parent.__OPEN_SESAME_DOCUMENT__,method:\"workspace.read\",params:{}}).then(result=>parent.postMessage(result.error.code,\"*\"))<'+ '/script>';document.body.append(frame)})") as? String;XCTAssertEqual(frame,"denied")
        controller.sceneChanged(active:false)
        NotificationCenter.default.post(name:UIApplication.protectedDataDidBecomeAvailableNotification,object:nil)
        let background=try await javascript(web,"return (await webkit.messageHandlers.workspace.postMessage({documentID:__OPEN_SESAME_DOCUMENT__,method:'workspace.read',params:{}})).error.code") as? String;XCTAssertEqual(background,"denied")
        controller.sceneChanged(active:true)
        _ = try await javascript(web,"document.getElementById('capture-input').value='Retain this unsaved local text';return true")
        account.authenticated=false;account.changed?()
        XCTAssertThrowsError(try controller.retainedRecoveryForExport(),"Expired account cannot export a recovery buffer")
        for _ in 0..<100 {if !controller.view.subviews.contains(where:{$0 is WKWebView}){break};try await Task.sleep(for:.milliseconds(100))}
        account.authenticated=true;account.changed?()
        let recovered=try controller.retainedRecoveryForExport();XCTAssertTrue(recovered.contains{String(decoding:$0,as:UTF8.self).contains("Retain this unsaved local text")})
        guard let nextWeb=controller.view.subviews.compactMap({$0 as? WKWebView}).first,
              let bar=controller.view.subviews.compactMap({$0 as? UIStackView}).first,
              let signOut=bar.arrangedSubviews.compactMap({$0 as? UIButton}).first(where:{$0.currentTitle=="Sign out"}) else {
            XCTFail("Verified sign-in did not remount the workspace")
            return
        }
        for _ in 0..<200 {
            if (try? await javascript(nextWeb,"return window.OpenSesameWorkspaceBoot?.ready===true")) as? Bool == true {break}
            try await Task.sleep(for:.milliseconds(100))
        }
        _ = try await javascript(nextWeb,"document.getElementById('capture-input').value='Save before immediate sign-out';return true")
        signOut.sendActions(for:.touchUpInside)
        for _ in 0..<100 {if !controller.view.subviews.contains(where:{$0 is WKWebView}){break};try await Task.sleep(for:.milliseconds(100))}
        XCTAssertFalse(controller.view.subviews.contains(where:{$0 is WKWebView}),"Logout retires the privileged document")
        let afterSignOut=try saved.read()["current"] as? [String:Any]
        let signedOutValues=afterSignOut?["values"] as? [String:String]
        XCTAssertTrue(signedOutValues?["open-sesame-capture-draft-v1"]?.contains("Save before immediate sign-out") == true)

        XCTAssertTrue(FileManager.default.fileExists(atPath:folder.appendingPathComponent("workspace.sqlite").path))
    }
}
