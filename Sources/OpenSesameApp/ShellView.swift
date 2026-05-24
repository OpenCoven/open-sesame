import AppKit
import OpenSesameCore
import SwiftUI

// MARK: - Window drag area

/// A transparent NSView that acts as a drag handle for the frameless window.
/// Place it behind any header area where you want the user to be able to
/// drag the window by clicking and dragging.
private struct WindowDragArea: NSViewRepresentable {
    func makeNSView(context: Context) -> DraggableView { DraggableView() }
    func updateNSView(_ nsView: DraggableView, context: Context) {}

    final class DraggableView: NSView {
        override var mouseDownCanMoveWindow: Bool { true }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { false }
    }
}

/// Captures a reference to the hosting NSWindow so we can toggle native
/// chrome (traffic lights) in response to SwiftUI state.
private struct WindowAccessor: NSViewRepresentable {
    let onWindow: (NSWindow?) -> Void

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async { [weak view] in
            onWindow(view?.window)
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}

private enum SidebarMode {
    case expanded
    case rail
}

private let railWidth: CGFloat = 60

@discardableResult
private func dropSitesBefore(
    _ payloads: [String],
    target: PortalSite.ID,
    in catalog: Binding<SiteCatalog>
) -> Bool {
    var moved = false
    for payload in payloads {
        guard let uuid = UUID(uuidString: payload),
              uuid != target,
              catalog.wrappedValue.findSite(withID: uuid) != nil else { continue }
        catalog.wrappedValue.moveSite(uuid, before: target)
        moved = true
    }
    return moved
}

/// Returns true when a site was seeded from the curated defaults and should
/// not be removable via the sidebar close button (only via Settings).
private func isDefaultSite(_ site: PortalSite) -> Bool {
    CuratedCatalog.defaultApps.contains { $0.normalizedURL == site.url.absoluteString }
}

struct ShellView: View {
    @Binding var catalog: SiteCatalog
    @State private var reloadToken = UUID()
    @State private var sidebarMode: SidebarMode = .expanded
    @State private var sidebarWidth: CGFloat = 240
    @State private var siteSheet: SiteSheetTarget?
    @State private var siteSheetInitialGroupID: SiteGroup.ID?
    @State private var showingSettings: Bool = false
    @StateObject private var controller = BrowserController()
    @StateObject private var appearance = AppearanceSettings()
    @StateObject private var favicons = FaviconService.shared
    @State private var hostingWindow: NSWindow?

    private static let minSidebarWidth: CGFloat = 180
    private static let maxSidebarWidth: CGFloat = 600
    private static let sidebarAnimation: Animation = .spring(response: 0.32, dampingFraction: 0.86)

