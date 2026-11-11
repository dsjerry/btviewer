# Development and architecture

[简体中文](./DEVELOPMENT.md)

## Architecture

```text
Electron + React renderer
        ↓ preload IPC
Electron main process ── aria2c (BT / HTTP / FTP / Metalink)
        └────────────── yt-dlp (video sites / HLS, optional)
        ↓
Local HTTP Range media stream → Video.js
```

The main process owns the download engine, persistence and media streaming. The renderer handles the UI and communicates through IPC exposed by the preload script.

## Requirements

- Node.js 20+ (22+ recommended) and npm
- Windows x64, Linux amd64 and Apple silicon macOS development environments use the bundled aria2c binaries
- Intel Macs need their own aria2c binary or an `ARIA2C_PATH` override
- yt-dlp is not needed for regular BT or direct downloads. See the [video sites guide](./video-sites.en.md) for optional dependencies.

## Common commands

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run verify       # typecheck + lint + tests
npm run build
```

`npm run smoke` starts the real app and a local file server to verify an end-to-end download. Build first and use Node.js 22+.

## Environment variables

```bash
ARIA2C_PATH=/absolute/path/to/aria2c npm run dev
FFMPEG_PATH=/absolute/path/to/ffmpeg npm run dev
```

## Project layout

- `electron/`: main process, download engine, IPC, media streaming and persistence
- `src/components/`: Home, Downloads, Library, Feeds, Player and Settings
- `src/services/`: renderer services, playlists and IPC types
- `tests/`: Vitest unit tests
- `resources/`: app icons, aria2c and media tools
- `scripts/`: dev launcher, icon generation and smoke test

After changing the source app icon, run `node scripts/generate-icons.mjs`. Do not edit generated assets directly; `tests/icons.test.ts` checks consistency.

See [installation and packaging](./installation.en.md) for build/signing details and the [testing guide](./testing.en.md) for test resources.

Main-process dependencies are bundled into the main-process output because packaged apps do not include `node_modules`. If changing the externalization settings in `electron.vite.config.ts`, ensure production bundles still include the required dependencies.
