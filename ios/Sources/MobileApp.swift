import UIKit
import WebKit
import UniformTypeIdentifiers

@MainActor protocol MobileAccount: AnyObject {
    var authenticated: Bool { get }
    var busy: Bool { get }
    var message: String { get }
    var window: UIWindow? { get set }
    var changed: (() -> Void)? { get set }
    func restore()
    func signIn()
    func signOut(endRemoteSession: Bool)
    func shutdown()
    func validateClock()
}
extension OpenSesameAuthentication: MobileAccount {}

@main final class MobileApp: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name:"Workspace",sessionRole:session.role);configuration.delegateClass = MobileScene.self;return configuration
    }
}

@MainActor final class MobileScene: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene,willConnectTo session: UISceneSession,options: UIScene.ConnectionOptions) {
        guard let scene=scene as? UIWindowScene else{return};let window=UIWindow(windowScene:scene);window.rootViewController=MobileWorkspaceController();self.window=window;window.makeKeyAndVisible()
    }
    func sceneDidBecomeActive(_ scene: UIScene) { (window?.rootViewController as? MobileWorkspaceController)?.sceneChanged(active:true) }
    func sceneDidDisconnect(_ scene: UIScene) { (window?.rootViewController as? MobileWorkspaceController)?.shutdown() }
    func sceneWillResignActive(_ scene: UIScene) { (window?.rootViewController as? MobileWorkspaceController)?.sceneChanged(active:false) }
}