    var body: some View {
        HStack(spacing: 0) {
            SiteSidebar(
                catalog: $catalog,
                mode: sidebarMode,
                appearance: appearance,
                addSite: { presentAddSite(toGroup: nil) },
                addSiteToGroup: { groupID in presentAddSite(toGroup: groupID) },
                selectSite: selectOrHome,
                editSite: presentEditSite,
                openSettings: { showingSettings = true },
                toggleMode: toggleSidebar
            )
            .frame(width: sidebarMode == .expanded ? sidebarWidth : railWidth)
            .clipShape(
                UnevenRoundedRectangle(
                    topLeadingRadius: 0,
                    bottomLeadingRadius: 18,
                    bottomTrailingRadius: 0,
                    topTrailingRadius: 0,
                    style: .continuous
                )
            )
            .overlay(
                UnevenRoundedRectangle(
                    topLeadingRadius: 0,
                    bottomLeadingRadius: 18,
                    bottomTrailingRadius: 0,
                    topTrailingRadius: 0,
                    style: .continuous
                )
                .strokeBorder(Color.white.opacity(0.07), lineWidth: 0.5)
            )
            .zIndex(1)

            if sidebarMode == .expanded {
                SidebarResizeHandle(
                    width: $sidebarWidth,
                    minWidth: Self.minSidebarWidth,
                    maxWidth: Self.maxSidebarWidth
                )
            } else {
                Divider().opacity(0.6)
            }

            VStack(spacing: 0) {
                BrowserChrome(
                    site: catalog.selectedSite,
                    controller: controller,
                    reload: reload,
                    openExternally: openSelectedSite,
                    openSettings: { showingSettings = true }
                )

                Divider()

                if let site = catalog.selectedSite {
                    BrowserPane(
                        site: site,
                        reloadToken: reloadToken,
                        controller: controller
                    )
                    .id(site.id)
                } else {
                    EmptyState(
                        catalog: $catalog,
                        addSite: { presentAddSite(toGroup: nil) }
                    )
                }
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .background(WindowAccessor { window in
            hostingWindow = window
            applyTrafficLightVisibility(to: window, mode: sidebarMode)
        })
        .onChange(of: sidebarMode) { _, mode in
            applyTrafficLightVisibility(to: hostingWindow, mode: mode)
        }
        .environmentObject(appearance)
        .sheet(item: $siteSheet) { target in
            SiteSheet(
                target: target,
                availableGroups: catalog.groups,
                initialGroupID: siteSheetInitialGroupID,
                onAdd: { site, groupID in
                    if let groupID {
                        catalog.addSite(site, toGroupID: groupID)
                    } else {
                        catalog.addSite(site)
                    }
                    catalog.selectSite(withID: site.id)
                    Task { await refreshFavicon(for: site) }
                },
                onUpdate: { updated, previousGroupID, newGroupID in
                    catalog.updateSite(updated)
                    if previousGroupID != newGroupID {
                        if let newGroupID {
                            catalog.moveSite(updated.id, intoGroup: newGroupID)
                        } else {
                            catalog.moveSiteToRoot(updated.id)
                        }
                    }
                    Task { await refreshFavicon(for: updated) }
                }
            )
        }
        .sheet(isPresented: $showingSettings) {
            SettingsSheet(catalog: $catalog, appearance: appearance)
        }
        .task {
            await refreshAllFavicons()
        }
        .onDeleteCommand {
            guard let site = catalog.selectedSite, !isDefaultSite(site) else { return }
            catalog.removeSite(withID: site.id)
        }
        .onChange(of: catalog.sites.map(\.id)) { _, _ in
            Task { await refreshAllFavicons() }
        }
    }

    // MARK: - Actions

    private func toggleSidebar() {
        withAnimation(Self.sidebarAnimation) {
            sidebarMode = (sidebarMode == .expanded) ? .rail : .expanded
        }
    }

    private func applyTrafficLightVisibility(to window: NSWindow?, mode: SidebarMode) {
        guard let window else { return }
        let hidden = (mode == .rail)
        window.standardWindowButton(.closeButton)?.isHidden = hidden
        window.standardWindowButton(.miniaturizeButton)?.isHidden = hidden
        window.standardWindowButton(.zoomButton)?.isHidden = hidden
    }

    private func reload() {
        reloadToken = UUID()
    }

    private func openSelectedSite() {
        guard let url = catalog.selectedSite?.url else { return }
        NSWorkspace.shared.open(url)
    }

    private func presentAddSite(toGroup groupID: SiteGroup.ID?) {
        siteSheetInitialGroupID = groupID
        siteSheet = .add
    }

    private func presentEditSite(_ site: PortalSite) {
        siteSheet = .edit(site)
    }

    /// Selects the site if it isn't already current; otherwise re-loads its
    /// configured URL in the existing WebView so clicking an already-active
    /// tab returns to that tab's home.
    private func selectOrHome(_ site: PortalSite) {
        if catalog.selectedSite?.id == site.id {
            controller.load(site.url)
        } else {
            catalog.selectSite(withID: site.id)
        }
    }

    // MARK: - Favicons

    private func refreshAllFavicons() async {
        for site in catalog.sites {
            // Bundled-override hosts are authoritative — keep stored iconData
            // in sync with the current bundled bytes (e.g. when we ship a new
            // GitHub icon, pre-existing sites pick it up on next launch).
            if let bundled = FaviconService.bundledIconData(forHost: site.url.host ?? ""),
               site.iconData != bundled {
                catalog.updateIconData(bundled, forSiteWithID: site.id)
                continue
            }
            if site.iconData == nil {
                await refreshFavicon(for: site)
            }
        }
    }

    private func refreshFavicon(for site: PortalSite) async {
        guard site.iconData == nil else { return }
        guard let data = await favicons.icon(for: site.url) else { return }
        catalog.updateIconData(data, forSiteWithID: site.id)
    }
}

// MARK: - Sidebar

private struct SiteSidebar: View {
    @Binding var catalog: SiteCatalog
    let mode: SidebarMode
    @ObservedObject var appearance: AppearanceSettings
    let addSite: () -> Void
    let addSiteToGroup: (SiteGroup.ID) -> Void
    let selectSite: (PortalSite) -> Void
    let editSite: (PortalSite) -> Void
    let openSettings: () -> Void
    let toggleMode: () -> Void

    var body: some View {
        ZStack {
            VisualEffectBackground()
            if appearance.radialBlurEnabled {
                RadialBlurOverlay(radius: appearance.radialBlurIntensity)
            }

            Group {
                switch mode {
                case .expanded:
                    ExpandedSidebar(
                        catalog: $catalog,
                        addSite: addSite,
                        addSiteToGroup: addSiteToGroup,
                        selectSite: selectSite,
                        editSite: editSite,
                        openSettings: openSettings,
                        toggleMode: toggleMode
                    )
                case .rail:
                    RailSidebar(
                        catalog: $catalog,
                        addSite: addSite,
                        selectSite: selectSite,
                        editSite: editSite,
                        toggleMode: toggleMode
                    )
                }
            }
        }
    }
}

// MARK: - Expanded sidebar

private struct ExpandedSidebar: View {
    @Binding var catalog: SiteCatalog
    let addSite: () -> Void
    let addSiteToGroup: (SiteGroup.ID) -> Void
    let selectSite: (PortalSite) -> Void
    let editSite: (PortalSite) -> Void
    let openSettings: () -> Void
    let toggleMode: () -> Void

    @State private var hoveredID: PortalSite.ID?

    var body: some View {
        VStack(spacing: 0) {
            SidebarHeader(
                primaryIcon: "sidebar.left",
                primaryHelp: "Collapse to Rail  ⌘B",
                primaryAction: toggleMode,
                primaryShortcut: KeyboardShortcut("b", modifiers: .command),
                secondaryIcon: "plus",
                secondaryHelp: "Add Site  ⌘N",
                secondaryAction: addSite,
                openSettings: openSettings
            )

            Divider().opacity(0.4)

            List {
                ForEach(catalog.entries, id: \.id) { entry in
                    Group {
                        switch entry {
                        case .site(let site):
                            ExpandedSiteRow(
                                site: site,
                                isSelected: catalog.selectedSite?.id == site.id,
                                isHovered: hoveredID == site.id,
                                onSelect: { selectSite(site) },
                                onHover: { hover in hoveredID = hover ? site.id : (hoveredID == site.id ? nil : hoveredID) },
                                onDropBefore: { dropSitesBefore($0, target: site.id, in: $catalog) },
                                onEdit: { editSite(site) },
                                onRemove: isDefaultSite(site) ? nil : { catalog.removeSite(withID: site.id) }
                            )
                            .listRowSeparator(.hidden)
                            .listRowInsets(.init(top: 1, leading: 0, bottom: 1, trailing: 0))
                            .listRowBackground(Color.clear)

                        case .group(let group):
                            ExpandedGroupRow(
                                group: group,
                                catalog: $catalog,
                                hoveredID: $hoveredID,
                                selectSite: selectSite,
                                editSite: editSite,
                                addSiteToGroup: { addSiteToGroup(group.id) }
                            )
                            .listRowSeparator(.hidden)
                            .listRowInsets(.init(top: 1, leading: 0, bottom: 1, trailing: 0))
                            .listRowBackground(Color.clear)
                        }
                    }
                }
                .onMove { source, destination in
                    catalog.moveRootEntries(fromOffsets: source, toOffset: destination)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .dropDestination(for: String.self) { strings, _ in
                var moved = false
                for payload in strings {
                    guard let uuid = UUID(uuidString: payload),
                          catalog.findSite(withID: uuid) != nil,
                          catalog.groupID(containingSite: uuid) != nil else { continue }
                    catalog.moveSiteToRoot(uuid)
                    moved = true
                }
                return moved
            }

            SidebarBrandFooter()
        }
    }

}

private struct ExpandedSiteRow: View {
    let site: PortalSite
    let isSelected: Bool
    let isHovered: Bool
    let onSelect: () -> Void
    let onHover: (Bool) -> Void
    let onDropBefore: ([String]) -> Bool
    var onEdit: (() -> Void)? = nil
    var onRemove: (() -> Void)? = nil

    @EnvironmentObject private var appearance: AppearanceSettings
    @State private var isDropTargeted: Bool = false

    var body: some View {
        HStack(spacing: 10) {
            FaviconView(site: site, size: 18)

            Text(site.name)
                .font(.system(size: 13, weight: .medium))
                .lineLimit(1)
            Spacer(minLength: 0)

            if let onRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.secondary)
                        .frame(width: 16, height: 16)
                        .background(Circle().fill(Color.white.opacity(0.12)))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .help("Remove Site")
                .opacity(isHovered ? 1 : 0)
                .animation(.easeOut(duration: 0.1), value: isHovered)
                .padding(.trailing, 2)
            }
        }
        .padding(.vertical, appearance.rowVerticalPadding)
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(rowBackground)
        .overlay {
            if isDropTargeted {
                Rectangle()
                    .stroke(Color.accentColor, lineWidth: 2)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
        .onHover(perform: onHover)
        .contextMenu {
            if let onEdit {
                Button(action: onEdit) {
                    Label("Edit Site", systemImage: "pencil")
                }
            }
            if onEdit != nil && onRemove != nil { Divider() }
            if let onRemove {
                Button(role: .destructive, action: onRemove) {
                    Label("Remove Site", systemImage: "trash")
                }
            }
        }
        .draggable(site.id.uuidString) {
            HStack(spacing: 8) {
                FaviconView(site: site, size: 18)
                Text(site.name).font(.system(size: 12, weight: .semibold))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .dropDestination(for: String.self) { strings, _ in
            onDropBefore(strings)
        } isTargeted: { isDropTargeted = $0 }
    }

    private var rowBackground: some View {
        Rectangle()
            .fill(rowFill)
    }

    private var rowFill: Color {
        if isSelected { return Color.accentColor.opacity(0.22) }
        if isHovered { return Color.black.opacity(0.32) }
        return Color.black.opacity(0.22)
    }
}

private struct ExpandedGroupRow: View {
    let group: SiteGroup
    @Binding var catalog: SiteCatalog
    @Binding var hoveredID: PortalSite.ID?
    let selectSite: (PortalSite) -> Void
    let editSite: (PortalSite) -> Void
    let addSiteToGroup: () -> Void

    @EnvironmentObject private var appearance: AppearanceSettings
    @State private var isDropTargeted: Bool = false
    @State private var isHovered: Bool = false

    var body: some View {
        DisclosureGroup(
            isExpanded: collapsedBinding
        ) {
            ForEach(group.sites) { site in
                ExpandedSiteRow(
                    site: site,
                    isSelected: catalog.selectedSite?.id == site.id,
                    isHovered: hoveredID == site.id,
                    onSelect: { selectSite(site) },
                    onHover: { hover in
                        hoveredID = hover ? site.id : (hoveredID == site.id ? nil : hoveredID)
                    },
                    onDropBefore: { dropSitesBefore($0, target: site.id, in: $catalog) },
                    onEdit: { editSite(site) },
                    onRemove: isDefaultSite(site) ? nil : { catalog.removeSite(withID: site.id) }
                )
            }
            .onMove { source, destination in
                catalog.moveSitesInGroup(group.id, fromOffsets: source, toOffset: destination)
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: group.isCollapsed ? "chevron.right" : "chevron.down")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 10)

                Text(group.name.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(isDropTargeted ? Color.accentColor : .secondary)
                    .lineLimit(1)

                Spacer(minLength: 0)

                if group.isCollapsed {
                    Text("\(group.sites.count)")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
            .padding(.vertical, 4)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(headerBackground)
            .overlay(alignment: .bottom) {
                if isDropTargeted {
                    Rectangle()
                        .fill(Color.accentColor)
                        .frame(height: 2)
                }
            }
            .contentShape(Rectangle())
            .onHover { isHovered = $0 }
            .dropDestination(for: String.self) { strings, _ in
                handleDrop(strings)
            } isTargeted: { isDropTargeted = $0 }
        }
        .disclosureGroupStyle(PlainDisclosureStyle())
    }

    private var headerBackground: some View {
        Rectangle()
            .fill(isHovered ? Color.black.opacity(0.32) : Color.clear)
    }

    private func handleDrop(_ payloads: [String]) -> Bool {
        var moved = false
        for payload in payloads {
            guard let uuid = UUID(uuidString: payload),
                  catalog.findSite(withID: uuid) != nil else { continue }
            catalog.moveSite(uuid, intoGroup: group.id)
            moved = true
        }
        return moved
    }

    private var collapsedBinding: Binding<Bool> {
        Binding(
            get: { !group.isCollapsed },
            set: { newValue in
                if (newValue && group.isCollapsed) || (!newValue && !group.isCollapsed) {
                    catalog.toggleGroupCollapsed(withID: group.id)
                }
            }
        )
    }
}

/// A DisclosureGroupStyle that suppresses the built-in chevron and lets the
/// custom label own the entire row (including its own expansion indicator).
/// Tap on the label toggles `isExpanded`.
private struct PlainDisclosureStyle: DisclosureGroupStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
                    configuration.isExpanded.toggle()
                }
            } label: {
                configuration.label
            }
            .buttonStyle(.plain)

            if configuration.isExpanded {
                configuration.content
            }
        }
    }
}

// MARK: - Rail sidebar

private struct RailSidebar: View {
    @Binding var catalog: SiteCatalog
    let addSite: () -> Void
    let selectSite: (PortalSite) -> Void
    let editSite: (PortalSite) -> Void
    let toggleMode: () -> Void

    @State private var hoveredID: PortalSite.ID?

    var body: some View {
        VStack(spacing: 4) {
            // Collapsed header: traffic lights are hidden at the window level,
            // so the rail only shows the toggle icon. The strip behind the
            // button stays draggable so users can still move the window.
            HStack(spacing: 0) {
                Spacer(minLength: 0)
                SidebarIconButton(
                    systemName: "sidebar.left",
                    help: "Expand Sidebar  ⌘B",
                    action: toggleMode
                )
                .keyboardShortcut("b", modifiers: .command)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 38)
            .background(WindowDragArea())

            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 4) {
                    ForEach(catalog.entries, id: \.id) { entry in
                        switch entry {
                        case .site(let site):
                            RailSiteRow(
                                site: site,
                                isSelected: catalog.selectedSite?.id == site.id,
                                isHovered: hoveredID == site.id,
                                onTap: { selectSite(site) },
                                onHover: { hover in
                                    hoveredID = hover ? site.id : (hoveredID == site.id ? nil : hoveredID)
                                },
                                onDropBefore: { dropSitesBefore($0, target: site.id, in: $catalog) },
                                onEdit: { editSite(site) },
                                onRemove: isDefaultSite(site) ? nil : { catalog.removeSite(withID: site.id) }
                            )
                        case .group(let group):
                            RailGroup(
                                group: group,
                                catalog: $catalog,
                                hoveredID: $hoveredID,
                                selectSite: selectSite,
                                editSite: editSite
                            )
                        }
                    }
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
            }
            .dropDestination(for: String.self) { strings, _ in
                var moved = false
                for payload in strings {
                    guard let uuid = UUID(uuidString: payload),
                          catalog.findSite(withID: uuid) != nil,
                          catalog.groupID(containingSite: uuid) != nil else { continue }
                    catalog.moveSiteToRoot(uuid)
                    moved = true
                }
                return moved
            }

            Spacer(minLength: 0)

            VStack(spacing: 4) {
                SidebarIconButton(
                    systemName: "plus",
                    help: "Add Site  ⌘N",
                    action: addSite
                )
            }
            .padding(.bottom, 4)

            RailBrandFooter()
                .padding(.bottom, 8)
        }
    }
}

private struct RailSiteRow: View {
    let site: PortalSite
    let isSelected: Bool
    let isHovered: Bool
    let onTap: () -> Void
    let onHover: (Bool) -> Void
    let onDropBefore: ([String]) -> Bool
    var onEdit: (() -> Void)? = nil
    var onRemove: (() -> Void)? = nil

