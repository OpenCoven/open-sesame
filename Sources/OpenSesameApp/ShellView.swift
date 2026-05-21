import AppKit
import OpenSesameCore
import SwiftUI

private enum SiteSheetTarget: Identifiable {
    case add
    case edit(PortalSite)

    var id: String {
        switch self {
        case .add: return "add"
        case .edit(let site): return "edit-\(site.id.uuidString)"
        }
    }
}

private enum SidebarMode {
    case expanded
    case rail
}

private let railWidth: CGFloat = 56

struct ShellView: View {
    @Binding var catalog: SiteCatalog
    @State private var reloadToken = UUID()
    @State private var sidebarMode: SidebarMode = .expanded
    @State private var sidebarWidth: CGFloat = 240
    @State private var siteSheet: SiteSheetTarget?
    @StateObject private var controller = BrowserController()

    private static let minSidebarWidth: CGFloat = 180
    private static let maxSidebarWidth: CGFloat = 380
    private static let sidebarAnimation: Animation = .spring(response: 0.32, dampingFraction: 0.86)

    var body: some View {
        HStack(spacing: 0) {
            SiteSidebar(
                catalog: $catalog,
                mode: sidebarMode,
                addSite: { siteSheet = .add },
                editSite: { site in siteSheet = .edit(site) },
                toggleMode: toggleSidebar
            )
            .frame(width: sidebarMode == .expanded ? sidebarWidth : railWidth)
            .zIndex(1)

            if sidebarMode == .expanded {
                SidebarResizeHandle(
                    width: $sidebarWidth,
                    minWidth: Self.minSidebarWidth,
                    maxWidth: Self.maxSidebarWidth
                )
            } else {
                Divider()
                    .opacity(0.6)
            }

            VStack(spacing: 0) {
                BrowserChrome(
                    site: catalog.selectedSite,
                    controller: controller,
                    hasHome: catalog.pinnedSite != nil,
                    reload: reload,
                    goHome: goHome,
                    openExternally: openSelectedSite
                )

                Divider()

                if let site = catalog.selectedSite {
                    BrowserWebView(
                        url: site.url,
                        reloadToken: reloadToken,
                        controller: controller
                    )
                    .id(site.id)
                } else {
                    ContentUnavailableView(
                        "No Site Selected",
                        systemImage: "safari",
                        description: Text("Add a site to start previewing.")
                    )
                }
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .sheet(item: $siteSheet) { target in
            SiteSheet(
                target: target,
                onAdd: { site in
                    catalog.addSite(site)
                    catalog.selectSite(withID: site.id)
                },
                onUpdate: { site in
                    catalog.updateSite(site)
                }
            )
        }
        .background(
            Button("Toggle Sidebar", action: toggleSidebar)
                .keyboardShortcut("s", modifiers: [.command, .control])
                .opacity(0)
                .frame(width: 0, height: 0)
        )
    }

    private func toggleSidebar() {
        withAnimation(Self.sidebarAnimation) {
            sidebarMode = (sidebarMode == .expanded) ? .rail : .expanded
        }
    }

    private func reload() {
        reloadToken = UUID()
    }

    private func goHome() {
        guard let home = catalog.pinnedSite else { return }
        catalog.selectSite(withID: home.id)
    }

    private func openSelectedSite() {
        guard let url = catalog.selectedSite?.url else {
            return
        }

        NSWorkspace.shared.open(url)
    }
}

private struct SidebarResizeHandle: View {
    @Binding var width: CGFloat
    let minWidth: CGFloat
    let maxWidth: CGFloat

    @State private var dragStartWidth: CGFloat?
    @State private var isHovering: Bool = false

    var body: some View {
        ZStack {
            Color.clear
            Rectangle()
                .fill(isHovering ? Color.accentColor.opacity(0.45) : Color.black.opacity(0.08))
                .frame(width: isHovering ? 2 : 1)
                .animation(.easeInOut(duration: 0.12), value: isHovering)
        }
        .frame(width: 12)
        .contentShape(Rectangle())
        .onHover { hovering in
            isHovering = hovering
            if hovering {
                NSCursor.resizeLeftRight.push()
            } else {
                NSCursor.pop()
            }
        }
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    if dragStartWidth == nil {
                        dragStartWidth = width
                    }
                    let proposed = (dragStartWidth ?? width) + value.translation.width
                    width = min(maxWidth, max(minWidth, proposed))
                }
                .onEnded { _ in
                    dragStartWidth = nil
                }
        )
    }
}

