import OpenSesameCore
import SwiftUI

struct SettingsSheet: View {
    @Binding var catalog: SiteCatalog
    @ObservedObject var appearance: AppearanceSettings
    let editSite: (PortalSite) -> Void
    let addSite: () -> Void
    let addGroup: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selection: Tab = .sites

    enum Tab: String, CaseIterable, Identifiable {
        case sites = "Sites"
        case home = "Home"
        case appearance = "Appearance"
        var id: String { rawValue }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Settings")
                    .font(.system(size: 16, weight: .semibold))
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)

            Divider()

            Picker("Section", selection: $selection) {
                ForEach(Tab.allCases) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 20)
            .padding(.vertical, 12)

            Divider()

            Group {
                switch selection {
                case .sites:
                    SitesSection(
                        catalog: $catalog,
                        editSite: editSite,
                        addSite: addSite,
                        addGroup: addGroup
                    )
                case .home:
                    HomeSection(catalog: $catalog)
                case .appearance:
                    AppearanceSection(appearance: appearance)
                }
            }
            .padding(20)
        }
        .frame(width: 540, height: 480)
    }
}

// MARK: - Sites

private struct SitesSection: View {
    @Binding var catalog: SiteCatalog
    let editSite: (PortalSite) -> Void
    let addSite: () -> Void
    let addGroup: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Manage the sites and folders shown in the sidebar. Drag to reorder.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)

            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(catalog.entries.enumerated()), id: \.element.id) { _, entry in
                        EntryRow(
                            entry: entry,
                            catalog: $catalog,
                            editSite: editSite
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.secondary.opacity(0.18))
            )

            HStack {
                Button {
                    addSite()
                } label: {
                    Label("Add Site", systemImage: "plus")
                }

                Button {
                    addGroup()
                } label: {
                    Label("Add Folder", systemImage: "folder.badge.plus")
                }

                Spacer()
            }
        }
    }
}

private struct EntryRow: View {
    let entry: CatalogEntry
    @Binding var catalog: SiteCatalog
    let editSite: (PortalSite) -> Void

    var body: some View {
        switch entry {
        case .site(let site):
            SiteEditorRow(
                site: site,
                groupName: nil,
                editSite: editSite,
                onRemove: site.isPinned ? nil : { catalog.removeSite(withID: site.id) }
            )
        case .group(let group):
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Image(systemName: "folder.fill")
                        .foregroundStyle(.secondary)
                    TextField("Folder", text: groupNameBinding(for: group))
                        .textFieldStyle(.plain)
                        .font(.system(size: 13, weight: .semibold))
                    Spacer()
                    Button {
                        catalog.removeGroup(withID: group.id)
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .help("Remove folder (children move to root)")
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.secondary.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))

                ForEach(group.sites) { site in
                    SiteEditorRow(
                        site: site,
                        groupName: group.name,
                        editSite: editSite,
                        onRemove: site.isPinned ? nil : { catalog.removeSite(withID: site.id) }
                    )
                    .padding(.leading, 20)
                }
            }
        }
    }

    private func groupNameBinding(for group: SiteGroup) -> Binding<String> {
        Binding(
            get: { group.name },
            set: { catalog.renameGroup(withID: group.id, to: $0) }
        )
    }
}

private struct SiteEditorRow: View {
    let site: PortalSite
    let groupName: String?
    let editSite: (PortalSite) -> Void
    let onRemove: (() -> Void)?

    var body: some View {
        HStack(spacing: 10) {
            FaviconView(site: site, size: 22)

            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(site.name)
                        .font(.system(size: 13, weight: .medium))
                    if site.isPinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                            .rotationEffect(.degrees(45))
                    }
                }
                Text(site.url.absoluteString)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            Button {
                editSite(site)
            } label: {
                Image(systemName: "pencil")
            }
            .buttonStyle(.borderless)
            .help("Edit")

            if let onRemove {
                Button(action: onRemove) {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless)
                .help("Remove")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.clear)
    }
}

// MARK: - Home

private struct HomeSection: View {
    @Binding var catalog: SiteCatalog

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Home Tab")
                .font(.system(size: 13, weight: .semibold))
            Text("Pick which site is treated as your home. The home tab is protected from removal and is what the Home button (⌘⇧H) jumps to.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)

            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(catalog.sites) { site in
                        HomeChoiceRow(
                            site: site,
                            isHome: site.isPinned,
                            choose: { catalog.setHomeSite(withID: site.id) }
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.secondary.opacity(0.18))
            )
        }
    }
}

private struct HomeChoiceRow: View {
    let site: PortalSite
    let isHome: Bool
    let choose: () -> Void

    var body: some View {
        Button(action: choose) {
            HStack(spacing: 10) {
                Image(systemName: isHome ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(isHome ? Color.accentColor : Color.secondary)
                FaviconView(site: site, size: 22)
                VStack(alignment: .leading, spacing: 1) {
                    Text(site.name)
                        .font(.system(size: 13, weight: .medium))
                    Text(site.url.absoluteString)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .background(isHome ? Color.accentColor.opacity(0.08) : Color.clear)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Appearance

private struct AppearanceSection: View {
    @ObservedObject var appearance: AppearanceSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Transparency")
                        .font(.system(size: 13, weight: .semibold))
                    Spacer()
                    Text("\(Int((1 - appearance.transparency) * 100))%")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                Slider(
                    value: $appearance.transparency,
                    in: AppearanceSettings.minTransparency...AppearanceSettings.maxTransparency
                )
                Text("Lower values let more of the desktop or window behind show through the sidebar and chrome.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }

            Divider()

            VStack(alignment: .leading, spacing: 6) {
                Toggle(isOn: $appearance.radialBlurEnabled) {
                    Text("Radial Blur")
                        .font(.system(size: 13, weight: .semibold))
                }

                if appearance.radialBlurEnabled {
                    HStack {
                        Text("Intensity")
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                        Slider(
                            value: $appearance.radialBlurIntensity,
                            in: 0...AppearanceSettings.maxBlurRadius
                        )
                        Text("\(Int(appearance.radialBlurIntensity))")
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .frame(width: 30, alignment: .trailing)
                    }
                }

                Text("Softens the corners of the window with a radial-mask gaussian blur. Subtle by default.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
    }
}

// MARK: - Favicon view

struct FaviconView: View {
    let site: PortalSite
    let size: CGFloat

    @State private var image: NSImage?

    var body: some View {
        Group {
            if let image {
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
