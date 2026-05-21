import AppKit
import SwiftUI

@MainActor
final class AppearanceSettings: ObservableObject {
    @AppStorage("appearance.transparency") var transparency: Double = 0.85
    @AppStorage("appearance.radialBlurEnabled") var radialBlurEnabled: Bool = false
    @AppStorage("appearance.radialBlurIntensity") var radialBlurIntensity: Double = 18

    static let minTransparency: Double = 0.5
    static let maxTransparency: Double = 1.0
    static let maxBlurRadius: Double = 40
}

struct VisualEffectBackground: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .underWindowBackground
    var blendingMode: NSVisualEffectView.BlendingMode = .behindWindow

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.state = .followsWindowActiveState
        view.material = material
        view.blendingMode = blendingMode
        view.isEmphasized = false
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {
        view.material = material
        view.blendingMode = blendingMode
    }
}

/// Applies a radial-gradient-masked gaussian blur layer over its contents.
/// The center stays crisp and the edges soften, producing a subtle vignette
/// blur. The blur is purely decorative — no hit testing.
struct RadialBlurOverlay: View {
    var radius: CGFloat

    var body: some View {
        GeometryReader { proxy in
            let dim = max(proxy.size.width, proxy.size.height)
            Rectangle()
                .fill(.regularMaterial)
                .blur(radius: radius)
                .mask(
                    RadialGradient(
                        gradient: Gradient(stops: [
                            .init(color: .clear, location: 0.0),
                            .init(color: .clear, location: 0.45),
                            .init(color: .white, location: 1.0)
                        ]),
                        center: .center,
                        startRadius: dim * 0.15,
                        endRadius: dim * 0.7
                    )
                )
                .allowsHitTesting(false)
        }
    }
}
