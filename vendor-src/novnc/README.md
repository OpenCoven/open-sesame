# noVNC

Upstream: https://github.com/novnc/noVNC/tree/v1.7.0 (release v1.7.0). Authored upstream sources and third-party licenses are retained here. The application uses the public RFB API; no upstream source has been modified.

Rebuild the bundled ES module from the repository root with `npx --yes esbuild@0.25.12 vendor-src/novnc/core/rfb.js --bundle --format=esm --outfile=dist/vendor/novnc/rfb.js`. The bundle intentionally retains top-level await used by upstream capability detection. Its MPL-2.0 license is also distributed beside the bundle. Dependencies under vendor/ retain their own license notices.

Upstream release archive SHA-256: `b1003a11b6e6e8d8f7f5e5586daae7f8ca651d8aee0aa155ff9ac841c48f52c6`.
