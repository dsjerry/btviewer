# 开发与架构

[English](./development.en.md)

## 架构

```text
Electron + React renderer
        ↓ preload IPC
Electron main process ── aria2c（BT / HTTP / FTP / Metalink）
        └────────────── yt-dlp（视频站点 / HLS，可选）
        ↓
本地 HTTP Range 媒体流 → Video.js
```

主进程负责下载引擎、持久化和媒体流；renderer 只负责界面，通过 preload 暴露的 IPC 与主进程通信。

可选 AI 功能的分工：

```text
renderer：MediaPipe（手势 HandLandmarker / 人脸 FaceLandmarker）+ ONNX Runtime Web（SFace）
        ↑ ai:// 协议读取 WASM 与模型        ↓ IPC 提交结果
主进程：ai-models（下载、SHA256 校验）、people-store（people.json）、ffmpeg 抽帧与探测时长
```

- 手势控制详见 [手势识别](./gesture-control.md)
- 人物合集详见 [人物合集：人脸分析](./face-analysis.md)

## 环境要求

- Node.js 20+，推荐 22+；npm
- Windows x64、Linux amd64 与 macOS Apple 芯片开发环境使用仓库内的 aria2c
- Intel Mac 需自行提供 aria2c，或通过 `ARIA2C_PATH` 指定
- 常规 BT / 直链开发不需要 yt-dlp；视频站点与 HLS 依赖说明见[视频站点文档](./video-sites.md)

## 常用命令

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run verify       # typecheck + lint + tests
npm run build
```

`npm run smoke` 会启动真实应用和本地文件服务，验证完整下载流程；需要先构建，并使用 Node.js 22+。

## 环境变量

```bash
ARIA2C_PATH=/absolute/path/to/aria2c npm run dev
FFMPEG_PATH=/absolute/path/to/ffmpeg npm run dev
```

## 目录结构

- `electron/`：主进程、下载引擎、IPC、媒体流与持久化；`ai-models.ts` 管理可选模型，`people-store.ts` 管理人物数据与抽帧
- `src/components/`：首页（影院化媒体库）、人物页（PeoplePage）、下载浮层（DownloadsPanel）、播放器和设置
- `src/services/`：renderer 服务、播放列表与 IPC 类型；`gesture.ts` / `hand-tracker.ts` 为手势，`face-*.ts` / `people*.ts` 为人物合集
- `tests/`：Vitest 单元测试
- `resources/`：应用图标、aria2c 与媒体工具
- `scripts/`：开发启动器、图标生成与冒烟测试

修改应用图标母版后运行 `node scripts/generate-icons.mjs`。生成资源不要手动编辑；一致性由 `tests/icons.test.ts` 检查。

更多打包与签名说明见[安装与打包](./INSTALLATION.md)，测试资源见[测试指南](./TESTING.md)。

主进程依赖会内联进主进程 bundle，因为安装包不包含 `node_modules`。修改 `electron.vite.config.ts` 的 external 配置时，需确认生产包仍包含对应依赖。