    @State private var isDropTargeted: Bool = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(rowFill)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(strokeColor, lineWidth: 0.5)
                )
                .frame(width: 44, height: 44)

            FaviconView(site: site, size: 28)
        }
        .overlay(alignment: .top) {
            if isDropTargeted {
                Capsule()
                    .fill(Color.accentColor)
                    .frame(width: 32, height: 2)
                    .offset(y: -3)
            }
        }
        .overlay(alignment: .topTrailing) {
            if let onRemove, isHovered {
                Button(action: onRemove) {
                    Image(systemName: "xmark")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundStyle(.secondary)
                        .frame(width: 14, height: 14)
                        .background(Circle().fill(Color(nsColor: .windowBackgroundColor).opacity(0.88)))
                        .overlay(Circle().strokeBorder(Color.white.opacity(0.1), lineWidth: 0.5))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .help("Remove Site")
                .transition(.opacity)
                .offset(x: 2, y: -2)
            }
        }
        .animation(.easeOut(duration: 0.1), value: isHovered)
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .frame(width: 48, height: 48)
        .help(site.name)
        .onTapGesture(perform: onTap)
        .onHover(perform: onHover)
        .draggable(site.id.uuidString) {
            FaviconView(site: site, size: 28)
                .padding(6)
                .background(.regularMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .dropDestination(for: String.self) { strings, _ in
            onDropBefore(strings)
        } isTargeted: { isDropTargeted = $0 }
        .contextMenu {
            if let onEdit {
                Button(action: onEdit) {
                    Label("Edit Site", systemImage: "pencil")
                }
            }
            if onEdit != nil && onRemove != nil { Divider() }
            if let onRemove {
                Button(role: .destructive, action: onRemove) {
                    Label("Remove Site", systemImage: "trash")
                }
            }
        }
    }

    private var rowFill: Color {
        if isSelected { return Color.accentColor.opacity(0.22) }
        if isHovered { return Color.black.opacity(0.32) }
        return Color.black.opacity(0.22)
    }

    private var strokeColor: Color {
        if isSelected { return Color.accentColor.opacity(0.5) }
        return Color.white.opacity(0.06)
    }
}

private struct RailGroup: View {
    let group: SiteGroup
    @Binding var catalog: SiteCatalog
    @Binding var hoveredID: PortalSite.ID?
    let selectSite: (PortalSite) -> Void
    let editSite: (PortalSite) -> Void

    @State private var isDropTargeted: Bool = false
    @State private var isContainerHovered: Bool = false

    private var isCollapsed: Bool { group.isCollapsed }

    var body: some View {
        Group {
            if isCollapsed {
                closedBody
            } else {
                openBody
            }
        }
        .padding(.vertical, 1)
        .dropDestination(for: String.self) { strings, _ in
            var moved = false
            for payload in strings {
                guard let uuid = UUID(uuidString: payload),
                      catalog.findSite(withID: uuid) != nil else { continue }
                catalog.moveSite(uuid, intoGroup: group.id)
                moved = true
            }
            return moved
        } isTargeted: { isDropTargeted = $0 }
    }

    private var openBody: some View {
        VStack(spacing: 2) {
            ForEach(group.sites) { site in
                RailSiteRow(
                    site: site,
                    isSelected: catalog.selectedSite?.id == site.id,
                    isHovered: hoveredID == site.id,
                    onTap: { selectSite(site) },
                    onHover: { hover in
                        hoveredID = hover ? site.id : (hoveredID == site.id ? nil : hoveredID)
                    },
                    onDropBefore: { dropSitesBefore($0, target: site.id, in: $catalog) },
                    onEdit: { editSite(site) },
                    onRemove: isDefaultSite(site) ? nil : { catalog.removeSite(withID: site.id) }
                )
            }
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(containerFill)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(containerStroke, lineWidth: 0.5)
                )
        )
        .overlay(alignment: .topTrailing) {
            if isContainerHovered {
                Button(action: toggleCollapsed) {
                    Image(systemName: "chevron.up")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.secondary)
                        .padding(3)
                        .background(.regularMaterial, in: Circle())
                }
                .buttonStyle(.plain)
                .help("Collapse \(group.name)")
                .padding(3)
            }
        }
        .onHover { isContainerHovered = $0 }
        .contextMenu {
            Button(action: toggleCollapsed) {
                Label("Collapse Folder", systemImage: "chevron.up")
            }
            Divider()
            Button(role: .destructive) {
                catalog.removeGroup(withID: group.id)
            } label: { Label("Remove Folder", systemImage: "trash") }
        }
    }

