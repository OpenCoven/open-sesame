import Foundation
import AppKit

@main
struct NativeURLTests {
    static func main() {
        for value in ["https://example.com/path", "http://localhost:4173/"] {
            precondition(EmbeddedWebSurface.pageURL(value) != nil)
        }
        for value in ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hello", "https://name:secret@example.com/", "https://", "https://example.com/" + String(repeating: "x", count: 8200)] {
            precondition(EmbeddedWebSurface.pageURL(value) == nil)
        }
        let bounds = NSRect(x: 0, y: 0, width: 1180, height: 664)
        let player: [String: Any] = ["x": 80, "y": 112, "width": 1080, "height": 470]
        let topDown = try! EmbeddedWebSurface.layout(player, bounds: bounds, flipped: true)
        precondition(topDown.viewport.minY == 112, "A flipped WKWebView must leave the search toolbar above the player.")
        precondition(topDown.viewport.maxY == 582)
        let bottomUp = try! EmbeddedWebSurface.layout(player, bounds: bounds, flipped: false)
        precondition(bottomUp.viewport.minY == 82)
        var clipped = player
        clipped["clip"] = ["x": 100, "y": 130, "width": 900, "height": 400]
        let fit = try! EmbeddedWebSurface.layout(clipped, bounds: bounds, flipped: true)
        precondition(fit.viewport == NSRect(x: 100, y: 130, width: 900, height: 400))
        precondition(fit.content == NSRect(x: -20, y: -18, width: 1080, height: 470), "Clipping must preserve the page size and scroll position.")
        let small = try! EmbeddedWebSurface.layout(player, bounds: NSRect(x: 0, y: 0, width: 800, height: 450), flipped: true)
        precondition(small.viewport == NSRect(x: 80, y: 112, width: 720, height: 338))
        let gone = try! EmbeddedWebSurface.layout(["x": 0, "y": 700, "width": 400, "height": 300], bounds: bounds, flipped: true)
        precondition(gone.viewport.isEmpty)
        for bad in [Double.nan, Double.infinity, -Double.infinity] {
            precondition((try? EmbeddedWebSurface.layout(["x": bad, "y": 20, "width": 400, "height": 300], bounds: bounds, flipped: true)) == nil)
        }
        print("Native URL validation and top-down/bottom-up layout, toolbar clearance, clipping, resize and invalid geometry passed without opening a web view.")
    }
}
