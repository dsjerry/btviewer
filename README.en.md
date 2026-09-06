# BTViewer

简体中文 | **English**

BTViewer is a local BitTorrent media workspace built on Electron. It parses magnet links and `.torrent` files, and lets you save a task to the media library, play the first playable media file on demand, or download everything in the torrent. Bug reports are welcome via [Issues](https://github.com/dsjerry/btviewer/issues); see [CONTRIBUTING.md](./CONTRIBUTING.md) to contribute.

## Architecture

```text
Electron + React UI
        ↓ IPC
Local aria2c (JSON-RPC)
        ↓
DHT / UDP tracker / TCP peers
        ↓
Local HTTP Range streaming server
        ↓
Video.js player
```

WebTorrent is no longer used as the download engine. aria2 handles resource discovery and downloading, the Electron main process manages the RPC session and forwards local media streams, and the renderer only handles UI.

## Features

- Parse magnet links and `.torrent` files, showing the full file list after parsing
- Choose what to do after parsing:
  - **Save to library**: keep the task without downloading anything yet
  - **Play**: pick the first playable video/audio file and download it on demand (automatically waits until data is ready)
  - **Download all**: select every file in the task and start downloading
- Media library management: browse task files, remove records, or delete tasks together with their downloaded files
- Download progress, speed, peer count and ETA with pause / resume / remove
- Settings page: custom download directory, tracker list and max concurrent downloads (persisted, applied to new tasks)
- Local HTTP Range streaming protected by an access token
- Public tracker auto-injection, customizable via the settings page or environment variables
- Frameless dark media workspace UI with a bundled app icon
- Bundled aria2c for Windows (x64) and Linux (amd64) development

## Requirements

- Node.js 20+
- npm
- Any platform supported by Electron
- aria2c:
  - Windows (x64) and Linux (amd64) development environments can use the binaries in `resources/aria2`
  - Other platforms (e.g. macOS) require a matching aria2c binary

You can also point the app at an aria2c binary via an environment variable:

```bash
ARIA2C_PATH=/absolute/path/to/aria2c npm run dev
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
  torrent-engine.ts    aria2 RPC and local media streaming
  settings.ts          App settings persistence (settings.json)
src/
  components/          Home, library, downloads, player and settings views
  services/ipc.ts      Renderer-side IPC typing
  styles/global.css    Visual system
scripts/
  dev.mjs              Dev launcher (isolates ELECTRON_RUN_AS_NODE)
  generate-icons.mjs   Generates app icons from logo.svg
resources/
  aria2/               Bundled aria2 binaries
  logo.svg             Logo source file
  icon.ico/.icns/.png  Packaging icons (generated by generate-icons.mjs)
```

## Packaging

`electron-builder.yml` copies `resources/aria2` into the app resources and uses `resources/icon.ico` / `icon.icns` / `icon.png` (regenerate with `node scripts/generate-icons.mjs` after editing `logo.svg`). Cross-platform releases require per-platform aria2c binaries:

```text
Linux:   resources/aria2/aria2c
Windows: resources/aria2/aria2c.exe
macOS:   resources/aria2/aria2c
```

## Troubleshooting

### aria2c ENOENT

aria2c was not found. Install it, or point `ARIA2C_PATH` at a binary.

### RPC service not responding

Check that aria2c can execute, that its dynamic libraries are complete, and that the port is not taken.

### Parsed successfully but no files

A magnet link initially only contains the info hash; the client still needs to fetch metadata from DHT, trackers or peers. Check your network, firewall and proxy, and whether the swarm is still alive.

### Downloaded but cannot play

Chromium/Video.js only supports a subset of codecs. Prefer MP4/H.264 or browser-compatible audio formats.

## License

[MIT](./LICENSE)
