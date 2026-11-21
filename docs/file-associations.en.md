# File associations and opening from the system

BTViewer supports three "open from the system" entry points:

1. **Double-click a `.torrent` / `.metalink` file** (or pick BTViewer via "Open With") → task parsing flow
2. **Click a magnet link on a web page** (`magnet:` protocol) → task parsing flow
3. **Double-click / "Open With" a video or audio file** (mp4, mkv, flac, …) → imported into the media library and played right away (PotPlayer style)

This page documents how the associations are declared per platform, how the runtime routes the input, and how to make a changed declaration actually take effect.

## Where the declaration lives

| Platform | Mechanism | Location |
| --- | --- | --- |
| Windows | Installer-time file association / protocol registration | `fileAssociations` + `protocols` in `electron-builder.yml` (written by the NSIS wizard) |
| macOS | `Info.plist` document types | `mac.extendInfo` → `CFBundleDocumentTypes` + `UTImportedTypeDeclarations` |
| macOS magnet protocol | URL scheme | `mac.extendInfo` → `CFBundleURLTypes` (runtime toggle via settings uses `setAsDefaultProtocolClient`) |
| Linux | Desktop MIME associations | `fileAssociations` generates `.desktop` entries (AppImage/deb) |

## macOS specifics

The "Open With" candidate list is driven entirely by `Info.plist`. Two hard rules:

1. **`CFBundleDocumentTypes` is the only entry point**, and `LSHandlerRank: Default` is required for the app to be listed as a candidate (`Viewer` role = view only).
2. **Containers without a system UTI must be imported first.** LaunchServices does not know mkv, webm, wmv, flv, ogg or flac — declaring only `CFBundleTypeExtensions` often never shows up in "Open With". Declare the UTI under `UTImportedTypeDeclarations` (`org.matroska.mkv`, `org.xiph.flac`, … are the established reverse-DNS conventions), reference it via `LSItemContentTypes` in `CFBundleDocumentTypes`, and keep `CFBundleTypeExtensions` as a fallback.

UTIs already built into the system and directly referenceable: `public.mpeg-4` (mp4), `com.apple.m4v-video` (m4v), `com.apple.quicktime-movie` (mov), `public.avi`, `public.mpeg` (mpg/mpeg), `public.mpeg-2-transport-stream` (ts/m2ts), `public.mp3`, `public.mpeg-4-audio` (m4a), `com.microsoft.waveform-audio` (wav).

## Supported extensions and the "three places" rule

The single source of truth for media extensions is `VIDEO_EXTENSIONS` / `AUDIO_EXTENSIONS` in `electron/torrent-engine.ts` (used by `getFileType`). Three places must stay in sync when supported formats change:

| Location | Purpose |
| --- | --- |
| `electron/torrent-engine.ts` | The whitelist itself; `getFileType` derives video/audio/other from it |
| `MEDIA_FILE_RE` in `electron/launch-inputs.ts` | Collects media paths handed in from the system; **extra extensions get rejected at import time** by `getFileType` ("unsupported local media format") |
| `CFBundleDocumentTypes` in `electron-builder.yml` | The OS-level association declaration |

Currently supported: video `mp4 / mkv / avi / mov / webm / flv / wmv / m4v / ts / rmvb`, audio `mp3 / flac / wav / aac / ogg / m4a / wma`.

> Note: Chromium cannot decode wmv / flv / rmvb natively — they can be imported, but playback will offer the "compatibility transcode" path (ffmpeg produces a playable copy).

## Runtime flow

```
double-click / Finder "Open With" / command line / second launch
        │
        ├─ macOS: app.on('open-file')
        ├─ second launch: app.on('second-instance')
        └─ magnet link: app.on('open-url')
        │
        ▼
main.ts deliverInputs()
        │ collectLaunchInputs → task inputs (magnet / .torrent / .metalink)
        │ collectMediaLaunchInputs → media paths (mp4/mkv/…)
        ▼
renderer App.tsx
        ├─ ipc.onOpenInput  → ipc.addTask (BT goes to parsing, direct links queue right away)
        └─ ipc.onOpenMedia  → importAndPlay (batch import into library → play the first file)
```

Inputs received before the window is ready are queued in the main process (`pendingInputs` / `pendingMedia`) and flushed by `flushPendingInputs`.

## Making the declaration take effect

Associations are baked into the packaged `Info.plist`, so:

1. **Dev mode (`npm run dev`) never shows up in "Open With"** — the `electron.app` inside node_modules carries a generic Info.plist. Debug associations with a packaged build.
2. Rebuild with `npm run build` and **install** the result (drag into /Applications). If a new version still does not appear, refresh LaunchServices manually:

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/BTViewer.app
```

3. If the right-click "Open With" list is short, click "Other…" and switch the filter to "All Applications".
4. `LSHandlerRank: Default` means "a suitable default handler" — it does not steal an existing default; set BTViewer as default via Finder "Get Info → Open with → Change All…" if wanted.

## FAQ

- **BTViewer missing from the list**: confirm the installed build post-dates the declaration (search `CFBundleDocumentTypes` inside its `Info.plist`), then run `lsregister -f`.
- **Opened but nothing happened**: check the app log (Settings → Logs) for a `launch` entry ("received external input"). Absent → the extension is not in `MEDIA_FILE_RE`; present but rejected → the whitelist was not synced.
- **wmv/flv spins on open**: expected for undecodable containers — wait for the compatibility transcode prompt.
