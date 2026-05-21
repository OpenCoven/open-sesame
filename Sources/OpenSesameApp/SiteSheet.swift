import AppKit
import OpenSesameCore
import SwiftUI
import UniformTypeIdentifiers

enum SiteSheetTarget: Identifiable {
    case add
    case edit(PortalSite)

    var id: String {
        switch self {
        case .add: return "add"
        case .edit(let site): return "edit-\(site.id.uuidString)"
        }
    }
}

struct SiteSheet: View {
    let target: SiteSheetTarget
    let availableGroups: [SiteGroup]
    let initialGroupID: SiteGroup.ID?
    let onAdd: (PortalSite, SiteGroup.ID?) -> Void
    let onUpdate: (PortalSite, SiteGroup.ID?, SiteGroup.ID?) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var urlString: String
    @State private var selectedGroupID: SiteGroup.ID?
    @State private var errorMessage: String?
    @State private var isFetchingMetadata: Bool = false
    @State private var nameWasAutofilled: Bool = false
    @State private var lastFetchedURL: String = ""
    @State private var pickedIconData: Data?
    @State private var resetToAuto: Bool = false
    @FocusState private var focusedField: Field?

    private enum Field {
        case name, url
    }

    init(
        target: SiteSheetTarget,
        availableGroups: [SiteGroup],
        initialGroupID: SiteGroup.ID? = nil,
        onAdd: @escaping (PortalSite, SiteGroup.ID?) -> Void,
        onUpdate: @escaping (PortalSite, SiteGroup.ID?, SiteGroup.ID?) -> Void
    ) {
        self.target = target
        self.availableGroups = availableGroups
        self.initialGroupID = initialGroupID
        self.onAdd = onAdd
        self.onUpdate = onUpdate

        switch target {
        case .add:
            _name = State(initialValue: "")
            _urlString = State(initialValue: "https://")
            _selectedGroupID = State(initialValue: initialGroupID)
        case .edit(let site):
            _name = State(initialValue: site.name)
            _urlString = State(initialValue: site.url.absoluteString)
            let containingID = availableGroups.first { group in
                group.sites.contains(where: { $0.id == site.id })
            }?.id
            _selectedGroupID = State(initialValue: containingID ?? initialGroupID)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            sheetHeader

            VStack(alignment: .leading, spacing: 14) {
                fieldGroup

                validationMessage
                    .frame(minHeight: 16, alignment: .leading)
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 18)

            Divider()

            footer
                .padding(.horizontal, 22)
                .padding(.vertical, 14)
        }
        .frame(width: 480)
        .onAppear {
            DispatchQueue.main.async {
                if case .add = target {
                    focusedField = .url
                } else {
                    focusedField = .name
                }
            }
        }
    }