    private var closedBody: some View {
        Button(action: toggleCollapsed) {
            ZStack {
                FolderShape()
                    .fill(closedFill)
                    .overlay(
                        FolderShape()
                            .stroke(closedStroke, lineWidth: 0.5)
                    )

                FolderContentsPreview(sites: group.sites)
                    .padding(.top, 8)
                    .padding(.horizontal, 6)
                    .padding(.bottom, 4)
            }
            .frame(height: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(group.name)
        .contextMenu {
            Button(action: toggleCollapsed) {
                Label("Open Folder", systemImage: "folder")
            }
            Divider()
            Button(role: .destructive) {
                catalog.removeGroup(withID: group.id)
            } label: { Label("Remove Folder", systemImage: "trash") }
        }
    }

    private var containerFill: Color {
        isDropTargeted ? Color.accentColor.opacity(0.22) : Color.white.opacity(0.04)
    }

    private var containerStroke: Color {
        isDropTargeted ? Color.accentColor.opacity(0.5) : Color.white.opacity(0.06)
    }

    private var closedFill: Color {
        isDropTargeted ? Color.accentColor.opacity(0.22) : Color.black.opacity(0.22)
    }

    private var closedStroke: Color {
        isDropTargeted ? Color.accentColor.opacity(0.5) : Color.white.opacity(0.06)
    }

    private func toggleCollapsed() {
        withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
            catalog.toggleGroupCollapsed(withID: group.id)
        }
    }
}

private struct FolderShape: Shape {
    var tabWidthRatio: CGFloat = 0.5
    var tabHeight: CGFloat = 5
    var cornerRadius: CGFloat = 8
    var notchRadius: CGFloat = 3

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let tabRight = rect.minX + rect.width * tabWidthRatio
        let bodyTop = rect.minY + tabHeight
        let cr = min(cornerRadius, min(rect.width, rect.height) / 2)

