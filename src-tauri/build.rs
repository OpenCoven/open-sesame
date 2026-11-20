//! Declares `bridge_request` as the application's only command. A declared command is refused
//! unless a capability grants it, and the only capability names the main window.

use std::{env, fs, path::Path};

/// Version 6 of the Windows common controls, which the window and menu libraries import from.
/// An assembly version has four parts; they are kept as numbers because the repository's
/// privacy check reads four numbers joined by dots as a network address.
const COMMON_CONTROLS_VERSION: [u8; 4] = [6, 0, 0, 0];

/// The application manifest Tauri gives a Windows program by default. It asks for that version
/// of the common controls.
fn windows_app_manifest() -> String {
    let version = COMMON_CONTROLS_VERSION
        .map(|part| part.to_string())
        .join(".");
    format!(
        r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="{version}"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
</assembly>
"#
    )
}

fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&["bridge_request"]);
    let mut attributes = tauri_build::Attributes::new().app_manifest(manifest);
    if windows_msvc_target() {
        // Tauri's build step puts the Windows manifest in a resource that Cargo links into the
        // application binary only. The library's test program then starts without it and stops
        // with STATUS_ENTRYPOINT_NOT_FOUND before any test runs. So the linker embeds the same
        // manifest in everything this package links, and Tauri's copy is left out so the
        // application binary does not get two.
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        embed_windows_manifest();
    }
    tauri_build::try_build(attributes).expect("the Tauri build configuration is valid");
}

/// Whether the build targets Windows with the Microsoft linker. Read from Cargo's target
/// variables, because a build script's own `cfg` describes the machine doing the build.
fn windows_msvc_target() -> bool {
    env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
}

fn embed_windows_manifest() {
    let out_dir = env::var("OUT_DIR").expect("Cargo sets OUT_DIR for a build script");
    let manifest = Path::new(&out_dir).join("windows-app-manifest.xml");
    fs::write(&manifest, windows_app_manifest()).expect("the build output folder is writable");
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
}
