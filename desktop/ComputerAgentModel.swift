import Foundation
import CoreGraphics
import CoreFoundation

struct OpenSesameComputerAction {
    enum Kind: String, CaseIterable { case observe, click, double_click, right_click, move, drag, type, key, scroll, wait, ask_user }
    let kind: Kind
    let observation: String?
    let coordinate: CGPoint?
    let endCoordinate: CGPoint?
    let text: String?
    let direction: String?
    let amount: Int?
    let milliseconds: Int?
    enum Failure: Error { case invalid, stale, interrupted, displayChanged, focusChanged }

    static func textChunks(_ text: String) -> [[UInt16]] {
        var chunks: [[UInt16]] = [], current: [UInt16] = []
        for scalar in text.unicodeScalars {
            let units = Array(String(scalar).utf16)
            if current.count + units.count > 32 { chunks.append(current); current = [] }
            current.append(contentsOf: units)
        }
        if !current.isEmpty { chunks.append(current) }
        return chunks
    }

    init(_ raw: [String: Any]) throws {
        let fields: Set<String> = ["action", "observation", "coordinate", "end_coordinate", "text", "direction", "amount", "milliseconds"]
        guard Set(raw.keys).isSubset(of: fields), let name = raw["action"] as? String, let kind = Kind(rawValue: name) else { throw Failure.invalid }
        let values = raw.filter { !($0.value is NSNull) }
        func string(_ key: String, _ limit: Int) throws -> String? {
            guard let value = values[key] else { return nil }
            guard let text = value as? String, !text.isEmpty, text.utf8.count <= limit, !text.contains("\0") else { throw Failure.invalid }
            return text
        }
        func point(_ key: String) throws -> CGPoint? {
            guard let raw = values[key] else { return nil }
            guard let pair = raw as? [NSNumber], pair.count == 2, pair.allSatisfy({ CFGetTypeID($0) != CFBooleanGetTypeID() && $0.doubleValue.isFinite && $0.doubleValue >= 0 && $0.doubleValue <= 16384 }) else { throw Failure.invalid }
            return CGPoint(x: pair[0].doubleValue, y: pair[1].doubleValue)
        }
        func integer(_ key: String, _ lower: Int, _ upper: Int) throws -> Int? {
            guard let raw = values[key] else { return nil }
            guard let value = raw as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite, value.doubleValue.rounded() == value.doubleValue, value.doubleValue >= Double(lower), value.doubleValue <= Double(upper) else { throw Failure.invalid }
            return value.intValue
        }
        self.kind = kind; observation = try string("observation", 100); coordinate = try point("coordinate"); endCoordinate = try point("end_coordinate")
        text = try string("text", kind == .type ? 16000 : kind == .ask_user ? 4000 : 100)
        direction = try string("direction", 10); amount = try integer("amount", 1, 20); milliseconds = try integer("milliseconds", 0, 2000)
        var allowed: Set<String> = ["action"]
        if kind != .observe && kind != .ask_user { guard observation != nil else { throw Failure.invalid }; allowed.insert("observation") }
        if [.click, .double_click, .right_click, .move, .drag].contains(kind) { guard coordinate != nil else { throw Failure.invalid }; allowed.insert("coordinate") }
        if kind == .drag { guard endCoordinate != nil else { throw Failure.invalid }; allowed.insert("end_coordinate") }
        if [.type, .key, .ask_user].contains(kind) { guard text != nil else { throw Failure.invalid }; allowed.insert("text") }
        if kind == .scroll { guard let direction, ["up", "down", "left", "right"].contains(direction), amount != nil else { throw Failure.invalid }; allowed.formUnion(["direction", "amount", "coordinate"]) }
        if kind == .wait { guard milliseconds != nil else { throw Failure.invalid }; allowed.insert("milliseconds") }
        guard Set(values.keys).isSubset(of: allowed) else { throw Failure.invalid }
    }
}

struct OpenSesameComputerObservation {
    let id: String
    let run: String
    let display: CGDirectDisplayID
    let bounds: CGRect
    let imageSize: CGSize
    let foreground: Int32
    let humanGeneration: UInt64
    let created: TimeInterval

    func admit(_ action: OpenSesameComputerAction, run: String, display: CGDirectDisplayID, bounds: CGRect, foreground: Int32, humanGeneration: UInt64, now: TimeInterval) throws {
        guard self.run == run, action.observation == id, now >= created, now - created <= 60 else { throw OpenSesameComputerAction.Failure.stale }
        guard self.display == display, self.bounds == bounds else { throw OpenSesameComputerAction.Failure.displayChanged }
        guard self.humanGeneration == humanGeneration else { throw OpenSesameComputerAction.Failure.interrupted }
        guard self.foreground == foreground else { throw OpenSesameComputerAction.Failure.focusChanged }
        if let coordinate = action.coordinate { _ = try screenPoint(coordinate) }
        if let coordinate = action.endCoordinate { _ = try screenPoint(coordinate) }
    }
    func screenPoint(_ point: CGPoint) throws -> CGPoint {
        guard bounds.origin.x.isFinite, bounds.origin.y.isFinite, bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0, imageSize.width.isFinite, imageSize.height.isFinite, imageSize.width > 0, imageSize.height > 0, point.x.isFinite, point.y.isFinite, point.x >= 0, point.y >= 0, point.x < imageSize.width, point.y < imageSize.height else { throw OpenSesameComputerAction.Failure.invalid }
        return CGPoint(x: bounds.minX + point.x / imageSize.width * bounds.width, y: bounds.minY + point.y / imageSize.height * bounds.height)
    }
}

// Keyboard focus must be a non-secure target wholly inside the approved display.
// This does not read or retain field values.
struct OpenSesameComputerFocusPolicy {
    static func allows(role: String, subrole: String, bounds: CGRect, display: CGRect) -> Bool {
        !role.lowercased().contains("secure") && !subrole.lowercased().contains("secure") && !subrole.lowercased().contains("password") && bounds.width > 0 && bounds.height > 0 && bounds.origin.x.isFinite && bounds.origin.y.isFinite && bounds.width.isFinite && bounds.height.isFinite && display.contains(bounds)
    }
}