        p.move(to: CGPoint(x: rect.minX + cr, y: rect.minY))
        p.addLine(to: CGPoint(x: tabRight - notchRadius, y: rect.minY))
        p.addQuadCurve(
            to: CGPoint(x: tabRight + notchRadius, y: bodyTop),
            control: CGPoint(x: tabRight, y: rect.minY + tabHeight * 0.45)
        )
        p.addLine(to: CGPoint(x: rect.maxX - cr, y: bodyTop))
        p.addArc(
            center: CGPoint(x: rect.maxX - cr, y: bodyTop + cr),
            radius: cr,
            startAngle: .degrees(-90),
            endAngle: .degrees(0),
            clockwise: false
        )
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - cr))
        p.addArc(
            center: CGPoint(x: rect.maxX - cr, y: rect.maxY - cr),
            radius: cr,
            startAngle: .degrees(0),
            endAngle: .degrees(90),
            clockwise: false
        )
        p.addLine(to: CGPoint(x: rect.minX + cr, y: rect.maxY))
        p.addArc(
            center: CGPoint(x: rect.minX + cr, y: rect.maxY - cr),
            radius: cr,
            startAngle: .degrees(90),
            endAngle: .degrees(180),
            clockwise: false
        )
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + cr))
        p.addArc(
            center: CGPoint(x: rect.minX + cr, y: rect.minY + cr),
            radius: cr,
            startAngle: .degrees(180),
            endAngle: .degrees(270),
            clockwise: false
        )
        p.closeSubpath()
        return p
    }
}

