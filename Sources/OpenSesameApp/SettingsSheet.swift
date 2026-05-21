import OpenSesameCore
import SwiftUI

struct SettingsSheet: View {
    @Binding var catalog: SiteCatalog
    @ObservedObject var appearance: AppearanceSettings

    @Environment(\.dismiss) private var dismiss
    @State private var selection: Tab = .appearance

    enum Tab: String, CaseIterable, Identifiable {
        case appearance = "Appearance"
        case suggested = "Suggested"
        var id: String { rawValue }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "gearshape")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 34, height: 34)
                    .background(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .fill(Color.black.opacity(0.22))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
                    )

                VStack(alignment: .leading, spacing: 3) {
                    Text("Settings")
                        .font(.system(size: 19, weight: .semibold))
                    Text(sectionSubtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
                    .controlSize(.large)
            }
            .padding(.horizontal, 22)
            .padding(.top, 22)
            .padding(.bottom, 16)

            Divider()

            PillSegmentedPicker(selection: $selection)
                .padding(.horizontal, 22)
                .padding(.vertical, 14)

            Divider()

            Group {
                switch selection {
                case .appearance:
                    AppearanceSection(appearance: appearance)
                case .suggested:
                    SuggestedSection(catalog: $catalog)
                }
            }
            .padding(22)
        }
        .frame(width: 520, height: 460)
    }

    private var sectionSubtitle: String {
        switch selection {
        case .appearance: return "Tune the shell’s visual treatment."
        case .suggested: return "Toggle suggested social apps in and out of the sidebar."
        }
    }
}

// MARK: - Suggested

private struct SuggestedSection: View {
    @Binding var catalog: SiteCatalog

