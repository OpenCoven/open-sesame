import AppKit
import OpenSesameCore
import SwiftUI

struct ShellView: View {
    @Binding var catalog: SiteCatalog
    @State private var reloadToken = UUID()

    var body: some View {
        HStack(spacing: 0) {
            SiteSidebar(catalog: $catalog)

            Divider()

            VStack(spacing: 0) {
                BrowserChrome(
                    site: catalog.selectedSite,
                    reload: { reloadToken = UUID() },
                    openExternally: openSelectedSite
                )

                Divider()

                if let site = catalog.selectedSite {
                    BrowserWebView(url: site.url, reloadToken: reloadToken)
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
    }

    private func openSelectedSite() {
        guard let url = catalog.selectedSite?.url else {
            return
        }

        NSWorkspace.shared.open(url)
    }
}

private struct SiteSidebar: View {
    @Binding var catalog: SiteCatalog

    var body: some View {
        List(selection: selectionBinding) {
            Section("Sites") {
                ForEach(catalog.sites) { site in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(site.name)
                            .font(.system(size: 13, weight: .medium))
                            .lineLimit(1)

                        if !site.label.isEmpty {
                            Text(site.label)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .tag(site.id)
                    .padding(.vertical, 4)
                }
            }
        }
        .listStyle(.sidebar)
        .frame(minWidth: 190, idealWidth: 220, maxWidth: 280)
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

private struct BrowserChrome: View {
    let site: PortalSite?
    let reload: () -> Void
    let openExternally: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            TrafficLights()

            VStack(alignment: .leading, spacing: 2) {
                Text(site?.name ?? "Open Sesame")
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)

                Text(site?.url.absoluteString ?? "No URL")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            Button(action: reload) {
                Label("Reload", systemImage: "arrow.clockwise")
            }
            .labelStyle(.iconOnly)

            Button(action: openExternally) {
                Label("Open in Browser", systemImage: "arrow.up.right.square")
            }
            .labelStyle(.iconOnly)
            .disabled(site == nil)
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(nsColor: .controlBackgroundColor))
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
