#!/usr/bin/env bash
# Build, sign, notarize, staple, and publish a release.
#
# Usage:
#   script/release.sh v0.1.0
#
# Env overrides:
#   NOTARY_PROFILE    keychain profile name created via `xcrun notarytool
#                     store-credentials` (default: opensesame-notary)
#   SIGNING_IDENTITY  codesign identity string (default: the Soul Protocol
#                     Developer ID Application cert from your keychain)
#   SKIP_NOTARY=1     stop after signing + zipping (no upload, no release)
#   SKIP_PUBLISH=1    notarize + staple, but don't create the GitHub release

set -euo pipefail

VERSION="${1:?usage: $0 <version-tag e.g. v0.1.0>}"
NOTARY_PROFILE="${NOTARY_PROFILE:-opensesame-notary}"
SIGNING_IDENTITY="${SIGNING_IDENTITY:-EE732DF3F48D7535561AF54D3FFFC4B44DAF3E7F}"

APP_NAME="OpenSesame"
BUNDLE_ID="ai.opencoven.OpenSesame"
MIN_SYSTEM="14.0"
TEAM_ID="9LR8Z8UQ9X"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${ROOT}/dist"
APP="${DIST}/${APP_NAME}.app"
ENT="${ROOT}/script/release-entitlements.plist"
ZIP="${DIST}/${APP_NAME}-${VERSION#v}.zip"

cd "${ROOT}"

say() { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }

say "Building release binary"
swift build -c release

BIN_DIR="$(swift build -c release --show-bin-path)"

say "Staging ${APP_NAME}.app"
rm -rf "${APP}"
mkdir -p "${APP}/Contents/MacOS" "${APP}/Contents/Resources"
cp "${BIN_DIR}/${APP_NAME}" "${APP}/Contents/MacOS/${APP_NAME}"
chmod +x "${APP}/Contents/MacOS/${APP_NAME}"

shopt -s nullglob
for src_bundle in "${BIN_DIR}"/*.bundle; do
    bundle_name="$(basename "${src_bundle}" .bundle)"
    dst_bundle="${APP}/Contents/Resources/${bundle_name}.bundle"

    # SwiftPM emits a flat-style .bundle (just files in a dir, no
    # Info.plist) which codesign + notarization both reject. Reshape it
    # into a proper macOS bundle: Contents/Info.plist + Contents/Resources.
    mkdir -p "${dst_bundle}/Contents/Resources"
    find "${src_bundle}" -maxdepth 1 -mindepth 1 -type f \
        -exec cp {} "${dst_bundle}/Contents/Resources/" \;

    cat > "${dst_bundle}/Contents/Info.plist" <<BUNDLEPLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_ID}.${bundle_name}</string>
    <key>CFBundleName</key>
    <string>${bundle_name}</string>
    <key>CFBundlePackageType</key>
    <string>BNDL</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION#v}</string>
    <key>CFBundleVersion</key>
    <string>${VERSION#v}</string>
</dict>
</plist>
BUNDLEPLIST
done
shopt -u nullglob

cat > "${APP}/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${APP_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_ID}</string>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION#v}</string>
    <key>CFBundleVersion</key>
    <string>${VERSION#v}</string>
    <key>LSMinimumSystemVersion</key>
    <string>${MIN_SYSTEM}</string>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST

say "Signing nested .bundle resources"
shopt -s nullglob
for bundle in "${APP}/Contents/Resources"/*.bundle; do
    codesign --force --options runtime --timestamp \
        --sign "${SIGNING_IDENTITY}" "${bundle}"
done
shopt -u nullglob

say "Signing ${APP_NAME}.app with hardened runtime + entitlements"
codesign --force --options runtime --timestamp \
    --entitlements "${ENT}" \
    --sign "${SIGNING_IDENTITY}" "${APP}"

say "Verifying signature"
codesign --verify --strict --verbose=2 "${APP}"
codesign --display --entitlements - "${APP}" >/dev/null

say "Zipping for notarization → ${ZIP}"
rm -f "${ZIP}"
ditto -c -k --keepParent "${APP}" "${ZIP}"

if [[ "${SKIP_NOTARY:-0}" == "1" ]]; then
    say "SKIP_NOTARY=1 set — stopping after signing + zipping"
    say "Artifact: ${ZIP}"
    exit 0
fi

say "Submitting to Apple notary (profile: ${NOTARY_PROFILE})"
if ! xcrun notarytool submit "${ZIP}" \
        --keychain-profile "${NOTARY_PROFILE}" --wait; then
    cat <<MSG

Notarization failed or no credentials. To store credentials once:

    xcrun notarytool store-credentials ${NOTARY_PROFILE} \\
        --apple-id "you@example.com" \\
        --team-id ${TEAM_ID} \\
        --password "xxxx-xxxx-xxxx-xxxx"

The password is an app-specific password from appleid.apple.com.
Re-run this script after storing the profile.
MSG
    exit 1
fi

say "Stapling notarization ticket to .app"
xcrun stapler staple "${APP}"

say "Re-zipping with stapled ticket"
rm -f "${ZIP}"
ditto -c -k --keepParent "${APP}" "${ZIP}"

say "Verifying staple"
xcrun stapler validate "${APP}"
spctl --assess --verbose=4 --type execute "${APP}"

if [[ "${SKIP_PUBLISH:-0}" == "1" ]]; then
    say "SKIP_PUBLISH=1 set — stopping before GitHub release"
    say "Artifact: ${ZIP}"
    exit 0
fi

say "Creating signed tag ${VERSION}"
if git rev-parse "${VERSION}" >/dev/null 2>&1; then
    echo "Tag ${VERSION} already exists locally — skipping create"
else
    git tag -s "${VERSION}" -m "OpenSesame ${VERSION}"
fi
git push origin "${VERSION}"

say "Creating GitHub release ${VERSION}"
gh release create "${VERSION}" "${ZIP}" \
    --title "OpenSesame ${VERSION}" \
    --notes "Signed (Developer ID), notarized, and stapled macOS build.

\`shasum -a 256 ${APP_NAME}-${VERSION#v}.zip\`:
$(shasum -a 256 "${ZIP}" | awk '{print $1}')"

say "Done. Release ${VERSION} published: $(gh release view "${VERSION}" --json url --jq .url)"
