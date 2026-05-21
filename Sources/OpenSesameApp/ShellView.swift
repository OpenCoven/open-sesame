import AppKit
import OpenSesameCore
import SwiftUI

private enum SidebarMode {
    case expanded
    case rail
}

private let railWidth: CGFloat = 60

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

    private static let minSidebarWidth: CGFloat = 180
    private static let maxSidebarWidth: CGFloat = 380
    private static let sidebarAnimation: Animation = .spring(response: 0.32, dampingFraction: 0.86)

    var body: some View {
        HStack(spacing: 0) {
            SiteSidebar(
                catalog: $catalog,
                mode: sidebarMode,
                appearance: appearance,
                addSite: { presentAddSite(toGroup: nil) },
                addSiteToGroup: { groupID in presentAddSite(toGroup: groupID) },
                editSite: { site in presentEdit(site: site) },
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
                Divider().opacity(0.6)
            }

            VStack(spacing: 0) {
                BrowserChrome(
                    site: catalog.selectedSite,
                    controller: controller,
                    hasHome: catalog.pinnedSite != nil,
                    appearance: appearance,
                    reload: reload,
                    goHome: goHome,
                    openExternally: openSelectedSite,
                    openSettings: { showingSettings = true }
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
                        description: Text("Add a site from the sidebar to start previewing.")
                    )
                }
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
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
            SettingsSheet(
                catalog: $catalog,
                appearance: appearance,
                editSite: { site in
                    showingSettings = false
                    DispatchQueue.main.async { presentEdit(site: site) }
                },
                addGroup: {
                    let group = SiteGroup(name: "New Folder")
                    catalog.addGroup(group)
                }
            )
        }
        .task {
            await refreshAllFavicons()
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

    private func reload() {
        reloadToken = UUID()
    }

    private func goHome() {
        guard let home = catalog.pinnedSite else { return }
        catalog.selectSite(withID: home.id)
    }

    private func openSelectedSite() {
        guard let url = catalog.selectedSite?.url else { return }
        NSWorkspace.shared.open(url)
    }

    private func presentAddSite(toGroup groupID: SiteGroup.ID?) {
        siteSheetInitialGroupID = groupID
        siteSheet = .add
    }

    private func presentEdit(site: PortalSite) {
        siteSheetInitialGroupID = catalog.groupID(containingSite: site.id)
        siteSheet = .edit(site)
    }

    // MARK: - Favicons

    private func refreshAllFavicons() async {
        for site in catalog.sites where site.iconData == nil {
            await refreshFavicon(for: site)
        }
    }

    private func refreshFavicon(for site: PortalSite) async {
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
    let editSite: (PortalSite) -> Void
    let toggleMode: () -> Void

    var body: some View {
        ZStack {
            VisualEffectBackground()
            Color(nsColor: .underPageBackgroundColor)
                .opacity(1 - appearance.transparency)
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
        }
    }
}

// MARK: - Expanded sidebar

private struct ExpandedSidebar: View {
    @Binding var catalog: SiteCatalog
    let addSite: () -> Void
    let addSiteToGroup: (SiteGroup.ID) -> Void
    let editSite: (PortalSite) -> Void
    let toggleMode: () -> Void

    @State private var hoveredID: PortalSite.ID?

    var body: some View {
        VStack(spacing: 0) {
            SidebarHeader(
                title: "Open Sesame",
                primaryIcon: "sidebar.left",
                primaryHelp: "Collapse to Rail  ⌃⌘S",
                primaryAction: toggleMode,
                primaryShortcut: KeyboardShortcut("s", modifiers: [.command, .control]),
                secondaryIcon: "plus",
                secondaryHelp: "Add Site  ⌘N",
                secondaryAction: addSite
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
                                anyHovered: hoveredID != nil,
                                onSelect: { catalog.selectSite(withID: site.id) },
                                onHover: { hover in hoveredID = hover ? site.id : (hoveredID == site.id ? nil : hoveredID) },
                                onEdit: { editSite(site) },
                                onRemove: site.isPinned ? nil : { catalog.removeSite(withID: site.id) },
                                onPinAsHome: { catalog.setHomeSite(withID: site.id) }
                            )
                            .listRowSeparator(.hidden)
                            .listRowInsets(.init(top: 1, leading: 6, bottom: 1, trailing: 6))
                            .listRowBackground(Color.clear)

                        case .group(let group):
                            ExpandedGroupRow(
                                group: group,
                                catalog: $catalog,
                                hoveredID: $hoveredID,
                                editSite: editSite,
                                addSiteToGroup: { addSiteToGroup(group.id) }
                            )
                            .listRowSeparator(.hidden)
                            .listRowInsets(.init(top: 1, leading: 6, bottom: 1, trailing: 6))
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
        }
    }
}

private struct ExpandedSiteRow: View {
    let site: PortalSite
    let isSelected: Bool
    let isHovered: Bool
    let anyHovered: Bool
    let onSelect: () -> Void
    let onHover: (Bool) -> Void
    let onEdit: () -> Void
    let onRemove: (() -> Void)?
    let onPinAsHome: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 10) {
                FaviconView(site: site, size: 22)

                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text(site.name)
                            .font(.system(size: 13, weight: .medium))
                            .lineLimit(1)
                        if site.isPinned {
                            Image(systemName: "pin.fill")
                                .font(.system(size: 8))
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
                Spacer()
            }
            .padding(.vertical, 5)
            .padding(.horizontal, 6)
            .background(rowBackground)
            .overlay(activeBar, alignment: .leading)
            .contentShape(Rectangle())
            .opacity(rowOpacity)
        }
        .buttonStyle(.plain)
        .onHover(perform: onHover)
        .contextMenu { contextMenu }
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
    }

    private var rowOpacity: Double {
        if isSelected { return 1.0 }
        if !anyHovered { return 0.78 }
        return isHovered ? 1.0 : 0.42
    }

    private var rowBackground: some View {
        RoundedRectangle(cornerRadius: 7, style: .continuous)
            .fill(rowFill)
    }

    private var rowFill: Color {
        if isSelected { return Color.accentColor.opacity(0.22) }
        if isHovered { return Color.primary.opacity(0.07) }
        return Color.clear
    }

    @ViewBuilder
    private var activeBar: some View {
        if isSelected {
            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                .fill(Color.accentColor)
                .frame(width: 3, height: 22)
                .offset(x: -2)
        }
    }

    @ViewBuilder
    private var contextMenu: some View {
        Button { onEdit() } label: { Label("Edit", systemImage: "pencil") }
        Button { onPinAsHome() } label: {
            Label(site.isPinned ? "Already Home" : "Set as Home", systemImage: "house")
        }
        .disabled(site.isPinned)
        if let onRemove {
            Divider()
            Button(role: .destructive, action: onRemove) {
                Label("Remove", systemImage: "trash")
            }
        }
    }
}

