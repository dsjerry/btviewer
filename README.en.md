<p align="center">
  <img src="./resources/icon.png" alt="BTViewer app icon" width="144" height="144">
</p>

<h1 align="center">BTViewer</h1>

<p align="center">Multi-protocol downloads · Local media library · Stream while downloading</p>

<p align="center">
  <a href="./README.md">简体中文</a> | <strong>English</strong>
</p>

BTViewer is a desktop downloader and media player built with Electron + React. It supports magnet links, `.torrent` files, HTTP(S)/FTP direct downloads, Metalink, and HLS (`.m3u8`) and video sites such as YouTube and Bilibili through yt-dlp. Browse download tasks and imported local media together, organize them into custom collections, and watch them in the built-in player.

Bug reports are welcome via [Issues](https://github.com/dsjerry/btviewer/issues); see [CONTRIBUTING.md](./CONTRIBUTING.md) to contribute.

## Architecture

```text
Electron + React UI
        ↓ IPC
Local aria2c (JSON-RPC)             yt-dlp (optional)
  ├─ DHT / UDP tracker / TCP peers   ├─ Video sites / HLS
  ├─ HTTP(S) / FTP direct downloads  └─ Audio/video downloads
  └─ Metalink
        ↓
Local HTTP Range streaming server
        ↓
Video.js player
```

aria2 handles resource discovery and downloading, with BT and direct downloads sharing a queue. yt-dlp handles video sites and HLS. The Electron main process manages RPC, local media and collection persistence, and media streaming; the renderer only handles UI.

## Features

- Parse magnet links and `.torrent` files, showing the full file list after parsing
- Choose what to do after parsing:
  - **Save to library**: keep the task without downloading anything yet
  - **Play**: pick the first playable video/audio file and download it on demand (automatically waits until data is ready)
  - **Download all**: select every file in the task and start downloading
- HTTP(S)/FTP direct downloads with multiple connections per server, managed alongside BT tasks
- Metalink files expanded into direct download tasks with mirror fallback
- HLS (`.m3u8`) playlist and segment downloads through yt-dlp, with ffmpeg used for merging or remuxing when needed
- Video-site downloads through optional yt-dlp, with one-click dependency installation in Settings
- Import local video/audio through the file picker, or drop files onto the window to play them; the library stores references without copying the originals
- Grid and list library views, search, type and watch-status filters, and sorting by name, size, date added or last watched
- Custom collections: create, rename and delete groups; add or remove download tasks and local media in batches; an item can belong to multiple collections, and deleting a collection does not delete files
- Library cleanup removes records by default, with an explicit option to also clean up files on disk
- Built-in player with resume playback, cross-task episode playlists, previous/next episode and autoplay, subtitle matching and external SRT/VTT; picture-in-picture, snapshots, clip recording and 3D views depend on platform and media-format support
- RSS subscriptions with keyword filtering, automatic downloads and season grouping
- Download progress, speed, peer count and ETA with pause / resume / remove
- Settings page: custom download directory, tracker list and max concurrent downloads (persisted, applied to new tasks)
- Local HTTP Range streaming protected by an access token
- Single-instance handling, `.torrent` / `.metalink` file associations and the `magnet` protocol; default magnet association is opt-in
- Optional clipboard monitoring with an add-task prompt, and queue-completion actions such as opening a folder, exiting, shutting down or sleeping
- In-app logs and redacted diagnostics; `BTViewer.exe --diagnostics` also prints diagnostics from the command line
- Simplified Chinese and English UI, with Chinese fallback for untranslated strings
- Public tracker auto-injection, customizable via the settings page or environment variables
- Frameless UI, collapsible sidebar, light / dark / system themes and a consistent bundled app icon
- Bundled aria2c for Windows (x64), Linux (amd64) and macOS Apple silicon (arm64) development

## Quick start

1. **Add a resource**: paste a magnet, direct download, `.m3u8` or video-page link on Home, or open a `.torrent` / `.metalink` file.
2. **Choose an action**: save the parsed task to the library, select a playable file, or download everything. Track progress in Downloads.
3. **Organize your media**: import local video/audio in Library, select entries and add them to a collection. Deleting a collection only removes the grouping, not the media files.
4. **Check optional dependencies**: before using video sites or HLS, check yt-dlp, ffmpeg and the JS runtime under **Settings → Video sites**. Regular BT and direct downloads do not need yt-dlp.

## Requirements

- Node.js 20+ (22+ recommended; smoke tests and using Node as YouTube's external JS runtime require 22+)
- npm
- Any platform supported by Electron
- aria2c:
  - Windows (x64) and Linux (amd64) dev environments can use `resources/aria2/win-x64` and `resources/aria2/linux-x64`
  - Apple silicon macOS can use the bundled `resources/aria2/mac-arm64/aria2c`; Intel requires a binary in `resources/aria2/mac-x64/`

You can also point the app at an aria2c binary via an environment variable:

```bash
ARIA2C_PATH=/absolute/path/to/aria2c npm run dev
```

Embedded cover extraction and compatibility playback also use ffmpeg. Set `FFMPEG_PATH` to override the bundled or system binary:

```bash
FFMPEG_PATH=/absolute/path/to/ffmpeg npm run dev
```

## Public trackers and DHT

A bare magnet link (info hash only, no `tr=` parameters) can only discover peers through the DHT network. Some networks block the DHT bootstrap nodes, in which case trackers are the main fallback. The app automatically injects a built-in public tracker snapshot for every task, and you can override it:

```bash
# Override the injected tracker list (comma or whitespace separated)
ARIA2_TRACKERS="udp://tracker.example.org:1337/announce,https://tracker.example.com:443/announce" npm run dev

# Point DHT bootstrap at a reachable node (defaults to router.bittorrent.com etc.)
ARIA2_DHT_ENTRY_POINT="dht.example.org:6881" npm run dev
ARIA2_DHT_ENTRY_POINT6="[2001:db8::1]:6881" npm run dev
```

## Development

```bash
npm install
npm run dev        # start the dev environment
npm run typecheck  # TypeScript checks
npm run build      # build renderer / main / preload
```

Run type checks, ESLint and unit tests together:

```bash
npm run verify
```

The end-to-end smoke test starts the real application and a local file server to verify adding, downloading and completing a task. It requires a prior build and Node.js 22+, and runs in Windows CI:

```bash
npm run build
npm run smoke
```

## Video sites and high-quality YouTube downloads

Video-page links and HLS playlists are handled by yt-dlp. YouTube's high-resolution video and audio streams may be separate:

- **External JS runtime**: YouTube signature challenges require a supported external runtime, preferably deno ≥ 2.3 or Node.js ≥ 22. The app checks installed runtimes automatically; deno can also be installed from Settings. Electron's embedded Node is not a standalone executable and cannot serve this purpose.
- **ffmpeg**: needed to merge separate audio/video streams. Without it, available single-file formats may have lower resolution.
- **Browser cookies**: optional for videos that require login. With cookies, the app tries `web_embedded,web_safari` clients. Chrome/Edge's app-bound encryption can prevent cookie extraction; Firefox is recommended.
- **Proxy**: configure an HTTP/SOCKS proxy in Settings if required by your network.

Install yt-dlp, ffmpeg and deno from **Settings → Video sites**, subject to platform availability. Format selection prefers matching containers (`mp4 + m4a` or `webm + webm`) and does not force H.264, which would exclude YouTube's 4K formats. Some failed video tasks automatically retry after a missing dependency is installed.

## Test magnets

All test links are Blender Foundation open movies (CC licensed, well seeded):

**Sintel** (~1.06 GB, MP4/H.264, plays directly)

```text
magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80
```

**Big Buck Bunny** (~263 MB, small enough for a full download + playback test)

```text
magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80
```

**Cosmos Laundromat** (~700 MB)

```text
magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=Cosmos+Laundromat&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80
```

**Bare Sintel** (no `tr=` parameters, for testing public tracker auto-injection)

```text
magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10
```

Whether metadata can be fetched depends on the swarm still having active peers and on your network allowing DHT, UDP trackers and BitTorrent peer connections. If a bare magnet fails to resolve, check tracker reachability first, or adjust `ARIA2_TRACKERS` / `ARIA2_DHT_ENTRY_POINT` as described above.

## Project layout

```text
electron/
  main.ts              Main process, window and IPC
  preload.ts           Secure IPC bridge
  torrent-engine.ts    aria2 RPC, protocol routing and local media streaming
  ytdlp-engine.ts      Video-site probing and download helpers
  local-media.ts       Local media references
  media-collections.ts Custom collection persistence
  settings.ts          App settings persistence (settings.json)
src/
  components/          Home, library, downloads, feeds, player and settings views
  services/ipc.ts      Renderer-side IPC typing
  styles/global.css    Visual system
scripts/
  dev.mjs              Dev launcher (isolates ELECTRON_RUN_AS_NODE)
  generate-icons.mjs   Generates platform icons and an SVG wrapper from the source PNG
resources/
  aria2/               Bundled aria2 binaries
  media/               ffmpeg/ffprobe binaries by platform and architecture
  霓虹绿媒体下载播放器图标.png  Original icon artwork
  logo.svg             Generated wrapper embedding the PNG (not vector artwork)
  icon.ico/.icns/.png  Packaging icons (generated by generate-icons.mjs)
```

> yt-dlp, ffmpeg and deno can all be installed from **Settings → Video sites** with one click:
> Windows and macOS get the official builds downloaded automatically into the user data folder
> (`~/Library/Application Support/BTViewer/bin` or `%APPDATA%\BTViewer\bin`) — no terminal, pip or brew needed.
> On Linux yt-dlp and deno are also one-click; ffmpeg is best left to the distribution package manager.
>
> Bundled media tools live in `resources/media/<os>-<arch>/` and are copied into the user data folder on startup.
> `mac-arm64` currently ships ffmpeg/ffprobe 7.1.1 (libx264 + VideoToolbox, system libraries only, ad-hoc signed; SHA-256 `aac9f523…6cba6c` / `2c946f48…00a121`).

## App icons

The README, sidebar and About view use `resources/icon.png`. The source artwork is `resources/霓虹绿媒体下载播放器图标.png`. After updating the source, run from the project root:

```bash
node scripts/generate-icons.mjs
```

The generator preserves the original, normalizes transparent padding and produces the following files. Do not edit generated files directly.

| File | Sizes | Purpose |
| --- | --- | --- |
| `resources/icon.png` | 512 × 512 | README, in-app icon, tray and Linux packaging |
| `resources/icon.ico` | 16 / 32 / 48 / 64 / 128 / 256px | Windows app and shortcuts |
| `resources/icon.icns` | 16 / 32 / 64 / 128 / 256 / 512 / 1024px | macOS and Retina displays |
| `resources/logo.svg` | Embedded source PNG | SVG compatibility wrapper, not true vector artwork |

`tests/icons.test.ts` checks icon consistency. Rebuild and reinstall the app to update desktop and Dock icons.

## Packaging

`electron-builder.yml` copies the target `${os}-${arch}` subdirectory of `resources/aria2` into the app resources and uses `resources/icon.ico` / `icon.icns` / `icon.png`. Lay out the binaries as:

```text
Windows: resources/aria2/win-x64/aria2c.exe   (or win-arm64)
macOS:   resources/aria2/mac-arm64/aria2c     (mac-x64 for Intel)
Linux:   resources/aria2/linux-x64/aria2c     (or linux-arm64)
```

`npm run package:mac` builds an Apple silicon (arm64) bundle; `package:mac:universal` produces a universal build, which needs both `mac-x64` and `mac-arm64` binaries present.

Local packaging commands:

```bash
npm run package:win
npm run package:mac
npm run package:linux
```

Releases use the manually triggered [.github/workflows/release.yml](.github/workflows/release.yml): enter a version such as `v1.2.3`, then the workflow updates the package version, verifies and packages Windows, Linux and macOS arm64 builds, and publishes the artifacts to a GitHub Release. [.github/workflows/ci.yml](.github/workflows/ci.yml) runs lint, type checks, tests and builds on all three platforms for pushes to `main` and pull requests, plus a Windows smoke test.

### Code signing on macOS

| Setup | Result | User experience |
| --- | --- | --- |
| No secrets configured | CI ad-hoc signs the bundle (`codesign -s - --options runtime`) and re-creates the dmg/zip | Right-click → Open on first launch; login item unavailable |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Developer ID signature | Still needs notarization for a seamless launch |
| Plus `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | Signed and notarized | Opens normally, login item works |

Ad-hoc signing only removes the spurious "damaged" error caused by unsigned arm64 binaries; it does **not**
bypass Gatekeeper's "unidentified developer" prompt — that requires a Developer ID certificate. CI fails the
build if the bundle ends up neither Developer ID nor ad-hoc signed.

The bundled `mac-arm64/aria2c` is built from aria2 1.37.0 sources on Apple silicon (static c-ares, AppleTLS, BitTorrent enabled) and only links system libraries (libz / libSystem / Security / CoreFoundation / libc++); it is ad-hoc signed, SHA-256 `ca68feea…cbba51`. All three binaries are built with `MACOSX_DEPLOYMENT_TARGET=11.0`: the SDK default follows the build machine's OS version, and such binaries reference symbols missing on older macOS (e.g. `_pipe2`, added in macOS 26), making dyld abort at load; CI guards the deployment target (minos) against the runner's OS version. For `mac-x64`, the official `aria2-1.35.0-osx-darwin` build (x86_64) works as-is.

## Installing on macOS

Released macOS builds are **Apple silicon (arm64) only** and are **not signed with an Apple Developer
certificate** (code signing and notarization require a paid developer account). Downloading, playback and
the one-click dependency installation all work; the first launch just needs a manual override:

1. Drag `BTViewer.app` into *Applications*;
2. <kbd>Control</kbd>-click the app → *Open* → *Open* again;
3. If macOS still says the app is damaged, run once in Terminal:

   ```bash
   xattr -dr com.apple.quarantine /Applications/BTViewer.app
   ```

Unsigned builds cannot register a login item, so enable "open at login" manually under
*System Settings → General → Login Items*. There is no prebuilt Intel build yet — build from source
(see *Development*), which also needs `resources/aria2/mac-x64/aria2c`.

## Troubleshooting

### macOS says "cannot verify the developer" or "is damaged"

See the section above — the warning is expected for unsigned builds. "Damaged" usually means the bundle
lost its signature; re-download the full package (the bundled `aria2c` and `ffmpeg/ffprobe` are signed).

### aria2c ENOENT

aria2c was not found. Install it, or point `ARIA2C_PATH` at a binary.

### RPC service not responding

Check that aria2c can execute, that its dynamic libraries are complete, and that the port is not taken.

### Parsed successfully but no files

A magnet link initially only contains the info hash; the client still needs to fetch metadata from DHT, trackers or peers. Check your network, firewall and proxy, and whether the swarm is still alive.

### Downloaded but cannot play

Chromium/Video.js only supports a subset of codecs. Prefer MP4/H.264 or browser-compatible audio formats.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history. Versions before 1.1.0 are not maintained in that file; see [GitHub Releases](https://github.com/dsjerry/btviewer/releases) instead.

## Disclaimer

This application provides multi-protocol downloads, local media management and playback. It does not bundle, recommend or distribute any copyrighted material. Users are responsible for ensuring that what they download and share is legal in their jurisdiction.

## License

[MIT](./LICENSE)