private struct FolderContentsPreview: View {
    let sites: [PortalSite]

    var body: some View {
        let display = Array(sites.prefix(4))
        let cellSize: CGFloat = 14
        let spacing: CGFloat = 2

        if display.isEmpty {
            Image(systemName: "tray")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(.tertiary)
        } else if display.count == 1 {
            FaviconView(site: display[0], size: 26)
        } else {
            VStack(spacing: spacing) {
                HStack(spacing: spacing) {
                    cell(at: 0, in: display, size: cellSize)
                    cell(at: 1, in: display, size: cellSize)
                }
                HStack(spacing: spacing) {
                    cell(at: 2, in: display, size: cellSize)
                    cell(at: 3, in: display, size: cellSize)
                }
            }
        }
    }

    @ViewBuilder
    private func cell(at index: Int, in sites: [PortalSite], size: CGFloat) -> some View {
        if index < sites.count {
            FaviconView(site: sites[index], size: size)
        } else {
            Color.clear.frame(width: size, height: size)
        }
    }
}

// MARK: - Resize handle

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
                .fill(isHovering ? Color.accentColor.opacity(0.45) : Color.white.opacity(0.06))
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

// MARK: - Buttons

private struct SidebarHeader: View {
    let primaryIcon: String
    let primaryHelp: String
    let primaryAction: () -> Void
    let primaryShortcut: KeyboardShortcut?
    let secondaryIcon: String
    let secondaryHelp: String
    let secondaryAction: () -> Void
    let openSettings: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            // Traffic-light zone — the system window buttons (close/min/max)
            // float here because of .hiddenTitleBar. We reserve this real
            // estate so controls never overlap them; whole strip is draggable.
            Color.clear
                .frame(width: 72, height: 24)
                .background(WindowDragArea())

            // Sidebar toggle — right of traffic lights
            shortcutButton(
                systemName: primaryIcon,
                help: primaryHelp,
                shortcut: primaryShortcut,
                action: primaryAction
            )

            Spacer()

            // Settings / menu trigger (⋯) — like Dia’s top-right icon
            SidebarIconButton(
                systemName: "ellipsis",
                help: "Settings  ⌘,",
                action: openSettings
            )
            .keyboardShortcut(",", modifiers: .command)

            // Add site
            SidebarIconButton(systemName: secondaryIcon, help: secondaryHelp, action: secondaryAction)
                .padding(.leading, 2)
        }
        .padding(.horizontal, 10)
        .padding(.top, 2)
        .frame(height: 38, alignment: .top)
    }

    @ViewBuilder
    private func shortcutButton(
        systemName: String,
        help: String,
        shortcut: KeyboardShortcut?,
        action: @escaping () -> Void
    ) -> some View {
        if let shortcut {
            SidebarIconButton(systemName: systemName, help: help, action: action)
                .keyboardShortcut(shortcut)
        } else {
            SidebarIconButton(systemName: systemName, help: help, action: action)
        }
    }
}

private struct SidebarBrandFooter: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "key.fill")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.tertiary)
            Text("OPENSESAME")
                .font(.system(size: 9, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 9)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.white.opacity(0.06))
                .frame(height: 0.5)
        }
    }
}

private struct RailBrandFooter: View {
    var body: some View {
        Image(systemName: "key.fill")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(Color.white.opacity(0.06))
                    .frame(height: 0.5)
            }
            .help("OpenSesame")
    }
}

private struct SidebarIconButton: View {
    let systemName: String
    let help: String
    let action: () -> Void
    var size: CGFloat = 24
    var iconSize: CGFloat = 12
    var cornerRadius: CGFloat = 6

    @State private var isHovering: Bool = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: iconSize, weight: .semibold))
                .frame(width: size, height: size)
                .background(
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(isHovering ? Color.black.opacity(0.32) : Color.black.opacity(0.22))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
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
                        .fill(fillColor)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .onHover { isHovering = $0 }
        .help(help)
    }

    private var fillColor: Color {
        guard isEnabled else { return Color.black.opacity(0.12) }
        return isHovering ? Color.black.opacity(0.32) : Color.black.opacity(0.22)
    }
}

// MARK: - Chrome

private struct BrowserChrome: View {
    let site: PortalSite?
    @ObservedObject var controller: BrowserController
    let reload: () -> Void
    let openExternally: () -> Void
    let openSettings: () -> Void

    @ObservedObject private var blockCounter = BlockCounter.shared

    private var isHidden: Bool { controller.chromeHidden }