@MainActor final class MobileWorkspaceController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, UIDocumentPickerDelegate {
    private let account: any MobileAccount
    private let storageFolder: URL?
    init(account: (any MobileAccount)? = nil, storageFolder: URL? = nil) { self.account = account ?? OpenSesameAuthentication();self.storageFolder = storageFolder;super.init(nibName:nil,bundle:nil) }
    required init?(coder: NSCoder) { fatalError("Use the native workspace initializer") }
    private var web: WKWebView?
    private var store: WorkspaceStore?
    private var generation = 0
    private var documentID=UUID().uuidString
    private var entry: URL?
    private var allowedKeys:Set<String>=[]
    private var confirmations:[UUID:(Bool)->Void]=[:]
    private let message = UILabel(), login = UIButton(type: .system), logout = UIButton(type: .system), files = UIButton(type: .system)
    private let cover = UIView()
    private var sceneActive = false
    private var active = false
    private var retainedDrafts:[Data]=[]
    private var importPicker: UIDocumentPickerViewController?

    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .systemBackground
        let bar = UIStackView(arrangedSubviews: [message, login, files, logout]);bar.axis = .horizontal;bar.spacing = 12;bar.alignment = .center;bar.translatesAutoresizingMaskIntoConstraints = false
        message.numberOfLines = 3;message.font = .preferredFont(forTextStyle: .caption1)
        login.setTitle("Sign in", for: .normal);logout.setTitle("Sign out", for: .normal);files.setTitle("Workspace files", for: .normal)
        login.addTarget(self, action: #selector(signIn), for: .touchUpInside);logout.addTarget(self, action: #selector(signOut), for: .touchUpInside);files.addTarget(self, action: #selector(fileActions), for: .touchUpInside)
        view.addSubview(bar);NSLayoutConstraint.activate([bar.topAnchor.constraint(equalTo:view.safeAreaLayoutGuide.topAnchor),bar.leadingAnchor.constraint(equalTo:view.safeAreaLayoutGuide.leadingAnchor,constant:12),bar.trailingAnchor.constraint(equalTo:view.safeAreaLayoutGuide.trailingAnchor,constant:-12),bar.heightAnchor.constraint(greaterThanOrEqualToConstant:48)])
        cover.backgroundColor = .systemBackground;cover.translatesAutoresizingMaskIntoConstraints = false;view.addSubview(cover)
        NSLayoutConstraint.activate([cover.topAnchor.constraint(equalTo:bar.bottomAnchor),cover.bottomAnchor.constraint(equalTo:view.bottomAnchor),cover.leadingAnchor.constraint(equalTo:view.leadingAnchor),cover.trailingAnchor.constraint(equalTo:view.trailingAnchor)])
        account.changed = { [weak self] in self?.sync(bar:bar) };account.window = view.window
        NotificationCenter.default.addObserver(self,selector:#selector(suspend),name:UIApplication.protectedDataWillBecomeUnavailableNotification,object:nil)
        NotificationCenter.default.addObserver(self,selector:#selector(resume),name:UIApplication.protectedDataDidBecomeAvailableNotification,object:nil)
        NotificationCenter.default.addObserver(self,selector:#selector(clockChanged),name:UIApplication.significantTimeChangeNotification,object:nil)
        sync(bar:bar);account.restore()
    }
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated);account.window = view.window }
    func sceneChanged(active: Bool) {
        sceneActive = active
        if active { resume() } else { suspend() }
    }
    func shutdown() { retire();account.shutdown();account.changed=nil;NotificationCenter.default.removeObserver(self) }
    @objc private func clockChanged() { account.validateClock() }
    @objc private func signIn() { account.window = view.window;account.signIn() }
    @objc private func signOut() {
        guard active,account.authenticated else{return}
        guard let web else{account.signOut(endRemoteSession:true);retire();return}
        let ticket=generation
        web.callAsyncJavaScript("document.activeElement?.blur();await OpenSesameWorkspaceDrafts.checkpointForSignOut();return true",arguments:[:],in:nil,in:.page){[weak self,weak web] result in
            guard let self,let web,self.web === web,ticket==self.generation,self.active,self.account.authenticated else{return}
            if case .success=result{self.account.signOut(endRemoteSession:true);self.retire();return}
            let alert=UIAlertController(title:"Some drafts could not be saved",message:"Keep this workspace open and export open drafts for recovery, or sign out with a best-effort recovery copy retained in memory. Unacknowledged text is not guaranteed after termination.",preferredStyle:.alert)
            alert.addAction(UIAlertAction(title:"Keep open",style:.cancel));alert.addAction(UIAlertAction(title:"Sign out",style:.destructive){[weak self] _ in self?.account.signOut(endRemoteSession:true);self?.retire()});self.present(alert,animated:true)
        }
    }
    @objc private func suspend() {
        active = false;generation += 1;cover.isHidden = false;web?.isUserInteractionEnabled=false;web?.accessibilityElementsHidden=true;cancelConfirmations()
        // Best-effort checkpoint is not an acknowledgment or a replacement for per-edit durable saves.
        web?.evaluateJavaScript("window.OpenSesameWorkspaceData?.flush().catch(()=>{})",completionHandler:nil)
        web?.evaluateJavaScript("window.dispatchEvent(new Event('open-sesame-mobile-suspended'))",completionHandler:nil)
    }
    @objc private func resume() {
        guard sceneActive, UIApplication.shared.isProtectedDataAvailable else { return }
        active = true
        account.validateClock()
        if let bar = view.subviews.first as? UIStackView { sync(bar:bar) }
    }
    private func retire() {
        cancelConfirmations();presentedViewController?.dismiss(animated:false);generation += 1;cover.isHidden=false
        guard let prior=web else{store=nil;return};web=nil;store=nil
        prior.isUserInteractionEnabled=false;prior.accessibilityElementsHidden=true
        prior.configuration.userContentController.removeScriptMessageHandler(forName:"workspace",contentWorld:.page)
        // Capture through canonical editors before disposing their document. This buffer grants no authority and is not a durable-save acknowledgment.
        prior.callAsyncJavaScript("document.querySelectorAll('audio,video').forEach(n=>n.pause());const drafts=OpenSesameWorkspaceDrafts.snapshot();OpenSesameWorkspaceStorageModel.values({'open-sesame-tool-drafts-v1':JSON.stringify(drafts)});return JSON.stringify({format:'open-sesame-draft-recovery',drafts})",arguments:[:],in:nil,in:.page){[weak self] result in
            if case .success(let raw)=result,let text=raw as? String,text.utf8.count<=WorkspaceStore.maximumBytes{let data=Data(text.utf8);if self?.retainedDrafts.contains(data)==false{self?.retainedDrafts.append(data)}}
            prior.stopLoading();prior.removeFromSuperview()
        }
    }
    func retainedRecoveryForExport() throws -> [Data] {
        guard active,account.authenticated else{throw WorkspaceFailure("denied","Sign in before exporting retained recovery text.")};return retainedDrafts
    }
    private func sync(bar: UIStackView) {
        message.text = account.message + (account.authenticated && !retainedDrafts.isEmpty ? " Recovery drafts are available in Workspace files." : "");login.isHidden = account.authenticated;login.isEnabled = !account.busy;logout.isHidden = !account.authenticated;files.isHidden = !account.authenticated
        guard account.authenticated, active else { if !account.authenticated { retire() };return }
        if web == nil {
            do { try mount(below:bar) } catch { message.text = "Workspace could not open. Saved originals are preserved. Unlock the device or retry after recovery.";return }
        }
        web?.isUserInteractionEnabled=true;web?.accessibilityElementsHidden=false;cover.isHidden = true
    }
    private func mount(below bar: UIView) throws {
        guard let entry = Bundle.main.url(forResource:"index",withExtension:"html",subdirectory:"dist"),let keysURL = Bundle.main.url(forResource:"workspace-keys",withExtension:"json") else { throw WorkspaceFailure("unavailable","Bundled workspace is missing.") }
        self.entry = entry
        let keys = try JSONDecoder().decode([String].self,from:Data(contentsOf:keysURL));allowedKeys=Set(keys)
        let folder = try storageFolder ?? FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent("Workspace",isDirectory:true)
        store = try WorkspaceStore(url:folder.appendingPathComponent("workspace.sqlite"),allowed:Set(keys))
        let configuration = WKWebViewConfiguration();configuration.websiteDataStore = .default()
        configuration.userContentController.addScriptMessageHandler(self,contentWorld:.page,name:"workspace")
        let web = WKWebView(frame:.zero,configuration:configuration);self.web = web;web.navigationDelegate = self;web.uiDelegate = self;web.translatesAutoresizingMaskIntoConstraints = false
        web.scrollView.contentInsetAdjustmentBehavior = .never;view.insertSubview(web,belowSubview:cover)
        NSLayoutConstraint.activate([web.topAnchor.constraint(equalTo:bar.bottomAnchor),web.bottomAnchor.constraint(equalTo:view.safeAreaLayoutGuide.bottomAnchor),web.leadingAnchor.constraint(equalTo:view.safeAreaLayoutGuide.leadingAnchor),web.trailingAnchor.constraint(equalTo:view.safeAreaLayoutGuide.trailingAnchor)])
        installBootstrap(web);web.loadFileURL(entry,allowingReadAccessTo:entry.deletingLastPathComponent())
    }
    private func installBootstrap(_ web:WKWebView) {
        let source="window.__OPEN_SESAME_NATIVE__=true;window.__OPEN_SESAME_PLATFORM__='ios';window.__OPEN_SESAME_VERSION__='iOS development';window.__OPEN_SESAME_DOCUMENT__='\(documentID)';"
        web.configuration.userContentController.removeAllUserScripts()
        web.configuration.userContentController.addUserScript(WKUserScript(source:source,injectionTime:.atDocumentStart,forMainFrameOnly:true))
    }
    func webView(_ webView:WKWebView,didStartProvisionalNavigation navigation:WKNavigation!) {
        guard webView === web else{return};generation += 1;documentID=UUID().uuidString;cancelConfirmations();installBootstrap(webView)
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        do {
            let context=MobileBoundary.Context(ownerMatches:web != nil && message.webView === web,mainFrame:message.frameInfo.isMainFrame,document:message.frameInfo.request.url,entry:entry,active:active,authenticated:account.authenticated,documentID:documentID)
            let (method,params)=try MobileBoundary.request(message.body,context:context)
            guard let store else { throw WorkspaceFailure("unavailable","Workspace storage is unavailable.") }
            switch method {
            case "workspace.read": guard params.isEmpty else { throw WorkspaceFailure("invalid","Unexpected read parameters.") };let result=try store.read();guard active,account.authenticated else{throw WorkspaceFailure("denied","Session expired before data could be returned.")};replyHandler(["ok":true,"result":result],nil)
            case "workspace.commit":
                guard Set(params.keys)==Set(["expectedRevision","next","options"]),let n=params["expectedRevision"] as? NSNumber,CFGetTypeID(n) != CFBooleanGetTypeID(),n.doubleValue.rounded()==n.doubleValue,n.doubleValue>=0,n.doubleValue<9_007_199_254_740_991,let next=params["next"] as? [String:Any],let options=params["options"] as? [String:Any] else { throw WorkspaceFailure("invalid","Invalid commit parameters.") }
                let result=try store.commit(expected:n.int64Value,next:next,options:options);guard active,account.authenticated else{throw WorkspaceFailure("uncertain","Session ended before the commit acknowledgment. Reconcile after sign-in.",committed:nil)};replyHandler(["ok":true,"result":result],nil)
            default: throw WorkspaceFailure("unsupported","This operation is unavailable on the local mobile host.")
            }
        } catch let error as WorkspaceFailure { var failure:[String:Any] = ["code":error.code,"message":error.message];if let committed = error.committed { failure["committed"]=committed };replyHandler(["ok":false,"error":failure],nil) }
        catch { replyHandler(["ok":false,"error":["code":"unavailable","message":"Storage could not complete. Originals remain preserved.","committed":false]],nil) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy)->Void) {
        if action.targetFrame?.isMainFrame == true {
            if action.request.url?.standardizedFileURL == entry?.standardizedFileURL { decisionHandler(.allow);return }
            if action.navigationType == .linkActivated, let url=action.request.url, ["https","http"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
            decisionHandler(.cancel);return
        }
        // External frames never receive a privileged script or inherit a trusted main frame.
        decisionHandler(.allow)
    }
    private func cancelConfirmations() {let pending=confirmations;confirmations.removeAll();for completion in pending.values{completion(false)}}
    func webView(_ webView:WKWebView,runJavaScriptConfirmPanelWithMessage text:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(Bool)->Void) {
        guard webView === web,frame.isMainFrame,frame.request.url?.standardizedFileURL==entry?.standardizedFileURL,active,account.authenticated,text.utf8.count<=4096,presentedViewController==nil else{completionHandler(false);return}
        let id=UUID(),ticket=generation;confirmations[id]=completionHandler
        let alert=UIAlertController(title:"Confirm workspace action",message:text,preferredStyle:.alert)
        alert.addAction(UIAlertAction(title:"Cancel",style:.cancel){[weak self] _ in self?.confirmations.removeValue(forKey:id)?(false)})
        alert.addAction(UIAlertAction(title:"Continue",style:.default){[weak self] _ in guard let self else{return};self.confirmations.removeValue(forKey:id)?(ticket==self.generation && self.active && self.account.authenticated)})
        present(alert,animated:true)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { guard account.authenticated,active,let entry else { return };generation += 1;webView.loadFileURL(entry,allowingReadAccessTo:entry.deletingLastPathComponent()) }
    @objc private func fileActions() {
        guard active,account.authenticated else { return }
        let sheet=UIAlertController(title:"Workspace files",message:"Export committed data, or preview an explicit replacement. Credentials are excluded.",preferredStyle:.actionSheet)
        sheet.addAction(UIAlertAction(title:"Export saved workspace",style:.default){[weak self] _ in self?.exportSaved()});sheet.addAction(UIAlertAction(title:"Export open drafts for recovery",style:.default){[weak self] _ in self?.exportDrafts()});sheet.addAction(UIAlertAction(title:"Export recovery report",style:.default){[weak self] _ in self?.exportRecoveryReport()});sheet.addAction(UIAlertAction(title:"Restore previous generation",style:.default){[weak self] _ in self?.restorePrevious()});sheet.addAction(UIAlertAction(title:"Import workspace JSON",style:.default){[weak self] _ in self?.chooseImport()});sheet.addAction(UIAlertAction(title:"Cancel",style:.cancel))
        if !retainedDrafts.isEmpty{sheet.addAction(UIAlertAction(title:"Export retained recovery drafts",style:.default){[weak self] _ in
            guard let self else{return};do{try self.shareMany(self.retainedRecoveryForExport())}catch{self.message.text="Retained recovery drafts could not be exported."}
        })}
        sheet.popoverPresentationController?.sourceView=files;present(sheet,animated:true)
    }
    private func share(_ data:Data) throws {try shareMany([data])}
    private func shareMany(_ data:[Data]) throws {
        var urls:[URL]=[]
        do{for bytes in data{urls.append(try MobileFiles.temporary(bytes))}}catch{for url in urls{try? FileManager.default.removeItem(at:url)};throw error}
        let share=UIActivityViewController(activityItems:urls,applicationActivities:nil);share.popoverPresentationController?.sourceView=files
        share.completionWithItemsHandler={_,_,_,_ in for url in urls{try? FileManager.default.removeItem(at:url)}};present(share,animated:true)
    }
    private func exportSaved() {
        guard active,account.authenticated,let store else{return}
        do{try share(MobileFiles.saved(store.read(),allowed:allowedKeys))}catch{message.text="Export failed. Saved data is preserved; recover storage before retrying."}
    }
    private func exportRecoveryReport() {
        guard active,account.authenticated,let store else{return}
        do{try share(MobileFiles.recoveryReport(store.read(),allowed:allowedKeys))}catch{message.text="Recovery report could not be exported. Saved originals are preserved."}
    }
    private func exportDrafts() {
        guard active,account.authenticated else{return}
        guard let web else{return};let ticket=generation
        web.callAsyncJavaScript("const drafts=OpenSesameWorkspaceDrafts.snapshot();OpenSesameWorkspaceStorageModel.values({'open-sesame-tool-drafts-v1':JSON.stringify(drafts)});return JSON.stringify({format:'open-sesame-draft-recovery',drafts})",arguments:[:],in:nil,in:.page){[weak self,weak web] result in
            guard let self,let web,self.web === web,ticket==self.generation,self.active,self.account.authenticated else{return}
            do{guard case .success(let raw)=result,let text=raw as? String else{throw WorkspaceFailure("unavailable","No open drafts are available.")};try self.share(Data(text.utf8))}catch{self.message.text="Draft recovery export failed. Keep this workspace open and preserve its text."}
        }
    }
    private func restorePrevious() {
        guard active,account.authenticated,let web else{return};let ticket=generation
        let alert=UIAlertController(title:"Restore previous generation?",message:"Restore the last valid generation and reload? The current generation is retained for recovery. Export open drafts before continuing.",preferredStyle:.alert)
        alert.addAction(UIAlertAction(title:"Cancel",style:.cancel));alert.addAction(UIAlertAction(title:"Restore",style:.destructive){[weak self,weak web] _ in
            guard let self,let web,self.web === web,ticket==self.generation,self.active,self.account.authenticated else{return}
            web.callAsyncJavaScript("if(OpenSesameWorkspaceBoot.restorePrevious){await OpenSesameWorkspaceBoot.restorePrevious()}else{await OpenSesameWorkspaceData.flush();await OpenSesameWorkspaceData.restorePrevious({expectedRevision:OpenSesameWorkspaceData.revision,retireAfter:true})}return true",arguments:[:],in:nil,in:.page){[weak self,weak web] result in
                guard let self,let web,self.web === web,ticket==self.generation,self.active,self.account.authenticated else{return}
                if case .success=result{web.reload()}else{self.message.text="No valid previous generation could be restored. Originals remain preserved."}
            }
        });present(alert,animated:true)
    }
    private func chooseImport() { guard active,account.authenticated else{return};let picker=UIDocumentPickerViewController(forOpeningContentTypes:[.json],asCopy:true);picker.delegate=self;importPicker=picker;present(picker,animated:true) }
    func documentPicker(_ controller: UIDocumentPickerViewController,didPickDocumentsAt urls:[URL]) {
        guard controller === importPicker,let url=urls.first,urls.count==1,active,account.authenticated,let web else{return};importPicker=nil
        let ticket=generation
        do {
            let access=url.startAccessingSecurityScopedResource();defer{if access{url.stopAccessingSecurityScopedResource()}}
            let attrs=try url.resourceValues(forKeys:[.fileSizeKey]);guard (attrs.fileSize ?? Int.max)<=WorkspaceStore.maximumBytes else{throw WorkspaceFailure("invalid","File exceeds the workspace limit.")}
            let bytes=try MobileFiles.readImport(url);guard bytes.count<=WorkspaceStore.maximumBytes,let text=String(data:bytes,encoding:.utf8) else{throw WorkspaceFailure("invalid","Choose readable bounded JSON.")}
            web.callAsyncJavaScript("await OpenSesameWorkspaceData.flush();const values=OpenSesameWorkspaceData.previewImport(text);return {revision:OpenSesameWorkspaceData.revision,sections:Object.keys(values).length}",arguments:["text":text],in:nil,in:.page){[weak self,weak web] result in
                guard let self,let web,self.web === web,ticket==self.generation,self.active,self.account.authenticated else{return}
                guard case .success(let raw)=result,let preview=raw as? [String:Any],let revision=preview["revision"] as? NSNumber else{self.message.text="Import validation failed. Saved data and drafts are retained.";return}
                let alert=UIAlertController(title:"Replace workspace?",message:"This validated file replaces local content, drafts and configuration. The previous generation is retained. It cannot sign in or grant companion access.",preferredStyle:.alert)
                alert.addAction(UIAlertAction(title:"Cancel",style:.cancel));alert.addAction(UIAlertAction(title:"Replace",style:.destructive){[weak self,weak web] _ in
                    guard let self,let web,self.web === web,ticket==self.generation,self.active,self.account.authenticated else{return}
                    web.callAsyncJavaScript("await OpenSesameWorkspaceData.importJSON(text,{mode:'replace',expectedRevision:revision,retireAfter:true});return true",arguments:["text":text,"revision":revision],in:nil,in:.page){[weak self,weak web] result in
                        guard let self,let web,self.web === web,ticket==self.generation else{return}
                        if case .success=result {web.reload()}else{self.message.text="Replacement failed or conflicted. Preserve drafts and reconcile before retrying."}
                    }
                });self.present(alert,animated:true)
            }
        }catch{message.text="Import could not open. Choose a readable JSON file within the size limit."}
    }
    deinit { NotificationCenter.default.removeObserver(self) }
}
