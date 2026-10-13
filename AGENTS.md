# AGENTS.md

BTViewer：Electron + React 多协议下载器（aria2c 负责 BT/直链，yt-dlp 负责视频站点）。

## 验证命令

```bash
npm run typecheck  # tsc 类型检查
npm run lint       # eslint
npm test           # vitest（纯函数单测）
```

提交前至少跑 `npm run typecheck` 与 `npm test`。改到 `electron/` 或 `src/services/ipc.ts` 的 IPC 时，需同步更新 `electron/preload.ts` 与 `src/services/ipc.ts` 的类型。

## 结构约定

- `electron/`：主进程（aria2 RPC、流服务、yt-dlp 外挂、持久化）；`src/`：renderer，仅通过 preload 暴露的 IPC 通信。
- `electron/ytdlp-engine.ts`：yt-dlp 探测/下载的纯函数（进度与元信息解析、二进制/JS 运行时探测、格式选择）——可单测的部分尽量放这里。
- `electron/torrent-engine.ts`：任务编排、协议分流与降级序列（BT / 直链 / 视频站点）。

## YouTube 解析要点（易踩坑）

- yt-dlp 2025+ 解 YouTube `n` 签名挑战需要外部 JS 运行时，通过 `--js-runtimes` 传入；版本门槛 deno≥2.3、node≥22（bun 已废弃）；缺失时带 Cookies 会报 `n challenge solving failed`（Video unavailable / 只能 360p）。
- **Electron 内嵌的 Node 不可用**：它不是独立的 `node` 可执行文件（需 `ELECTRON_RUN_AS_NODE=1`，而 yt-dlp 自行 spawn 不会设），且 Electron 33 内嵌 Node 20 低于门槛，yt-dlp 会判为 `node-20.18.3 (unsupported)`。必须用外部 deno/node/bun。
- 带 Cookies 时用 `--extractor-args youtube:player_client=web_embedded,web_safari`：web_embedded 可给到 4K（vp9/av01），不可用时自动回退 web_safari（最高 1080p HLS）。默认客户端在登录会话下只返回 360p。
- Chrome/Edge 127+ 的 cookies 因 app-bound 加密常报 `Failed to decrypt with DPAPI`；推荐 Firefox。
- 下载格式优选「同容器」组合（`bv*[ext=mp4]+ba[ext=m4a]/bv*[ext=webm]+ba[ext=webm]/bv*+ba/b`）。**不要强制 avc1**：h264 在 YouTube 最高只有 1080p，会丢掉 4K；也不强制 `--merge-output-format`，让同容器自然产出 mp4/webm（Chromium 均可播）。