    var body: some View {
        ZStack {
            VisualEffectBackground(material: .titlebar)

            HStack(spacing: 8) {
                URLBar(site: site, controller: controller)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if blockCounter.count > 0 {
                    BlockCounterPill(count: blockCounter.count) {
                        blockCounter.reset()
                    }
                }

                ChromeIconButton(
                    systemName: "gearshape",
                    help: "Settings  ⌘,",
                    action: openSettings
                )
                .keyboardShortcut(",", modifiers: .command)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .opacity(isHidden ? 0 : 1)

            GeometryReader { proxy in
                Rectangle()
                    .fill(Color.accentColor)
                    .frame(width: proxy.size.width * CGFloat(controller.estimatedProgress), height: 2)
            }
            .frame(height: 2)
            .frame(maxHeight: .infinity, alignment: .bottom)
            .opacity(controller.isLoading ? 1 : 0)
            .allowsHitTesting(false)
            .animation(.easeOut(duration: 0.18), value: controller.estimatedProgress)
            .animation(.easeOut(duration: 0.25), value: controller.isLoading)
        }
        .frame(height: isHidden ? 0 : 36)
        .clipped()
        .animation(.spring(response: 0.28, dampingFraction: 0.86), value: isHidden)
        .background(shortcutShims)
    }

    /// Hidden zero-size Buttons that exist only to host the keyboard shortcuts
    /// for the nav actions we dropped from the visible chrome.
    private var shortcutShims: some View {
        Group {
            Button("Back", action: { controller.goBack() })
                .keyboardShortcut("[", modifiers: .command)
                .disabled(!controller.canGoBack)
            Button("Forward", action: { controller.goForward() })
                .keyboardShortcut("]", modifiers: .command)
                .disabled(!controller.canGoForward)
            Button("Home", action: { if let url = site?.url { controller.load(url) } })
                .keyboardShortcut("h", modifiers: [.command, .shift])
                .disabled(site == nil)
            Button("Reload", action: reload)
                .keyboardShortcut("r", modifiers: .command)
            Button("Open Externally", action: openExternally)
                .keyboardShortcut("o", modifiers: [.command, .shift])
                .disabled(site == nil)
        }
        .opacity(0)
        .frame(width: 0, height: 0)
    }
}

private struct URLBar: View {
    let site: PortalSite?
    @ObservedObject var controller: BrowserController

    @State private var isHovering: Bool = false
    @State private var showCopied: Bool = false

    var body: some View {
        Button(action: copyURL) {
            HStack(spacing: 8) {
                if let site {
                    FaviconView(site: site, size: 14)
                }

                Image(systemName: lockSymbol)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(lockColor)

                Text(displayURL)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .truncationMode(.tail)

                if showCopied {
                    Text("Copied")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Color.accentColor)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(Color.accentColor.opacity(0.14)))
                        .transition(.opacity.combined(with: .scale))
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(Color.primary.opacity(isHovering ? 0.10 : 0.06))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5)
            )
            .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .help("Click to copy URL")
        .animation(.easeOut(duration: 0.16), value: showCopied)
    }

    private var displayURL: String {
        controller.currentURL?.absoluteString
            ?? site?.url.absoluteString
            ?? "No URL"
    }

    private var activeScheme: String? {
        (controller.currentURL ?? site?.url)?.scheme
    }

    private var lockSymbol: String {
        guard let scheme = activeScheme else { return "questionmark" }
        return scheme == "https" ? "lock.fill" : "lock.open.fill"
    }

    private var lockColor: Color {
        guard let scheme = activeScheme else { return .secondary }
        return scheme == "https" ? .secondary : .orange
    }

    private func copyURL() {
        let url = controller.currentURL?.absoluteString ?? site?.url.absoluteString
        guard let url else { return }
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(url, forType: .string)
        showCopied = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_400_000_000)
            showCopied = false
        }
    }
}

private struct BlockCounterPill: View {
    let count: Int
    let onReset: () -> Void

    @State private var isHovering: Bool = false

    var body: some View {
        Button(action: onReset) {
            HStack(spacing: 4) {
                Image(systemName: "shield.lefthalf.filled")
                    .font(.system(size: 10, weight: .semibold))
                Text("\(count)")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .monospacedDigit()
            }
            .foregroundStyle(Color.accentColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                Capsule()
                    .fill(Color.accentColor.opacity(isHovering ? 0.18 : 0.12))
            )
            .overlay(
                Capsule()
                    .strokeBorder(Color.accentColor.opacity(0.22), lineWidth: 0.5)
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .help("\(count) tracker request\(count == 1 ? "" : "s") blocked — click to reset")
        .transition(.scale.combined(with: .opacity))
        .animation(.spring(response: 0.28, dampingFraction: 0.85), value: count)
    }
}

// MARK: - Empty state

private struct EmptyState: View {
    @Binding var catalog: SiteCatalog
    let addSite: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            VStack(spacing: 22) {
                brandedGlyph

                VStack(spacing: 6) {
                    Text("No Site Selected")
                        .font(.system(size: 22, weight: .semibold))
                    Text("Add a site or pick one from your catalog to get started.")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                Button(action: addSite) {
                    HStack(spacing: 6) {
                        Image(systemName: "plus")
                            .font(.system(size: 11, weight: .bold))
                        Text("Add Site…")
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .padding(.horizontal, 6)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                if !availableCuratedApps.isEmpty {
                    quickAddGrid
                }
            }
            .padding(.horizontal, 40)
            .padding(.vertical, 32)
            .frame(maxWidth: 460)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(.regularMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
            )

            Spacer(minLength: 0)

            Text("OpenSesame — your private portal to anything.")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
                .padding(.bottom, 18)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var brandedGlyph: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.accentColor.opacity(0.14))
                .frame(width: 72, height: 72)
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.accentColor.opacity(0.28), lineWidth: 0.5)
                .frame(width: 72, height: 72)
            Image(systemName: "key.fill")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(Color.accentColor)
        }
    }

    private var availableCuratedApps: [CuratedApp] {
        CuratedCatalog.defaultApps.filter { app in
            !catalog.sites.contains { $0.url.absoluteString == app.urlString }
        }
    }

    private var quickAddGrid: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Quick Add")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)

            LazyVGrid(
                columns: [GridItem(.flexible()), GridItem(.flexible())],
                spacing: 8
            ) {
                ForEach(availableCuratedApps) { app in
                    QuickAddTile(app: app, action: { add(app) })
                }
            }
        }
    }

    private func add(_ app: CuratedApp) {
        guard let site = try? PortalSite(name: app.name, urlString: app.urlString) else { return }
        catalog.addSite(site)
        catalog.selectSite(withID: site.id)
    }
}