private struct ExpandedGroupRow: View {
    let group: SiteGroup
    @Binding var catalog: SiteCatalog
    @Binding var hoveredID: PortalSite.ID?
    let editSite: (PortalSite) -> Void
    let addSiteToGroup: () -> Void

    @State private var isDropTargeted: Bool = false

    var body: some View {
        DisclosureGroup(
            isExpanded: collapsedBinding
        ) {
            ForEach(group.sites) { site in
                ExpandedSiteRow(
                    site: site,
                    isSelected: catalog.selectedSite?.id == site.id,
                    isHovered: hoveredID == site.id,
                    anyHovered: hoveredID != nil,
                    onSelect: { catalog.selectSite(withID: site.id) },
                    onHover: { hover in
                        hoveredID = hover ? site.id : (hoveredID == site.id ? nil : hoveredID)
                    },
                    onEdit: { editSite(site) },
                    onRemove: site.isPinned ? nil : { catalog.removeSite(withID: site.id) },
                    onPinAsHome: { catalog.setHomeSite(withID: site.id) }
                )
                .padding(.leading, 8)
            }
            .onMove { source, destination in
                catalog.moveSitesInGroup(group.id, fromOffsets: source, toOffset: destination)
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "folder.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(isDropTargeted ? Color.accentColor : .secondary)
                Text(group.name)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(isDropTargeted ? Color.accentColor : .secondary)
                    .textCase(.uppercase)
                Spacer()
                Button(action: addSiteToGroup) {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
                .help("Add Site to \(group.name)")
            }
            .padding(.vertical, 3)
            .padding(.horizontal, 4)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(isDropTargeted ? Color.accentColor.opacity(0.18) : Color.clear)
            )
            .contextMenu {
                Button {
                    catalog.renameGroup(withID: group.id, to: group.name)
                } label: { Label("Rename in Settings…", systemImage: "pencil") }
                Divider()
                Button(role: .destructive) {
                    catalog.removeGroup(withID: group.id)
                } label: { Label("Remove Folder", systemImage: "trash") }
            }
            .dropDestination(for: String.self) { strings, _ in
                handleDrop(strings)
            } isTargeted: { isDropTargeted = $0 }
        }
        .accentColor(.secondary)
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

// MARK: - Rail sidebar

private struct RailSidebar: View {
    @Binding var catalog: SiteCatalog
    let addSite: () -> Void
    let editSite: (PortalSite) -> Void
    let toggleMode: () -> Void

    @State private var hoveredID: PortalSite.ID?

    var body: some View {
        VStack(spacing: 4) {
            SidebarIconButton(
                systemName: "sidebar.left",
                help: "Expand Sidebar  ⌃⌘S",
                action: toggleMode
            )
            .keyboardShortcut("s", modifiers: [.command, .control])
            .padding(.top, 12)
            .padding(.bottom, 4)

            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 4) {
                    ForEach(catalog.entries, id: \.id) { entry in
                        switch entry {
                        case .site(let site):
                            RailSiteRow(
                                site: site,
                                isSelected: catalog.selectedSite?.id == site.id,
                                isHovered: hoveredID == site.id,
                                anyHovered: hoveredID != nil,
                                onTap: { catalog.selectSite(withID: site.id) },
                                onHover: { hover in
                                    hoveredID = hover ? site.id : (hoveredID == site.id ? nil : hoveredID)
                                },
                                onEdit: { editSite(site) },
                                onRemove: site.isPinned ? nil : { catalog.removeSite(withID: site.id) },
                                onPinAsHome: { catalog.setHomeSite(withID: site.id) }
                            )
                        case .group(let group):
                            RailGroup(
                                group: group,
                                catalog: $catalog,
                                hoveredID: $hoveredID,
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
            .padding(.bottom, 10)
        }
    }
}

private struct RailSiteRow: View {
    let site: PortalSite
    let isSelected: Bool
    let isHovered: Bool
    let anyHovered: Bool
    let onTap: () -> Void
    let onHover: (Bool) -> Void
    let onEdit: () -> Void
    let onRemove: (() -> Void)?
    let onPinAsHome: () -> Void

    var body: some View {
        Button(action: onTap) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(rowFill)
                    .frame(width: 44, height: 44)

                if isSelected {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Color.accentColor, lineWidth: 2)
                        .frame(width: 44, height: 44)
                }

                FaviconView(site: site, size: 28)

                if site.isPinned {
                    Image(systemName: "pin.fill")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(2)
                        .background(Circle().fill(Color.secondary))
                        .rotationEffect(.degrees(45))
                        .offset(x: 14, y: -14)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 10))
            .opacity(rowOpacity)
        }
        .buttonStyle(.plain)
        .help(site.name)
        .frame(width: 48, height: 48)
        .onHover(perform: onHover)
        .contextMenu {
            Button { onEdit() } label: { Label("Edit", systemImage: "pencil") }
            Button(action: onPinAsHome) {
                Label(site.isPinned ? "Already Home" : "Set as Home", systemImage: "house")
            }
            .disabled(site.isPinned)
            if let onRemove {
                Divider()
                Button(role: .destructive, action: onRemove) {
                    Label("Remove", systemImage: "trash")
                }
            }
        }
        .draggable(site.id.uuidString) {
            FaviconView(site: site, size: 28)
                .padding(6)
                .background(.regularMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
    }

    private var rowOpacity: Double {
        if isSelected { return 1.0 }
        if !anyHovered { return 0.82 }
        return isHovered ? 1.0 : 0.42
    }

    private var rowFill: Color {
        if isSelected { return Color.accentColor.opacity(0.22) }
        if isHovered { return Color.primary.opacity(0.07) }
        return Color.clear
    }
}

private struct RailGroup: View {
    let group: SiteGroup
    @Binding var catalog: SiteCatalog
    @Binding var hoveredID: PortalSite.ID?
    let editSite: (PortalSite) -> Void

    @State private var isDropTargeted: Bool = false

    var body: some View {
        VStack(spacing: 2) {
            Image(systemName: "folder.fill")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(isDropTargeted ? Color.accentColor : .secondary)
                .frame(maxWidth: .infinity)
                .padding(.top, 3)
                .help(group.name)

            ForEach(group.sites) { site in
                RailSiteRow(
                    site: site,
                    isSelected: catalog.selectedSite?.id == site.id,
                    isHovered: hoveredID == site.id,
                    anyHovered: hoveredID != nil,
                    onTap: { catalog.selectSite(withID: site.id) },
                    onHover: { hover in
                        hoveredID = hover ? site.id : (hoveredID == site.id ? nil : hoveredID)
                    },
                    onEdit: { editSite(site) },
                    onRemove: site.isPinned ? nil : { catalog.removeSite(withID: site.id) },
                    onPinAsHome: { catalog.setHomeSite(withID: site.id) }
                )
            }
        }
        .padding(.bottom, 3)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(isDropTargeted ? Color.accentColor.opacity(0.18) : Color.primary.opacity(0.045))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(
                            isDropTargeted ? Color.accentColor.opacity(0.7) : Color.primary.opacity(0.06),
                            lineWidth: isDropTargeted ? 1.5 : 0.5
                        )
                )
        )
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

// MARK: - Buttons

private struct SidebarHeader: View {
    let title: String
    let primaryIcon: String
    let primaryHelp: String
    let primaryAction: () -> Void
    let primaryShortcut: KeyboardShortcut?
    let secondaryIcon: String
    let secondaryHelp: String
    let secondaryAction: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            shortcutButton(
                systemName: primaryIcon,
                help: primaryHelp,
                shortcut: primaryShortcut,
                action: primaryAction
            )
            Spacer()
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)
            Spacer()
            SidebarIconButton(systemName: secondaryIcon, help: secondaryHelp, action: secondaryAction)
        }
        .padding(.horizontal, 10)
        .padding(.top, 12)
        .padding(.bottom, 10)
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

// MARK: - Chrome

private struct BrowserChrome: View {
    let site: PortalSite?
    @ObservedObject var controller: BrowserController
    let hasHome: Bool
    @ObservedObject var appearance: AppearanceSettings
    let reload: () -> Void
    let goHome: () -> Void
    let openExternally: () -> Void
    let openSettings: () -> Void

    var body: some View {
        ZStack {
            VisualEffectBackground(material: .titlebar)
            Color(nsColor: .controlBackgroundColor)
                .opacity(1 - appearance.transparency)

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

                ChromeIconButton(
                    systemName: "gearshape",
                    help: "Settings  ⌘,",
                    action: openSettings
                )
                .keyboardShortcut(",", modifiers: .command)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .frame(height: 50)
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