private struct SiteSidebar: View {
    @Binding var catalog: SiteCatalog
    let mode: SidebarMode
    let addSite: () -> Void
    let editSite: (PortalSite) -> Void
    let toggleMode: () -> Void

    var body: some View {
        Group {
            switch mode {
            case .expanded:
                ExpandedSidebar(
                    catalog: $catalog,
                    addSite: addSite,
                    editSite: editSite,
                    toggleMode: toggleMode
                )
            case .rail:
                RailSidebar(
                    catalog: $catalog,
                    addSite: addSite,
                    editSite: editSite,
                    toggleMode: toggleMode
                )
            }
        }
        .background(SidebarBackground())
    }
}

private struct ExpandedSidebar: View {
    @Binding var catalog: SiteCatalog
    let addSite: () -> Void
    let editSite: (PortalSite) -> Void
    let toggleMode: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                SidebarIconButton(
                    systemName: "sidebar.left",
                    help: "Collapse to Rail  ⌃⌘S",
                    action: toggleMode
                )

                Spacer()

                Text("Open Sesame")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)

                Spacer()

                SidebarIconButton(
                    systemName: "plus",
                    help: "Add Site  ⌘N",
                    action: addSite
                )
            }
            .padding(.horizontal, 10)
            .padding(.top, 12)
            .padding(.bottom, 10)

            Divider()
                .opacity(0.5)

            List(selection: selectionBinding) {
                Section {
                    ForEach(catalog.sites) { site in
                        SiteRow(site: site)
                            .tag(site.id)
                            .listRowSeparator(.hidden)
                            .contextMenu {
                                Button {
                                    editSite(site)
                                } label: {
                                    Label("Edit", systemImage: "pencil")
                                }

                                if !site.isPinned {
                                    Divider()
                                    Button(role: .destructive) {
                                        catalog.removeSite(withID: site.id)
                                    } label: {
                                        Label("Remove", systemImage: "trash")
                                    }
                                }
                            }
                    }
                } header: {
                    Text("Sites")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .textCase(nil)
                        .padding(.leading, 2)
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
        }
    }

    private var selectionBinding: Binding<PortalSite.ID?> {
        Binding(
            get: { catalog.selectedSite?.id },
            set: { id in
                guard let id else {
                    return
                }

                catalog.selectSite(withID: id)
            }
        )
    }
}

private struct RailSidebar: View {
    @Binding var catalog: SiteCatalog
    let addSite: () -> Void
    let editSite: (PortalSite) -> Void
    let toggleMode: () -> Void

    var body: some View {
        VStack(spacing: 6) {
            SidebarIconButton(
                systemName: "sidebar.left",
                help: "Expand Sidebar  ⌃⌘S",
                action: toggleMode
            )
            .padding(.top, 12)
            .padding(.bottom, 6)

            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 4) {
                    ForEach(catalog.sites) { site in
                        RailSiteRow(
                            site: site,
                            isSelected: catalog.selectedSite?.id == site.id,
                            onTap: { catalog.selectSite(withID: site.id) },
                            onEdit: { editSite(site) },
                            onRemove: site.isPinned ? nil : { catalog.removeSite(withID: site.id) }
                        )
                    }
                }
                .padding(.horizontal, 4)
            }

            Spacer(minLength: 0)

            SidebarIconButton(
                systemName: "plus",
                help: "Add Site  ⌘N",
                action: addSite
            )
            .padding(.bottom, 10)
        }
    }
}

private struct RailSiteRow: View {
    let site: PortalSite
    let isSelected: Bool
    let onTap: () -> Void
    let onEdit: () -> Void
    let onRemove: (() -> Void)?

    @State private var isHovered: Bool = false