private struct QuickAddTile: View {
    let app: CuratedApp
    let action: () -> Void

    @State private var isHovering: Bool = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                iconView

                VStack(alignment: .leading, spacing: 1) {
                    Text(app.name)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    if !app.summary.isEmpty {
                        Text(app.summary)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 0)

                Image(systemName: "plus")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.secondary)
                    .opacity(isHovering ? 1 : 0.4)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isHovering ? Color.black.opacity(0.32) : Color.black.opacity(0.22))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
            )
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
    }

    @ViewBuilder
    private var iconView: some View {
        if let site = try? PortalSite(
            name: app.name,
            urlString: app.urlString,
            iconData: URL(string: app.urlString)?.host.flatMap { FaviconService.bundledIconData(forHost: $0) }
        ) {
            FaviconView(site: site, size: 22)
        } else {
            ColoredInitialAvatar(name: app.name, size: 22)
        }
    }
}

// MARK: - Browser pane

/// Wraps BrowserWebView with the failure overlay, the find-in-page bar,
/// the dark backdrop that absorbs the WebView's transparent paint, and
/// the zoom/find keyboard shortcuts.
private struct BrowserPane: View {
    let site: PortalSite
    let reloadToken: UUID
    @ObservedObject var controller: BrowserController

    @State private var isFindActive: Bool = false
    @State private var findQuery: String = ""
    @State private var findMissed: Bool = false

    var body: some View {
        ZStack(alignment: .top) {
            Color(nsColor: .windowBackgroundColor)

            BrowserWebView(
                url: site.url,
                reloadToken: reloadToken,
                controller: controller
            )

            if let error = controller.loadError {
                WebErrorOverlay(error: error, retry: controller.reload)
                    .transition(.opacity)
            }

            if isFindActive {
                FindInPageBar(
                    query: $findQuery,
                    missed: $findMissed,
                    findNext: { performFind(forward: true) },
                    findPrev: { performFind(forward: false) },
                    close: closeFind
                )
                .padding(.top, 10)
                .padding(.trailing, 14)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.2), value: controller.loadError != nil)
        .animation(.easeOut(duration: 0.18), value: isFindActive)
        .background(shortcutShims)
    }

    private func performFind(forward: Bool) {
        Task {
            let hit = await controller.find(findQuery, forward: forward)
            findMissed = !hit
        }
    }

    private func closeFind() {
        isFindActive = false
        findQuery = ""
        findMissed = false
    }

    /// Hidden zero-size Buttons that host the WebView-scoped keyboard
    /// shortcuts (find + zoom). The chrome already owns nav/reload/home.
    private var shortcutShims: some View {
        Group {
            Button("Find") {
                isFindActive = true
                findMissed = false
            }
            .keyboardShortcut("f", modifiers: .command)

            Button("Zoom In", action: controller.zoomIn)
                .keyboardShortcut("=", modifiers: .command)
            Button("Zoom In Alt", action: controller.zoomIn)
                .keyboardShortcut("+", modifiers: [.command, .shift])
            Button("Zoom Out", action: controller.zoomOut)
                .keyboardShortcut("-", modifiers: .command)
            Button("Reset Zoom", action: controller.resetZoom)
                .keyboardShortcut("0", modifiers: .command)
        }
        .opacity(0)
        .frame(width: 0, height: 0)
    }
}

private struct WebErrorOverlay: View {
    let error: WebLoadError
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.red.opacity(0.14))
                    .frame(width: 72, height: 72)
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Color.red.opacity(0.28), lineWidth: 0.5)
                    .frame(width: 72, height: 72)
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(.red)
            }

            VStack(spacing: 6) {
                Text(error.title)
                    .font(.system(size: 22, weight: .semibold))
                Text(error.detail)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                if let url = error.url {
                    Text(url.absoluteString)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .padding(.top, 4)
                }
            }

            Button(action: retry) {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .bold))
                    Text("Retry")
                        .font(.system(size: 13, weight: .semibold))
                }
                .padding(.horizontal, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)
        }
        .padding(.horizontal, 40)
        .padding(.vertical, 32)
        .frame(maxWidth: 460)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.regularMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct FindInPageBar: View {
    @Binding var query: String
    @Binding var missed: Bool
    let findNext: () -> Void
    let findPrev: () -> Void
    let close: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)

            TextField("Find on page", text: $query)
                .textFieldStyle(.plain)
                .font(.system(size: 12))
                .foregroundStyle(missed && !query.isEmpty ? Color.red : Color.primary)
                .focused($isFocused)
                .onSubmit { findNext() }
                .onChange(of: query) { _, _ in missed = false }
                .frame(width: 180)

            Divider().frame(height: 14)

            Button(action: findPrev) {
                Image(systemName: "chevron.up")
                    .font(.system(size: 10, weight: .bold))
            }
            .buttonStyle(.plain)
            .help("Previous match")

            Button(action: findNext) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .bold))
            }
            .buttonStyle(.plain)
            .help("Next match")

            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.cancelAction)
            .help("Close")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            Capsule().fill(.regularMaterial)
        )
        .overlay(
            Capsule().strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
        )
        .onAppear { isFocused = true }
    }
}
