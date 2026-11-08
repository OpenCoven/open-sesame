import AppKit
import ScreenCaptureKit
import Vision
import ImageIO
import UniformTypeIdentifiers

// One explicit capture/import at a time; results are kept in memory for review.
final class OpenSesameScreenNotes: @unchecked Sendable {
    weak var window: NSWindow?
    private var generation = 0
    private var completion: (([String: Any]?, String?) -> Void)?
    private var picker: NSOpenPanel?
    private var confirmation: NSAlert?
    private let queue = DispatchQueue(label: "computer.opensesame.screen-notes", qos: .userInitiated)
    var busy: Bool { completion != nil }

    func cancel() {
        generation += 1; picker?.cancel(nil); picker = nil
        if let alert = confirmation { window?.endSheet(alert.window); alert.window.orderOut(nil); confirmation = nil }
        let callback = completion; completion = nil; callback?(["cancelled": true], nil)
    }
    private func finish(_ ticket: Int, result: [String: Any]? = nil, error: String? = nil) {
        guard generation == ticket else { return }
        let callback = completion; completion = nil; picker = nil; confirmation = nil; callback?(result, error)
    }
    func request(importImage: Bool, preferredDisplay: CGDirectDisplayID?, completion: @escaping ([String: Any]?, String?) -> Void) {
        guard !busy else { completion(nil, "A screen capture is already being prepared."); return }
        generation += 1; let ticket = generation; self.completion = completion
        DispatchQueue.main.asyncAfter(deadline: .now() + 175) { [weak self] in
            guard let self, self.generation == ticket, self.busy else { return }; self.cancel()
        }
        if importImage {
            let picker = NSOpenPanel(); self.picker = picker
            picker.allowedContentTypes = [.png, .jpeg, .heic, .tiff]; picker.allowsMultipleSelection = false
            picker.canChooseDirectories = false; picker.prompt = "Use image"
            picker.begin { [weak self] response in
                guard let self, self.generation == ticket else { return }
                guard response == .OK, let url = picker.url else { self.finish(ticket, result: ["cancelled": true]); return }
                self.picker = nil
                self.queue.async {
                    do {
                        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
                        guard values.isRegularFile == true, let size = values.fileSize, size > 0, size <= 20_000_000 else { throw NotesError.image }
                        let data = try Data(contentsOf: url, options: .mappedIfSafe)
                        let image = try Self.decode(data)
                        self.analyze(image, label: "Imported image", ticket: ticket)
                    } catch { DispatchQueue.main.async { self.finish(ticket, error: "Choose a readable PNG, JPEG, HEIC or TIFF image under 20 MB.") } }
                }
            }
            return
        }
        guard #available(macOS 14.0, *) else { finish(ticket, error: "Screen capture needs macOS 14 or later. Choose an existing screenshot instead."); return }
        let screens = NSScreen.screens
        guard !screens.isEmpty, let window else { finish(ticket, error: "No screen is available."); return }
        let choice = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 300, height: 28))
        choice.addItems(withTitles: screens.map { $0.localizedName })
        if let index = screens.firstIndex(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == preferredDisplay }) { choice.selectItem(at: index) }
        let alert = NSAlert(); alert.messageText = "Capture a screen for notes?"
        alert.informativeText = "Capture one image of the selected screen, excluding Open Sesame. Text recognition runs on this Mac. Review the image and text before saving. Nothing is sent to an agent. macOS may ask for Screen Recording access."
        alert.accessoryView = choice; alert.addButton(withTitle: "Capture screen"); alert.addButton(withTitle: "Cancel")
        alert.buttons[0].keyEquivalent = ""; alert.buttons[1].keyEquivalent = "\r"
        confirmation = alert
        alert.beginSheetModal(for: window) { [weak self] response in
            guard let self, self.generation == ticket else { return }
            self.confirmation = nil
            guard response == .alertFirstButtonReturn, screens.indices.contains(choice.indexOfSelectedItem), let displayID = (screens[choice.indexOfSelectedItem].deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value else { self.finish(ticket, result: ["cancelled": true]); return }
            Task { @MainActor in
                do {
                    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                    guard self.generation == ticket else { return }
                    guard let display = content.displays.first(where: { $0.displayID == displayID }) else { throw NotesError.display }
                    let owner = ProcessInfo.processInfo.processIdentifier
                    let excluded = content.applications.filter { $0.processID == owner }
                    guard excluded.contains(where: { $0.processID == owner }) else { throw NotesError.exclusion }
                    let config = SCStreamConfiguration(), scale = min(1, 2560.0 / Double(max(display.width, display.height)))
                    config.width = max(2, Int(Double(display.width) * scale)); config.height = max(2, Int(Double(display.height) * scale))
                    config.capturesAudio = false; config.showsCursor = false
                    let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
                    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
                    guard self.generation == ticket else { return }
                    let label = screens[choice.indexOfSelectedItem].localizedName
                    self.queue.async { self.analyze(image, label: label, ticket: ticket) }
                } catch {
                    self.finish(ticket, error: "Screen capture was unavailable. Allow Open Sesame in macOS Settings → Privacy & Security → Screen & System Audio Recording, then try again, or choose a screenshot.")
                }
            }
        }
    }
    enum NotesError: Error { case image, display, exclusion }
    static func decode(_ data: Data) throws -> CGImage {
        guard !data.isEmpty, data.count <= 20_000_000, let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int, let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 16000, height <= 16000, width * height <= 40_000_000,
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 2560] as CFDictionary) else { throw NotesError.image }
        return image
    }
    static func recognize(_ image: CGImage) throws -> String {
        let request = VNRecognizeTextRequest(); request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true; request.automaticallyDetectsLanguage = true
        try VNImageRequestHandler(cgImage: image).perform([request])
        return String((request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n").prefix(10000))
    }
    private func analyze(_ image: CGImage, label: String, ticket: Int) {
        // A small preview crosses the local bridge; neither image nor text is uploaded.
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.65]), data.count <= 4_000_000 else { DispatchQueue.main.async { self.finish(ticket, error: "This image is too large to preview. Choose a smaller screenshot.") }; return }
        let text = (try? Self.recognize(image)) ?? ""
        let result: [String: Any] = ["preview": "data:image/jpeg;base64," + data.base64EncodedString(), "text": text, "source": label, "width": image.width, "height": image.height]
        DispatchQueue.main.async { self.finish(ticket, result: result) }
    }
}
