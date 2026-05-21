import OpenSesameCore
import SwiftUI

struct SettingsSheet: View {
    @Binding var catalog: SiteCatalog
    @ObservedObject var appearance: AppearanceSettings
    let editSite: (PortalSite) -> Void
    let addGroup: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selection: Tab = .sites

    enum Tab: String, CaseIterable, Identifiable {
        case sites = "Sites"
        case appearance = "Appearance"
        var id: String { rawValue }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "gearshape")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 34, height: 34)
                    .background(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .fill(Color.accentColor.opacity(0.14))
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

            Picker("Section", selection: $selection) {
                ForEach(Tab.allCases) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .controlSize(.large)
            .padding(.horizontal, 22)
            .padding(.vertical, 14)

            Divider()

            Group {
                switch selection {
                case .sites:
                    SitesSection(
                        catalog: $catalog,
                        editSite: editSite,
                        addGroup: addGroup
                    )
                case .appearance:
                    AppearanceSection(appearance: appearance)
                }
            }
            .padding(22)
        }
        .frame(width: 600, height: 520)
    }

    private var sectionSubtitle: String {
        switch selection {
        case .sites:
            return "Manage sidebar sites, folders, and quick edits."
        case .appearance:
            return "Tune the shell’s visual treatment."
        }
    }
}

// MARK: - Sites

private struct SitesSection: View {
    @Binding var catalog: SiteCatalog
    let editSite: (PortalSite) -> Void
    let addGroup: () -> Void

    var body: some View {
        SettingsPanelSection(
            title: "Sidebar",
            subtitle: "Edit addresses inline, rename folders, and keep the sidebar tidy."
        ) {
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
            .frame(minHeight: 260)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color(nsColor: .controlBackgroundColor).opacity(0.3))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Color.secondary.opacity(0.15))
            )

            HStack {
                Button {
                    addGroup()
                } label: {
                    Label("Add Folder", systemImage: "folder.badge.plus")
                }
                .controlSize(.large)

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
                updateSite: { catalog.updateSite($0) },
                editSite: editSite,
                onRemove: { catalog.removeSite(withID: site.id) }
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
                .padding(.vertical, 7)
                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                ForEach(group.sites) { site in
                    SiteEditorRow(
                        site: site,
                        groupName: group.name,
                        updateSite: { catalog.updateSite($0) },
                        editSite: editSite,
                        onRemove: { catalog.removeSite(withID: site.id) }
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
    let updateSite: (PortalSite) -> Void
    let editSite: (PortalSite) -> Void
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            FaviconView(site: site, size: 22)

            VStack(alignment: .leading, spacing: 1) {
                Text(site.name)
                    .font(.system(size: 13, weight: .medium))
                InlineSiteAddressField(site: site, updateSite: updateSite)
            }

            Spacer()

            Button {
                editSite(site)
            } label: {
                Image(systemName: "pencil")
            }
            .buttonStyle(.borderless)
            .help("Edit")

            Button(action: onRemove) {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .help("Remove")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct InlineSiteAddressField: View {
    let site: PortalSite
    let updateSite: (PortalSite) -> Void

    @State private var draftURL: String
    @State private var showsValidationError: Bool = false
    @FocusState private var isFocused: Bool

    init(site: PortalSite, updateSite: @escaping (PortalSite) -> Void) {
        self.site = site
        self.updateSite = updateSite
        _draftURL = State(initialValue: site.url.absoluteString)
    }

    var body: some View {
        TextField("https://example.com", text: $draftURL)
            .textFieldStyle(.plain)
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(showsValidationError ? Color.red : Color.secondary)
            .lineLimit(1)
            .focused($isFocused)
            .onSubmit { commitDraftURL() }
            .onChange(of: isFocused) { _, focused in
                if focused {
                    showsValidationError = false
                } else {
                    commitDraftURL()
                }
            }
            .onChange(of: site.url) { _, newURL in
                guard !isFocused else { return }
                draftURL = newURL.absoluteString
                showsValidationError = false
            }
    }

    private func commitDraftURL() {
        let trimmedURL = draftURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedURL != site.url.absoluteString else {
            showsValidationError = false
            return
        }

        do {
            let updated = try PortalSite(
                id: site.id,
                name: site.name,
                urlString: trimmedURL,
                iconData: site.iconData
            )
            updateSite(updated)
            draftURL = updated.url.absoluteString
            showsValidationError = false
        } catch {
            showsValidationError = true
        }
    }
}

// MARK: - Appearance

private struct AppearanceSection: View {
    @ObservedObject var appearance: AppearanceSettings

    var body: some View {
        SettingsPanelSection(
            title: "Appearance",
            subtitle: "Subtle visual preferences for the sidebar and browser chrome."
        ) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Tab Height")
                        .font(.system(size: 13, weight: .semibold))
                    Spacer()
                    Text("\(Int(appearance.rowVerticalPadding))")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .frame(width: 30, alignment: .trailing)
                }
                Slider(
                    value: $appearance.rowVerticalPadding,
                    in: AppearanceSettings.minRowVerticalPadding...AppearanceSettings.maxRowVerticalPadding,
                    step: 1
                )
                Text("Vertical padding inside each sidebar tab. Higher values make rows taller and easier to hit.")
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

private struct SettingsPanelSection<Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 14) {
                content
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color(nsColor: .controlBackgroundColor).opacity(0.34))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.secondary.opacity(0.15))
            )
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