    var body: some View {
        ZStack(alignment: .leading) {
            Button(action: onTap) {
                ZStack {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(rowFill)
                        .frame(width: 40, height: 40)

                    SiteAvatar(name: site.name)

                    if site.isPinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 7, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(2)
                            .background(Circle().fill(Color.secondary))
                            .rotationEffect(.degrees(45))
                            .offset(x: 12, y: -12)
                    }
                }
                .contentShape(RoundedRectangle(cornerRadius: 9))
            }
            .buttonStyle(.plain)
            .help(site.name)
            .contextMenu {
                Button {
                    onEdit()
                } label: {
                    Label("Edit", systemImage: "pencil")
                }

                if let onRemove {
                    Divider()
                    Button(role: .destructive, action: onRemove) {
                        Label("Remove", systemImage: "trash")
                    }
                }
            }

            if isHovered {
                NameTag(name: site.name, label: site.label)
                    .offset(x: railWidth - 4, y: 0)
                    .allowsHitTesting(false)
                    .transition(.opacity.combined(with: .offset(x: -4, y: 0)))
            }
        }
        .frame(width: 48, height: 44)
        .onHover { hovering in
            withAnimation(.easeOut(duration: 0.12)) {
                isHovered = hovering
            }
        }
        .zIndex(isHovered ? 1 : 0)
    }

    private var rowFill: Color {
        if isSelected {
            return Color.accentColor.opacity(0.22)
        }
        if isHovered {
            return Color.primary.opacity(0.06)
        }
        return Color.clear
    }
}

private struct NameTag: View {
    let name: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(name)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.primary)

            if !label.isEmpty {
                Text(label)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(.regularMaterial)
                .shadow(color: .black.opacity(0.18), radius: 6, x: 0, y: 2)
        )
        .fixedSize()
    }
}

private struct SidebarIconButton: View {
    let systemName: String
    let help: String
    let action: () -> Void

    @State private var isHovering: Bool = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 12, weight: .semibold))
                .frame(width: 24, height: 24)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(isHovering ? Color.primary.opacity(0.08) : Color.clear)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .help(help)
    }
}

private struct ChromeIconButton: View {
    let systemName: String
    let help: String
    let isEnabled: Bool
    let action: () -> Void

    @State private var isHovering: Bool = false

    init(systemName: String, help: String, isEnabled: Bool = true, action: @escaping () -> Void) {
        self.systemName = systemName
        self.help = help
        self.isEnabled = isEnabled
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 13, weight: .semibold))
                .frame(width: 26, height: 26)
                .foregroundStyle(isEnabled ? Color.primary : Color.secondary.opacity(0.5))
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill((isHovering && isEnabled) ? Color.primary.opacity(0.08) : Color.clear)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .onHover { isHovering = $0 }
        .help(help)
    }
}

private struct SidebarBackground: View {
    var body: some View {
        ZStack {
            Color(nsColor: .underPageBackgroundColor)
            LinearGradient(
                colors: [
                    Color.white.opacity(0.04),
                    Color.clear
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
    }
}

private struct SiteRow: View {
    let site: PortalSite

    var body: some View {
        HStack(spacing: 10) {
            SiteAvatar(name: site.name)

            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(site.name)
                        .font(.system(size: 13, weight: .medium))
                        .lineLimit(1)

                    if site.isPinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 8, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .rotationEffect(.degrees(45))
                    }
                }

                if !site.label.isEmpty {
                    Text(site.label)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 3)
    }
}

private struct SiteAvatar: View {
    let name: String

    private var initial: String {
        name.first.map { String($0).uppercased() } ?? "?"
    }

    private var tint: Color {
        let palette: [Color] = [.blue, .purple, .pink, .orange, .green, .teal, .indigo, .mint]
        let hash = abs(name.hashValue)
        return palette[hash % palette.count]
    }

    var body: some View {
        RoundedRectangle(cornerRadius: 7, style: .continuous)
            .fill(tint.opacity(0.22))
            .overlay(
                Text(initial)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(tint)
            )
            .frame(width: 28, height: 28)
    }
}

private struct BrowserChrome: View {
    let site: PortalSite?
    @ObservedObject var controller: BrowserController
    let hasHome: Bool
    let reload: () -> Void
    let goHome: () -> Void
    let openExternally: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            TrafficLights()
                .padding(.trailing, 4)

            ChromeIconButton(
                systemName: "chevron.left",
                help: "Back  ⌘[",
                isEnabled: controller.canGoBack,
                action: { controller.goBack() }
            )
            .keyboardShortcut("[", modifiers: .command)

            ChromeIconButton(
                systemName: "chevron.right",
                help: "Forward  ⌘]",
                isEnabled: controller.canGoForward,
                action: { controller.goForward() }
            )
            .keyboardShortcut("]", modifiers: .command)

            ChromeIconButton(
                systemName: "house",
                help: "Home  ⌘⇧H",
                isEnabled: hasHome,
                action: goHome
            )
            .keyboardShortcut("h", modifiers: [.command, .shift])

            ChromeIconButton(
                systemName: "arrow.clockwise",
                help: "Reload  ⌘R",
                action: reload
            )
            .keyboardShortcut("r", modifiers: .command)

            VStack(alignment: .leading, spacing: 2) {
                Text(site?.name ?? "Open Sesame")
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)

                Text(displayURL)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .padding(.leading, 6)

            Spacer()

            ChromeIconButton(
                systemName: "arrow.up.right.square",
                help: "Open in Browser",
                isEnabled: site != nil,
                action: openExternally
            )
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(nsColor: .controlBackgroundColor))
    }