    private var sheetHeader: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: headerIcon)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: 34, height: 34)
                .background(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(Color.accentColor.opacity(0.14))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
                )

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(title)
                        .font(.system(size: 19, weight: .semibold))
                    if isFetchingMetadata {
                        ProgressView()
                            .controlSize(.small)
                    }
                }

                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 22)
        .padding(.top, 22)
        .padding(.bottom, 16)
    }

    private var fieldGroup: some View {
        VStack(alignment: .leading, spacing: 14) {
            ModalField(label: "Icon") {
                iconRow
            }

            ModalField(label: "Name") {
                TextField("OpenCoven", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .controlSize(.large)
                    .focused($focusedField, equals: .name)
                    .onSubmit { submit() }
                    .onChange(of: name) { _, _ in
                        nameWasAutofilled = false
                    }
            }

            Rectangle()
                .fill(Color.white.opacity(0.06))
                .frame(height: 0.5)

            ModalField(label: "URL") {
                TextField("https://example.com", text: $urlString)
                    .textFieldStyle(.roundedBorder)
                    .controlSize(.large)
                    .focused($focusedField, equals: .url)
                    .onSubmit { submit() }
                    .onChange(of: urlString) { _, newValue in
                        scheduleMetadataFetch(for: newValue)
                    }
            }

            if !availableGroups.isEmpty {
                ModalField(label: "Folder") {
                    folderPicker
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.black.opacity(0.22))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
        )
    }

    private var iconRow: some View {
        HStack(alignment: .center, spacing: 14) {
            InteractiveIconPicker(
                data: displayIconData,
                fallbackName: previewName,
                size: 48,
                onPick: { data in
                    pickedIconData = data
                    resetToAuto = false
                },
                onClick: pickIcon
            )

            VStack(alignment: .leading, spacing: 3) {
                Text("Drop an image or click the icon to choose.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                if canResetIcon {
                    Button(action: resetIconToAuto) {
                        Text("Use Auto Favicon")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.accentColor)
                    }
                    .buttonStyle(.plain)
                }
            }

            Spacer(minLength: 0)
        }
    }

    private var folderPicker: some View {
        Menu {
            Button {
                selectedGroupID = nil
            } label: {
                if selectedGroupID == nil {
                    Label("None", systemImage: "checkmark")
                } else {
                    Text("None")
                }
            }
            ForEach(availableGroups) { group in
                Button {
                    selectedGroupID = group.id
                } label: {
                    if selectedGroupID == group.id {
                        Label(group.name, systemImage: "checkmark")
                    } else {
                        Text(group.name)
                    }
                }
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "folder.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                Text(folderLabel)
                    .font(.system(size: 13))
                    .foregroundStyle(.primary)
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(Color.white.opacity(0.08))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5)
            )
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
    }

    private var folderLabel: String {
        guard let id = selectedGroupID,
              let group = availableGroups.first(where: { $0.id == id }) else {
            return "None"
        }
        return group.name
    }

    @ViewBuilder
    private var validationMessage: some View {
        if let errorMessage {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.red)
                Text(errorMessage)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.red)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color.red.opacity(0.10))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(Color.red.opacity(0.30), lineWidth: 0.5)
            )
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }

    private var footer: some View {
        HStack(spacing: 10) {
            Spacer()

            Button("Cancel") { dismiss() }
                .keyboardShortcut(.cancelAction)
                .controlSize(.large)

            Button(actionTitle) { submit() }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!isFormValid)
        }
    }

    // MARK: - Icon

    private var displayIconData: Data? {
        if let pickedIconData { return pickedIconData }
        if resetToAuto { return nil }
        if case .edit(let site) = target { return site.iconData }
        return nil
    }

    private var previewName: String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { return trimmed }
        if case .edit(let site) = target { return site.name }
        return "?"
    }

    private var canResetIcon: Bool {
        if pickedIconData != nil { return true }
        if case .edit(let site) = target { return site.iconData != nil && !resetToAuto }
        return false
    }

    private func pickIcon() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        panel.message = "Choose an image to use as this site's icon."
        guard panel.runModal() == .OK,
              let url = panel.url,
              let data = try? Data(contentsOf: url),
              NSImage(data: data) != nil else {
            return
        }
        pickedIconData = data
        resetToAuto = false
    }

    private func resetIconToAuto() {
        pickedIconData = nil
        resetToAuto = true
    }

    // MARK: - Metadata autofill

    private func scheduleMetadataFetch(for urlString: String) {
        guard case .add = target else { return }
        let trimmed = urlString.trimmingCharacters(in: .whitespaces)
        guard trimmed != lastFetchedURL else { return }
        guard let url = URL(string: trimmed),
              let scheme = url.scheme,
              scheme == "http" || scheme == "https",
              url.host != nil else {
            return
        }
        lastFetchedURL = trimmed

        Task {
            isFetchingMetadata = true
            defer { isFetchingMetadata = false }

            // Wait a beat to let the user finish typing.
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard urlString.trimmingCharacters(in: .whitespaces) == trimmed else { return }

            guard let metadata = await SiteMetadataService.shared.fetch(url) else { return }
            applyMetadata(metadata, for: url)
        }
    }

    private func applyMetadata(_ metadata: SiteMetadata, for url: URL) {
        if name.isEmpty || nameWasAutofilled {
            if let suggested = metadata.title ?? metadata.siteName ?? url.host {
                name = suggested
                nameWasAutofilled = true
            }
        }
    }

    // MARK: - Submit

    private var title: String {
        switch target {
        case .add: return "Add Site"
        case .edit: return "Edit Site"
        }
    }

    private var subtitle: String {
        switch target {
        case .add: return "Paste a URL — the name will autofill."
        case .edit: return "Update the name, URL, or folder."
        }
    }

    private var actionTitle: String {
        switch target {
        case .add: return "Add"
        case .edit: return "Save"
        }
    }

    private var headerIcon: String {
        switch target {
        case .add: return "plus"
        case .edit: return "pencil"
        }
    }

    private var isFormValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && !urlString.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func submit() {
        do {
            switch target {
            case .add:
                let site = try PortalSite(
                    name: name,
                    urlString: urlString,
                    iconData: pickedIconData
                )
                onAdd(site, selectedGroupID)
            case .edit(let existing):
                let resolvedIconData: Data?
                if let pickedIconData {
                    resolvedIconData = pickedIconData
                } else if resetToAuto {
                    resolvedIconData = nil
                    if let host = existing.url.host {
                        FaviconService.shared.invalidate(host: host)
                    }
                } else {
                    resolvedIconData = existing.iconData
                }

                let updated = try PortalSite(
                    id: existing.id,
                    name: name,
                    urlString: urlString,
                    iconData: resolvedIconData
                )
                let previousID = availableGroups.first { group in
                    group.sites.contains(where: { $0.id == existing.id })
                }?.id ?? initialGroupID
                onUpdate(updated, previousID, selectedGroupID)
            }
            dismiss()
        } catch let error as PortalSite.ValidationError {
            withAnimation(.easeOut(duration: 0.2)) {
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
            }
        } catch {
            withAnimation(.easeOut(duration: 0.2)) {
                errorMessage = "Could not save site."
            }
        }
    }
}

