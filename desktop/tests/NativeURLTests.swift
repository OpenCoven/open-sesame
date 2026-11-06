import Foundation

@main
struct NativeURLTests {
    static func main() {
        for value in ["https://example.com/path", "http://localhost:4173/"] {
            precondition(EmbeddedWebSurface.pageURL(value) != nil)
        }
        for value in ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hello", "https://name:secret@example.com/", "https://", "https://example.com/" + String(repeating: "x", count: 8200)] {
            precondition(EmbeddedWebSurface.pageURL(value) == nil)
        }
        print("Native WKWebView URL validation passed without opening a web view.")
    }
}
