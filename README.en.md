<p align="center">
  <img src="./resources/icon.png" alt="BTViewer app icon" width="112" height="112">
</p>

<h1 align="center">BTViewer</h1>

<p align="center">Multi-protocol downloads · Local media library · Stream while downloading</p>

<p align="center">
  <a href="./README.md">简体中文</a> | <strong>English</strong>
</p>

BTViewer is an Electron + React desktop downloader and media player. It supports magnets and torrents, HTTP(S) / FTP, Metalink, plus optional yt-dlp support for HLS and video sites. Browse downloads and imported local media together, organize them into collections, and play them in the built-in player.

[Download releases](https://github.com/dsjerry/btviewer/releases) · [Installation](./docs/installation.en.md) · [Development](./docs/development.en.md) · [Troubleshooting](./docs/troubleshooting.en.md)

## Features

- Parse magnets and `.torrent` files; save tasks, stream while downloading, or download selected files
- HTTP(S) / FTP direct downloads, Metalink, and yt-dlp-powered HLS and video sites
- Local media import, custom collections, search, filters and sorting in the media library
- Built-in player with resume playback, cross-task playlists, subtitles and compatibility playback
- RSS subscriptions, batch task controls, speed limits, tracker settings and post-download actions
- Simplified Chinese / English UI; Windows, Linux and macOS support

## Quick start

**Use a release build:** download the package for your platform from [Releases](https://github.com/dsjerry/btviewer/releases). Current macOS releases target Apple silicon (arm64); see the [installation guide](./docs/installation.en.md) for first launch.

**Run from source:** Node.js 20+ (22+ recommended) and npm are required.

```bash
npm install
npm run dev
```

BT and direct downloads do not need yt-dlp. Optional dependencies for video sites and HLS can be checked or installed under **Settings → Video sites**. See the [video sites guide](./docs/video-sites.en.md).

## Documentation

- [Installation and packaging](./docs/installation.en.md)
- [Development, tests and project layout](./docs/development.en.md)
- [Video sites and YouTube quality](./docs/video-sites.en.md)
- [Testing guide and sample magnets](./docs/testing.en.md)
- [Troubleshooting](./docs/troubleshooting.en.md)
- [Contributing](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)

BTViewer does not bundle or distribute copyrighted content. Users are responsible for ensuring their downloads and sharing are lawful.

[MIT License](./LICENSE)
