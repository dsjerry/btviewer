# Installation and packaging

[简体中文](./INSTALLATION.md) · [Download releases](https://github.com/dsjerry/btviewer/releases)

## Release packages

- Windows: NSIS installer
- Linux: AppImage / deb
- macOS: Apple silicon (arm64) builds are currently provided. Intel users must build from source and provide an Intel aria2c binary.

### First launch on macOS

Current macOS packages are not signed with an Apple Developer ID certificate. Control-click `BTViewer.app`, choose **Open**, then confirm.

If macOS still reports that the app is damaged, run:

```bash
xattr -dr com.apple.quarantine /Applications/BTViewer.app
```

Without Developer ID signing, macOS will not allow the app to register a login item. Add it manually under **System Settings → General → Login Items**.

## Build packages from source

```bash
npm run package:win
npm run package:mac
npm run package:linux
```

Other targets include `package:mac:arm64`, `package:mac:x64` and `package:mac:universal`. A universal build needs both `mac-x64` and `mac-arm64` aria2c binaries.

`electron-builder.yml` copies the matching `resources/aria2` directory:

| Platform | Directory |
| --- | --- |
| Windows | `win-x64` or `win-arm64` |
| macOS | `mac-arm64` or `mac-x64` |
| Linux | `linux-x64` or `linux-arm64` |

Linux aria2c shared libraries must be next to the binary or installed on the target system. Bundled media tools live in `resources/media/<os>-<arch>/` and are copied to the user data directory at startup.

### Bundled macOS binary notes

- aria2c is built from aria2 1.37.0 with static c-ares 1.34.9, AppleTLS and BitTorrent support. SHA-256: `ca68feea…cbba51`.
- ffmpeg / ffprobe 7.1.1 include libx264 and VideoToolbox. SHA-256: `aac9f523…6cba6c` / `2c946f48…00a121`.
- These binaries use `MACOSX_DEPLOYMENT_TARGET=11.0`. Preserve the minimum OS target when updating them; CI checks the Mach-O `minos`.
- Intel Macs can use the official `aria2-1.35.0-osx-darwin` binary as `mac-x64/aria2c`.

## macOS signing

| Configuration | Result |
| --- | --- |
| No signing secrets | CI applies ad-hoc signing; users must manually approve the first launch |
| `CSC_LINK` + `CSC_KEY_PASSWORD` | Developer ID signature; Gatekeeper may still prompt without notarization |
| Also configure `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Signed and notarized; opens normally |

GitHub Actions releases are manually triggered. The CI workflow runs cross-platform validation and builds.
