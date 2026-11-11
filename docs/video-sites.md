# 视频站点与 HLS

[English](./video-sites.en.md)

视频网页链接和 `.m3u8` 由可选外挂 yt-dlp 处理。BT、HTTP(S)、FTP 和 Metalink 下载不依赖 yt-dlp。

## 依赖

- **JS 运行时**：YouTube 的签名挑战需要外部运行时。推荐 Deno 2.3+ 或独立安装的 Node.js 22+。Electron 内嵌的 Node 不是可供 yt-dlp 使用的独立程序；不要依赖它。
- **ffmpeg**：合并分离的音视频流。缺少时通常只能使用预合并格式，画质可能较低。
- **Cookies（可选）**：用于需要登录的视频。Chrome / Edge 的应用绑定加密可能导致读取失败，Firefox 通常更适用。
- **代理（可选）**：可在设置页配置 HTTP 或 SOCKS 代理。

yt-dlp、Deno 与 ffmpeg 的检测和安装入口位于「设置 → 视频站点解析」。安装能力依平台而异。

## YouTube 画质说明

- 推荐使用外部 Deno 2.3+ 或 Node.js 22+ 处理 `n` 签名挑战；Bun 已不再作为推荐运行时。
- 配置 Cookies 后，应用使用 `web_embedded`，不可用时回退到 `web_safari`。
- 格式选择优先匹配容器（如 MP4 + M4A 或 WebM + WebM），不强制 H.264，以免排除 VP9 / AV1 的高分辨率流。
- 某些任务因缺少运行时或 ffmpeg 失败时，可从设置页安装依赖；错误任务会按应用策略自动重试。

若仍失败，请检查应用日志与「复制诊断信息」，并确认 yt-dlp、运行时、代理和 Cookies 的配置。