    private var displayURL: String {
        controller.currentURL?.absoluteString ?? site?.url.absoluteString ?? "No URL"
    }
}

private struct TrafficLights: View {
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(Color(red: 1.0, green: 0.37, blue: 0.34))
            Circle().fill(Color(red: 1.0, green: 0.74, blue: 0.18))
            Circle().fill(Color(red: 0.16, green: 0.78, blue: 0.25))
        }
        .frame(width: 52, height: 12)
    }
}

private struct SiteSheet: View {
    let target: SiteSheetTarget
    let onAdd: (PortalSite) -> Void
    let onUpdate: (PortalSite) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var label: String
    @State private var urlString: String
    @State private var errorMessage: String?
    @FocusState private var focusedField: Field?

    private enum Field {
        case name, label, url
    }

    init(
        target: SiteSheetTarget,
        onAdd: @escaping (PortalSite) -> Void,
        onUpdate: @escaping (PortalSite) -> Void
    ) {
        self.target = target
        self.onAdd = onAdd
        self.onUpdate = onUpdate

        switch target {
        case .add:
            _name = State(initialValue: "")
            _label = State(initialValue: "")
            _urlString = State(initialValue: "https://")
        case .edit(let site):
            _name = State(initialValue: site.name)
            _label = State(initialValue: site.label)
            _urlString = State(initialValue: site.url.absoluteString)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 10) {
                fieldLabel("Name")
                TextField("OpenCoven", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .focused($focusedField, equals: .name)
                    .onSubmit { focusedField = .label }

                fieldLabel("Label")
                TextField("Home (optional)", text: $label)
                    .textFieldStyle(.roundedBorder)
                    .focused($focusedField, equals: .label)
                    .onSubmit { focusedField = .url }

                fieldLabel("URL")
                TextField("https://example.com", text: $urlString)
                    .textFieldStyle(.roundedBorder)
                    .focused($focusedField, equals: .url)
                    .onSubmit { submit() }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.system(size: 11))
                    .foregroundStyle(.red)
            }

            HStack {
                if case .edit(let site) = target, site.isPinned {
                    HStack(spacing: 4) {
                        Image(systemName: "pin.fill")
                            .rotationEffect(.degrees(45))
                        Text("Pinned — cannot be removed")
                    }
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                }

                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)

                Button(actionTitle) { submit() }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(!isFormValid)
            }
        }
        .padding(20)
        .frame(width: 400)
        .onAppear {
            DispatchQueue.main.async {
                focusedField = .name
            }
        }
    }

    private var title: String {
        switch target {
        case .add: return "Add Site"
        case .edit: return "Edit Site"
        }
    }

    private var subtitle: String {
        switch target {
        case .add: return "Pin any HTTP or HTTPS site to the sidebar."
        case .edit: return "Update the name, label, or URL."
        }
    }

    private var actionTitle: String {
        switch target {
        case .add: return "Add"
        case .edit: return "Save"
        }
    }

    private var isFormValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && !urlString.trimmingCharacters(in: .whitespaces).isEmpty
    }

    @ViewBuilder
    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(.secondary)
    }

    private func submit() {
        do {
            switch target {
            case .add:
                let site = try PortalSite(name: name, label: label, urlString: urlString)
                onAdd(site)
            case .edit(let existing):
                let updated = try PortalSite(
                    id: existing.id,
                    name: name,
                    label: label,
                    urlString: urlString,
                    isPinned: existing.isPinned
                )
                onUpdate(updated)
            }
            dismiss()
        } catch let error as PortalSite.ValidationError {
            switch error {
            case .missingName:
                errorMessage = "Please enter a name."
                focusedField = .name
            case .missingURL:
                errorMessage = "Please enter a valid URL."
                focusedField = .url
            case .unsupportedScheme(let scheme):
                errorMessage = "Only http and https are supported (got \(scheme ?? "no scheme"))."
                focusedField = .url
            }
        } catch {
            errorMessage = "Could not save site."
        }
    }
}
