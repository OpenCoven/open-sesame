# iOS host spike for issue #38

Throwaway code, not part of the app. It tests the condition attached to the mobile host decision in #35 (ADR 002): a Tauri 2 app must build for the iOS simulator on the current Xcode, block navigation away from bundled assets, keep everything except the app's own bundled document away from the request gate, and round-trip a credential through the Keychain.

It was written before the desktop walking skeleton exists, so it uses a minimal Tauri app instead of the real core. The proofs must be repeated against the skeleton when #38 starts properly.

## Run

```sh
npm install
npx tauri ios init
npx tauri ios build --target aarch64-sim --debug --ci
xcrun simctl install <device> src-tauri/gen/apple/build/arm64-sim/OpenSesameSpike.app
xcrun simctl launch <device> ai.opencoven.opensesame.spike
```

The app runs its probes on launch and writes `spike-report.json` to its Application Support directory in the simulator's data container (`xcrun simctl get_app_container <device> ai.opencoven.opensesame.spike data`). Launch it a second time to see the Keychain value written by the previous launch.

`tauri ios init` needs rustup with the `aarch64-apple-ios-sim` target, XcodeGen and CocoaPods, and installs `libimobiledevice` with Homebrew if it is missing.