    var body: some View {
        SettingsPanelSection(
            title: "Social Apps",
            subtitle: "Opt-in only — toggle on to add to the Socials folder.",
            contentPadding: 0
        ) {
            VStack(spacing: 0) {
                ForEach(Array(CuratedCatalog.socialApps.enumerated()), id: \.element.id) { index, app in
                    if index > 0 {
                        Rectangle()
                            .fill(Color.white.opacity(0.06))
                            .frame(height: 0.5)
                    }
                    SuggestedRow(
                        app: app,
                        isOn: catalogContains(app),
                        toggle: { newValue in toggleApp(app, on: newValue) }
                    )
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func catalogContains(_ app: CuratedApp) -> Bool {
        catalog.sites.contains { $0.url.absoluteString == app.urlString }
    }

    private func toggleApp(_ app: CuratedApp, on: Bool) {
        if on {
            guard !catalogContains(app),
                  let site = try? PortalSite(name: app.name, urlString: app.urlString) else { return }
            let groupID = ensureSocialsFolder()
            catalog.addSite(site, toGroupID: groupID)
        } else {
            guard let site = catalog.sites.first(where: { $0.url.absoluteString == app.urlString }) else { return }
            catalog.removeSite(withID: site.id)
        }
    }

    private func ensureSocialsFolder() -> SiteGroup.ID {
        if let existing = catalog.groups.first(where: { $0.name == CuratedCatalog.socialsFolderName }) {
            return existing.id
        }
        let group = SiteGroup(name: CuratedCatalog.socialsFolderName)
        catalog.addGroup(group)
        return group.id
    }
}

private struct SuggestedRow: View {
    let app: CuratedApp
    let isOn: Bool
    let toggle: (Bool) -> Void

    @State private var isHovered: Bool = false
    @State private var isButtonHovered: Bool = false

    var body: some View {
        Button(action: { toggle(!isOn) }) {
            HStack(spacing: 12) {
                BundledAppIcon(urlString: app.urlString, fallbackName: app.name, size: 22)

                VStack(alignment: .leading, spacing: 1) {
                    Text(app.name)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    if !app.summary.isEmpty {
                        Text(app.summary)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 8)

                addRemovePill
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowFill)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }

    private var rowFill: Color {
        isHovered ? Color.black.opacity(0.32) : Color.black.opacity(0.22)
    }

    private var addRemovePill: some View {
        HStack(spacing: 4) {
            Image(systemName: pillIcon)
                .font(.system(size: 10, weight: .bold))
            Text(pillLabel)
                .font(.system(size: 11, weight: .semibold))
        }
        .foregroundStyle(pillForeground)
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(
            Capsule().fill(pillFill)
        )
        .overlay(
            Capsule().strokeBorder(pillStroke, lineWidth: 0.5)
        )
        .onHover { isButtonHovered = $0 }
        .animation(.easeOut(duration: 0.14), value: isOn)
        .animation(.easeOut(duration: 0.14), value: isButtonHovered)
    }

    private var pillIcon: String {
        if isOn { return isButtonHovered && isHovered ? "minus" : "checkmark" }
        return "plus"
    }

    private var pillLabel: String {
        if isOn { return isButtonHovered && isHovered ? "Remove" : "Added" }
        return "Add"
    }

    private var pillForeground: Color {
        if isOn && isButtonHovered && isHovered { return .red }
        if isOn { return Color.accentColor }
        return Color.primary
    }

    private var pillFill: Color {
        if isOn && isButtonHovered && isHovered { return Color.red.opacity(0.14) }
        if isOn { return Color.accentColor.opacity(0.18) }
        return Color.white.opacity(0.08)
    }

    private var pillStroke: Color {
        if isOn && isButtonHovered && isHovered { return Color.red.opacity(0.4) }
        if isOn { return Color.accentColor.opacity(0.4) }
        return Color.white.opacity(0.12)
    }
}

private struct BundledAppIcon: View {
    let urlString: String
    let fallbackName: String
    let size: CGFloat

    var body: some View {
        ZStack {
            if let url = URL(string: urlString),
               let host = url.host,
               let data = FaviconService.bundledIconData(forHost: host),
               let image = NSImage(data: data) {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color.primary.opacity(0.06))
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else {
                ColoredInitialAvatar(name: fallbackName, size: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

// MARK: - Appearance

private struct AppearanceSection: View {
    @ObservedObject var appearance: AppearanceSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            sidebarPanel
            windowPanel
        }
    }

    private var sidebarPanel: some View {
        SettingsPanelSection(
            title: "Sidebar",
            subtitle: "Tab metrics in the expanded sidebar."
        ) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .center, spacing: 14) {
                    LabeledSlider(
                        label: "Tab Height",
                        value: $appearance.rowVerticalPadding,
                        range: AppearanceSettings.minRowVerticalPadding...AppearanceSettings.maxRowVerticalPadding,
                        step: 1,
                        isPrimary: true
                    )
                    TabHeightPreview(verticalPadding: CGFloat(appearance.rowVerticalPadding))
                }
                Text("Vertical padding inside each sidebar tab. Higher values make rows taller and easier to hit.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var windowPanel: some View {
        SettingsPanelSection(
            title: "Window",
            subtitle: "Decorative effects on the sidebar background."
        ) {
            VStack(alignment: .leading, spacing: 8) {
                Toggle(isOn: $appearance.radialBlurEnabled) {
                    Text("Radial Blur")
                        .font(.system(size: 13, weight: .semibold))
                }

                if appearance.radialBlurEnabled {
                    Rectangle()
                        .fill(Color.white.opacity(0.06))
                        .frame(height: 0.5)
                        .padding(.vertical, 2)

                    LabeledSlider(
                        label: "Intensity",
                        value: $appearance.radialBlurIntensity,
                        range: 0...AppearanceSettings.maxBlurRadius,
                        isPrimary: false
                    )
                }

                Text("Softens the corners of the window with a radial-mask gaussian blur. Subtle by default.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct LabeledSlider: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    var step: Double? = nil
    var isPrimary: Bool = true

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label)
                    .font(.system(
                        size: isPrimary ? 13 : 12,
                        weight: isPrimary ? .semibold : .medium
                    ))
                    .foregroundStyle(isPrimary ? .primary : .secondary)
                Spacer()
                Text("\(Int(value))")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .frame(width: 30, alignment: .trailing)
            }
            if let step {
                Slider(value: $value, in: range, step: step)
            } else {
                Slider(value: $value, in: range)
            }
        }
    }
}

private struct TabHeightPreview: View {
    let verticalPadding: CGFloat

    var body: some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(Color.primary.opacity(0.12))
                .frame(width: 14, height: 14)
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(Color.primary.opacity(0.25))
                .frame(width: 36, height: 6)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, verticalPadding)
        .frame(width: 110)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.black.opacity(0.22))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
        )
        .animation(.easeOut(duration: 0.12), value: verticalPadding)
    }
}

// MARK: - Pill segmented picker

private struct PillSegmentedPicker: View {
    @Binding var selection: SettingsSheet.Tab

    var body: some View {
        HStack(spacing: 4) {
            ForEach(SettingsSheet.Tab.allCases) { tab in
                PillSegment(
                    label: tab.rawValue,
                    isSelected: tab == selection,
                    action: {
                        withAnimation(.easeOut(duration: 0.16)) { selection = tab }
                    }
                )
            }
        }
        .padding(4)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.black.opacity(0.22))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
        )
    }
}

private struct PillSegment: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void

    @State private var isHovered: Bool = false

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(isSelected ? Color.primary : Color.secondary)
                .padding(.vertical, 5)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(fillColor)
                )
                .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }

    private var fillColor: Color {
        if isSelected { return Color.white.opacity(0.10) }
        if isHovered { return Color.white.opacity(0.05) }
        return Color.clear
    }
}

private struct SettingsPanelSection<Content: View>: View {
    let title: String
    let subtitle: String
    var contentPadding: CGFloat = 14
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            VStack(alignment: .leading, spacing: 14) {
                content
            }
            .padding(contentPadding)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.black.opacity(0.22))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

// MARK: - Favicon view

struct FaviconView: View {
    let site: PortalSite
    let size: CGFloat

    @State private var image: NSImage?

    var body: some View {
        ZStack {
            if let image {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color.primary.opacity(0.06))
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else {
                ColoredInitialAvatar(name: site.name, size: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .onAppear { loadImage() }
        .onChange(of: site.iconData) { _, _ in loadImage() }
    }

    private func loadImage() {
        if let data = site.iconData, let img = NSImage(data: data) {
            image = img
        } else {
            image = nil
        }
    }
}

struct ColoredInitialAvatar: View {
    let name: String
    let size: CGFloat

    private var initial: String {
        name.first.map { String($0).uppercased() } ?? "?"
    }

    private var tint: Color {
        let palette: [Color] = [.blue, .purple, .pink, .orange, .green, .teal, .indigo, .mint]
        let hash = abs(name.hashValue)
        return palette[hash % palette.count]
    }

    var body: some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(tint.opacity(0.22))
            .overlay(
                Text(initial)
                    .font(.system(size: size * 0.46, weight: .semibold))
                    .foregroundStyle(tint)
            )
    }
}