private struct ModalField<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)
            content
        }
    }
}

private struct IconPreview: View {
    let data: Data?
    let fallbackName: String
    let size: CGFloat

    var body: some View {
        ZStack {
            if let data, let image = NSImage(data: data) {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(Color.primary.opacity(0.06))
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .padding(3)
            } else {
                ColoredInitialAvatar(name: fallbackName, size: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
        )
    }
}

private struct InteractiveIconPicker: View {
    let data: Data?
    let fallbackName: String
    let size: CGFloat
    let onPick: (Data) -> Void
    let onClick: () -> Void

    @State private var isHovered: Bool = false
    @State private var isDropTargeted: Bool = false

    var body: some View {
        Button(action: onClick) {
            ZStack {
                IconPreview(data: data, fallbackName: fallbackName, size: size)

                if isHovered || isDropTargeted {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(Color.black.opacity(0.55))
                        .frame(width: size, height: size)

                    Image(systemName: isDropTargeted ? "arrow.down.circle.fill" : "camera.fill")
                        .font(.system(size: size * 0.36, weight: .semibold))
                        .foregroundStyle(.white)
                }

                if isDropTargeted {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .strokeBorder(Color.accentColor, lineWidth: 1.5)
                        .frame(width: size, height: size)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .help("Click to choose an image, or drop one here")
        .dropDestination(for: URL.self) { urls, _ in
            guard let url = urls.first,
                  let bytes = try? Data(contentsOf: url),
                  NSImage(data: bytes) != nil else { return false }
            onPick(bytes)
            return true
        } isTargeted: { isDropTargeted = $0 }
        .animation(.easeOut(duration: 0.12), value: isHovered)
        .animation(.easeOut(duration: 0.12), value: isDropTargeted)
    }
}
