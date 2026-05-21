import OpenSesameCore
import SwiftUI

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
    @State private var label: String
    @State private var urlString: String
    @State private var selectedGroupID: SiteGroup.ID?
    @State private var errorMessage: String?
    @State private var isFetchingMetadata: Bool = false
    @State private var nameWasAutofilled: Bool = false
    @State private var labelWasAutofilled: Bool = false
    @State private var lastFetchedURL: String = ""
    @FocusState private var focusedField: Field?

    private enum Field {
        case name, label, url
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
            _label = State(initialValue: "")
            _urlString = State(initialValue: "https://")
            _selectedGroupID = State(initialValue: initialGroupID)
        case .edit(let site):
            _name = State(initialValue: site.name)
            _label = State(initialValue: site.label)
            _urlString = State(initialValue: site.url.absoluteString)
            _selectedGroupID = State(initialValue: initialGroupID)
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
                .background(Color(nsColor: .controlBackgroundColor).opacity(0.42))
        }
        .frame(width: 460)
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

            ModalField(label: "Name") {
                TextField("OpenCoven", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .controlSize(.large)
                    .focused($focusedField, equals: .name)
                    .onSubmit { focusedField = .label }
                    .onChange(of: name) { _, _ in
                        nameWasAutofilled = false
                    }
            }

            ModalField(label: "Label") {
                TextField("Home (optional)", text: $label)
                    .textFieldStyle(.roundedBorder)
                    .controlSize(.large)
                    .focused($focusedField, equals: .label)
                    .onSubmit { submit() }
                    .onChange(of: label) { _, _ in
                        labelWasAutofilled = false
                    }
            }

            if !availableGroups.isEmpty {
                ModalField(label: "Folder") {
                    Picker("Folder", selection: $selectedGroupID) {
                        Text("None").tag(SiteGroup.ID?.none)
                        ForEach(availableGroups) { group in
                            Text(group.name).tag(SiteGroup.ID?.some(group.id))
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                    .controlSize(.large)
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.36))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.secondary.opacity(0.16))
        )
    }

    @ViewBuilder
    private var validationMessage: some View {
        if let errorMessage {
            Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.red)
        }
    }

    private var footer: some View {
        HStack(spacing: 10) {
            if case .edit(let site) = target, site.isPinned {
                Label("Pinned home site", systemImage: "pin.fill")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
            }

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
        if label.isEmpty || labelWasAutofilled {
            if let suggested = metadata.siteName ?? metadata.description {
                let truncated = String(suggested.prefix(60))
                label = truncated
                labelWasAutofilled = true
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
        case .add: return "Paste a URL — name and label will autofill."
        case .edit: return "Update the name, label, URL, or folder."
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
                let site = try PortalSite(name: name, label: label, urlString: urlString)
                onAdd(site, selectedGroupID)
            case .edit(let existing):
                let updated = try PortalSite(
                    id: existing.id,
                    name: name,
                    label: label,
                    urlString: urlString,
                    isPinned: existing.isPinned,
                    iconData: existing.iconData
                )
                onUpdate(updated, initialGroupID, selectedGroupID)
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

private struct ModalField<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
            content
        }
    }
}
