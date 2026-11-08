import Foundation
import CoreGraphics

struct OpenSesameDisplayPreference {
    let uuid: String?
    let name: String
    init(uuid: String? = nil, name: String = "") {
        let valid = uuid.flatMap { UUID(uuidString: $0)?.uuidString }
        self.uuid = valid; self.name = valid == nil ? "" : String(name.prefix(120))
    }
    static func load(from defaults: UserDefaults = .standard) -> Self {
        Self(uuid: defaults.string(forKey: "openSesame.display.uuid"), name: defaults.string(forKey: "openSesame.display.name") ?? "Display")
    }
    func save(to defaults: UserDefaults = .standard) {
        if let uuid { defaults.set(uuid, forKey: "openSesame.display.uuid"); defaults.set(name, forKey: "openSesame.display.name") }
        else { defaults.removeObject(forKey: "openSesame.display.uuid"); defaults.removeObject(forKey: "openSesame.display.name") }
    }
    func index(in identifiers: [String?]) -> Int? {
        guard let uuid else { return nil }
        return identifiers.firstIndex { $0.flatMap { UUID(uuidString: $0)?.uuidString } == uuid }
    }
}

enum OpenSesameScreenPlacement {
    private static func valid(_ frame: CGRect) -> Bool {
        frame.origin.x.isFinite && frame.origin.y.isFinite && frame.width.isFinite && frame.height.isFinite && frame.maxX.isFinite && frame.maxY.isFinite && frame.width > 0 && frame.height > 0
    }

    static func screenIndex(pointer: CGPoint?, frames: [CGRect], fallback: Int?, pinned: Int? = nil) -> Int? {
        let indices = frames.indices.filter { valid(frames[$0]) }
        if let pinned, indices.contains(pinned) { return pinned }
        let preferred = fallback.flatMap { indices.contains($0) ? $0 : nil }
        if let point = pointer, point.x.isFinite, point.y.isFinite {
            let containing = indices.filter { index in
                let frame = frames[index]
                return point.x >= frame.minX && point.x < frame.maxX && point.y >= frame.minY && point.y < frame.maxY
            }
            if let preferred, containing.contains(preferred) { return preferred }
            if let index = containing.first { return index }
        }
        return preferred ?? indices.first
    }

    static func shouldFollow(placement: String, detached: Bool, visible: Bool, interacting: Bool, reconfigure: Bool = false) -> Bool {
        (placement == "notch" || reconfigure) && !detached && visible && !interacting
    }

    static func panelFrame(requested: CGSize, frame: CGRect, visibleFrame: CGRect, placement: String, full: Bool, menuAnchor: CGRect? = nil) -> CGRect? {
        guard valid(frame), requested.width.isFinite, requested.height.isFinite else { return nil }
        if full { return frame }
        let width = min(max(1, frame.width - 8), max(180, requested.width))
        let height = min(max(1, frame.height - 50), max(24, requested.height))
        let visible = valid(visibleFrame) ? visibleFrame : frame
        var x = frame.midX - width / 2
        var top = placement == "menu" ? visible.maxY - 5 : frame.maxY
        if placement == "menu", let anchor = menuAnchor, valid(anchor) { x = anchor.maxX - width; top = anchor.minY - 5 }
        if placement == "capture" { top = visible.midY + height / 2 }
        x = max(frame.minX + min(4, (frame.width - width) / 2), min(frame.maxX - width - min(4, (frame.width - width) / 2), x))
        return CGRect(x: x, y: max(frame.minY, min(frame.maxY - height, top - height)), width: width, height: height)
    }
}
