# Video sites and HLS

[简体中文](./video-sites.md)

Video-page links and `.m3u8` playlists are handled by the optional yt-dlp dependency. BT, HTTP(S), FTP and Metalink downloads do not need yt-dlp.

## Dependencies

- **JavaScript runtime:** YouTube signature challenges require an external runtime. Use Deno 2.3+ or standalone Node.js 22+. Electron's embedded Node is not a standalone executable that yt-dlp can use; do not rely on it.
- **ffmpeg:** merges separate audio/video streams. Without it, yt-dlp may only offer pre-merged formats at lower resolutions.
- **Cookies (optional):** for videos that require login. App-bound encryption can prevent extraction from Chrome / Edge; Firefox is often more reliable.
- **Proxy (optional):** configure an HTTP or SOCKS proxy in Settings.

yt-dlp, Deno and ffmpeg detection and installation are available under **Settings → Video sites**. Install options depend on the platform.

## YouTube quality notes

- Use external Deno 2.3+ or Node.js 22+ for `n` signature challenges. Bun is no longer a recommended runtime.
- With cookies configured, the app tries `web_embedded` and falls back to `web_safari` when unavailable.
- Format selection prefers matching containers (such as MP4 + M4A or WebM + WebM) and does not force H.264, which could exclude high-resolution VP9 / AV1 streams.
- If a task fails because a runtime or ffmpeg is missing, install it in Settings; failed tasks are retried according to the app's retry policy.

If a download still fails, check the app logs and redacted diagnostics, then verify yt-dlp, runtime, proxy and cookie settings.
