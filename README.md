# BTViewer

简体中文 | [English](./README.en.md)

BTViewer 是一个基于 Electron 的本地多协议下载器。它支持解析磁力链接或 `.torrent` 文件、HTTP(S)/FTP 直链与 Metalink 下载，并可通过外挂 yt-dlp 解析下载视频站点（YouTube、Bilibili 等）。欢迎通过 [Issues](https://github.com/dsjerry/btviewer/issues) 反馈问题，参与贡献请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 当前架构

```text
Electron + React UI
        ↓ IPC
本地 aria2c（JSON-RPC）          yt-dlp（可选外挂）
  ├─ DHT / UDP Tracker / TCP Peer   ├─ 视频站点解析
  ├─ HTTP(S) / FTP 直链（分片加速）  └─ 音视频流下载
  └─ Metalink
        ↓
本地 HTTP Range 流服务
        ↓
Video.js 播放器
```

aria2 负责资源发现和下载（BT 与直链共用一个下载队列），yt-dlp 作为可选外挂负责视频站点，Electron 主进程负责 RPC 管理及本地媒体流转发，renderer 只负责界面和交互。

## 功能

- 解析磁力链接和 `.torrent` 文件，解析后展示完整文件列表
- 解析后选择下一步操作：
  - **保存到媒体库**：保留任务，不自动下载全部文件
  - **播放**：选择第一个可播放的视频或音频文件，并开始按需下载（数据未就绪时自动等待）
  - **下载全部资源**：选择任务中的全部文件并开始下载
- HTTP(S)/FTP 直链下载：多线程分片加速（每服务器连接数可调），与 BT 任务统一管理
- Metalink 文件：本地解析后按文件展开为直链任务，多镜像自动切换
- 视频站点（可选）：yt-dlp 可一键安装，网页类链接自动解析下载（解析 YouTube 高画质需 JS 运行时 deno，合并音视频需 ffmpeg，设置页均可一键安装）
- 媒体库管理：浏览任务文件、移除记录或删除任务与已下载文件
- 下载任务状态、速度、节点数、进度与剩余时间展示，支持暂停、恢复和移除
- 设置页：自定义下载目录、Tracker 列表、最大同时下载数（持久化并对新任务生效）
- 本地 HTTP Range 流播放（带访问令牌，防止本机其它进程读取）
- 单实例运行：安装包注册 `.torrent` / `.metalink` 文件关联与 `magnet` 协议，双击种子或点网页磁力链接会把任务交给已运行的实例处理；磁力默认关联可在设置页开关（默认不抢其它 BT 客户端的关联）
- 剪贴板监听（可选，默认关闭）：复制到磁力/直链时在应用内提示一键添加，不会自动开始下载；队列全部完成后可执行打开目录/文件、退出、关机、睡眠（关机带 60 秒取消窗口）
- 应用内日志查看（按级别过滤、只读文件尾部）与「复制诊断信息」（版本/引擎/设置/任务概况/最近错误，自动隐藏代理账号密码与本机用户名）；命令行 `BTViewer.exe --diagnostics` 可直接输出同一份诊断文本
- 界面语言：默认简体中文，可在设置页切换为 English（导航、首页、下载、媒体库、订阅、设置、播放器全部完成翻译；词条表 430+ 条，缺英文时自动回退中文）
- 自动注入公共 Tracker，支持通过环境变量或设置页自定义
- 自定义无边框窗口和深色媒体工作台界面，内置应用图标
- Windows（x64）与 Linux（amd64）开发环境内置 aria2c

## 环境要求

- Node.js 20+
- npm
- Electron 支持的平台
- aria2c：
  - Windows（x64）与 Linux（amd64）开发环境可直接使用项目内 `resources/aria2/win-x64`、`resources/aria2/linux-x64` 的二进制
  - macOS Apple 芯片可直接使用内置的 `resources/aria2/mac-arm64`；Intel 需自备 `resources/aria2/mac-x64/aria2c`

也可以通过环境变量指定 aria2c 路径：

```bash
ARIA2C_PATH=/absolute/path/to/aria2c npm run dev
```

内嵌封面提取与「兼容播放」（转封装/转码）同样使用 ffmpeg，可用 `FFMPEG_PATH` 指定自定义位置（未设置时依次查找应用内安装目录与 PATH）：

```bash
FFMPEG_PATH=/absolute/path/to/ffmpeg npm run dev
```

Linux 下如果使用系统 aria2：

```bash
sudo apt update
sudo apt install aria2
```

## 公共 Tracker 与 DHT

裸磁力链（只有 info-hash、没有 `tr=` 参数）只能通过 DHT 网络发现节点。部分网络会屏蔽 DHT 引导节点（表现为解析长期 0 节点），此时 tracker 是主要出路。应用会为每个任务自动注入内置的公共 tracker 快照，并支持环境变量覆盖：

```bash
# 覆盖注入的 tracker 列表（逗号或空白分隔）
ARIA2_TRACKERS="udp://tracker.example.org:1337/announce,https://tracker.example.com:443/announce" npm run dev

# 指定 DHT 引导节点（默认使用 router.bittorrent.com 等标准节点）
ARIA2_DHT_ENTRY_POINT="dht.example.org:6881" npm run dev
ARIA2_DHT_ENTRY_POINT6="[2001:db8::1]:6881" npm run dev
```

## 视频站点与 YouTube 高画质

网页类链接会交给 yt-dlp 解析下载（YouTube、Bilibili 等）。YouTube 的 1080p 及以上由分离的音视频流（DASH）或 HLS 分段提供，需要满足以下条件：

- **JS 运行时（必需）**：yt-dlp 2025+ 已弃用内置 JS 解释器，解 YouTube 的 `n` 签名挑战必须依赖外部运行时。应用按 `deno → node → bun` 的顺序探测系统已有的运行时（版本要求 deno ≥ 2.3 / node ≥ 22 / bun 1.2.11–1.3.14），命中即直接使用；都没有时，可在设置页「视频站点解析」卡片一键安装 deno（约 40MB）。**系统已装 node ≥ 22 的用户无需安装任何东西。**
  - 注意：Electron 内嵌的 Node **不能**用于此用途——它不是独立可执行文件（需 `ELECTRON_RUN_AS_NODE=1`，而 yt-dlp 自行 spawn 不会设置），且 Electron 33 内嵌的 Node 20 低于门槛，yt-dlp 会判为 `unsupported`。必须使用外部 deno/node/bun。
  - 缺失该运行时时，带 Cookies 的会话会报 `n challenge solving failed`（表现为 Video unavailable 或只能拿 360p）。
- **ffmpeg（可选）**：合并分离的音视频流（DASH）。未安装时只能下载预合并的单文件格式（YouTube 通常为 360p；配合 Cookies + web_safari 可拿到 1080p 的 HLS 单文件）。
- **浏览器 Cookies（可选）**：部分视频要求登录。配置后应用会使用 `web_embedded,web_safari` 客户端解析：`web_embedded` 可拿到 4K（vp9/av01），对部分视频不可用时自动回退到 `web_safari`（最高 1080p 的 HLS 单文件）。注意 Chrome/Edge 127+ 使用 app-bound 加密，常报 `Failed to decrypt with DPAPI` 读取失败，推荐 Firefox（运行中也通常可读）；读取时需完全退出对应浏览器。
- **代理（可选）**：访问 YouTube 需要能连通 Google 的网络，可在设置页填写 HTTP/SOCKS 代理。

yt-dlp、ffmpeg、deno 均可由设置页一键自动安装（下载到应用数据目录，不污染系统），三者采用同一套按需下载流程。下载格式默认优选「同容器」组合（`mp4 视频 + m4a 音频` 或 `webm 视频 + webm 音频`），合并后可直接被内置播放器（Chromium）播放；**不强制 h264**——h264 在 YouTube 最高只有 1080p，强制它会丢掉 4K（4K 仅 vp9/av01 提供）。任务因缺少运行时/ffmpeg 失败时，错误提示会直接指明对应的一键安装入口，安装完成后出错的视频任务会自动重试。

## 开发

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

类型检查：

```bash
npm run typecheck
```

类型检查 + lint + 单测一次跑完：

```bash
npm run verify
```

端到端冒烟测试（会启动真实应用与本地文件服务，验证「添加任务 → 真实下载 → 界面显示已完成」；需要先 `npm run build`，Windows 上已在 CI 中执行）：

```bash
npm run smoke
```

构建 renderer、主进程和 preload：

```bash
npm run build
```

## 测试磁力链接

以下链接均为 Blender 基金会开源电影（CC 授权、全球节点充足），用于测试解析、下载和播放：

**Sintel**（约 1.06 GB，MP4/H.264 可直接播放）

```text
magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80
```

**Big Buck Bunny**（约 263 MB，体积小，适合完整下载 + 播放验证）

```text
magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80
```

**Cosmos Laundromat**（约 700 MB）

```text
magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=Cosmos+Laundromat&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80
```

**裸磁力链版 Sintel**（不带任何 `tr=`，用于验证公共 tracker 自动注入——部分网络屏蔽 DHT 时，tracker 是主要节点来源）

```text
magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10
```

是否能获取 metadata 取决于资源当前是否仍有活跃 peer，以及当前网络是否允许 DHT、UDP Tracker 和 BitTorrent Peer 连接。裸磁力链解析失败时，可先确认 tracker 是否可达，或通过 `ARIA2_TRACKERS` / `ARIA2_DHT_ENTRY_POINT` 调整（见上文）。

## 目录说明

```text
electron/
  main.ts              Electron 主进程、窗口和 IPC
  preload.ts           安全 IPC bridge
  torrent-engine.ts    aria2 RPC、协议分流与本地媒体流服务
  ytdlp-engine.ts      yt-dlp 外挂（视频站点探测与下载）
  settings.ts          应用设置持久化（settings.json）
src/
  components/          首页、媒体库、下载任务、播放器和设置页
  services/ipc.ts      renderer 端 IPC 类型封装
  styles/global.css    自定义视觉系统
scripts/
  dev.mjs              开发启动器（隔离 ELECTRON_RUN_AS_NODE）
  generate-icons.mjs   从 logo.svg 生成应用图标
resources/
  aria2/               随应用分发的 aria2 二进制资源
  logo.svg             应用 logo 源文件
  icon.ico/.icns/.png  打包用图标（由 generate-icons.mjs 生成）
```

> 外挂依赖（yt-dlp / ffmpeg / deno）都可以在「设置 → 视频站点解析」里一键安装：
> Windows、macOS 全部由应用自动下载官方构建到用户目录（`~/Library/Application Support/BTViewer/bin`
> 或 `%APPDATA%\BTViewer\bin`），**不需要终端、pip 或 brew**。Linux 上 yt-dlp 与 deno 同样可一键安装，
> ffmpeg 仍建议由发行版包管理器提供（各发行版构建的编解码器差异大）。

## 打包说明

aria2 二进制按「平台-架构」分目录存放，`electron-builder.yml` 只把当前构建目标的 `${os}-${arch}` 复制进应用：

```text
Windows:    resources/aria2/win-x64/aria2c.exe      （或 win-arm64）
macOS:      resources/aria2/mac-arm64/aria2c        （内置；Intel 需补 mac-x64）
Linux:      resources/aria2/linux-x64/aria2c        （或 linux-arm64）
```

`npm run package:mac` 出 Apple 芯片（arm64）包；`package:mac:universal` 出 universal 包（需要 `mac-x64` 与 `mac-arm64` 两份二进制都在）。

Linux aria2 使用的动态库（`libaria2.so.0` 等）放在同一目录，或确保目标系统已经安装对应运行库。

> 内置媒体工具放在 `resources/media/<os>-<arch>/`，启动时自动复制到用户数据目录，用户无需任何操作；
> 当前提供 `mac-arm64`（ffmpeg/ffprobe 7.1.1，libx264 + VideoToolbox，仅依赖系统库，ad-hoc 签名），
> 由 ffmpeg 7.1.1 源码在本机编译（`--enable-libx264 --enable-videotoolbox`）；SHA-256 `aac9f523…6cba6c`（ffmpeg）、`2c946f48…00a121`（ffprobe）。

内置的 `mac-arm64/aria2c` 由官方 aria2 1.37.0 源码在本机 Apple 芯片上编译（静态链接 c-ares 1.34.9，AppleTLS，BitTorrent 支持），
只依赖系统自带库（libz / libSystem / Security / CoreFoundation / libc++），已做 ad-hoc 签名；SHA-256 `ca68feea…cbba51`。
以上二进制均以 `MACOSX_DEPLOYMENT_TARGET=11.0` 构建：若跟随本机系统用默认部署目标，编出的二进制会引用旧系统没有的符号
（如 macOS 26 才加入的 `_pipe2`），在 macOS 11–14 等真实用户机器上 dyld 加载即中止；CI 会校验 minos 防回归。
`mac-x64` 仍需自行补一份 Intel 二进制（官方 1.35.0 的 `aria2-1.35.0-osx-darwin` 即 x86_64，可直接使用）。

### macOS 签名状态

| 情况 | 构建结果 | 用户体验 |
| --- | --- | --- |
| 未配置任何 secrets | CI 自动做 **ad-hoc 签名**（`codesign -s - --options runtime`），再重新封 dmg/zip | 首次打开需右键→打开；开机自启不可用 |
| 配置 `CSC_LINK` / `CSC_KEY_PASSWORD` | Developer ID 签名 | 仍需公证才是「双击即开」 |
| 再加 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | 签名 + 公证 | 双击即开，开机自启可用 |

ad-hoc 签名只能消除「已损坏，无法打开」这类由未签名 arm64 二进制引起的误报，**不能**绕过 Gatekeeper 的
「无法验证开发者」提示——那需要 Developer ID 证书。CI 会校验最终包：既非 Developer ID 也非 ad-hoc 时直接失败。

本地打包：

```bash
npm run package:win     # Windows NSIS 安装包（含文件关联与 magnet 协议注册）
npm run package:mac     # macOS dmg + zip
npm run package:linux   # Linux AppImage + deb
```

发布走 GitHub Actions：[.github/workflows/release.yml](.github/workflows/release.yml) 是手动触发的工作流（Actions 页面填版本号，如 `v1.2.3`），会先规范化并写入 `package.json` 版本，再在 Windows / Linux 上打包（macOS 暂不打包：仓库内没有 macOS 版 aria2c 二进制），最后统一创建 GitHub Release 并附加产物；[.github/workflows/ci.yml](.github/workflows/ci.yml) 在每次 push / PR 上跑 lint、类型检查、单测与构建（`npm run verify` 可在本地一次跑完前三项）。

主进程依赖（如 fast-xml-parser）在构建时内联进主进程包，因此安装包内不再分发 `node_modules`——改动 `electron.vite.config.ts` 的 external 列表时需注意这一点。

## 安装与首次打开（macOS）

发布的 macOS 安装包目前是 **Apple 芯片（arm64）** 版本，且**未使用 Apple Developer 证书签名**
（签名与公证需要付费的开发者账号）。这不影响下载、播放与内置依赖的自动安装，但首次打开需要手动放行：

1. 把 `BTViewer.app` 拖进「应用程序」；
2. 按住 <kbd>Control</kbd> 点击应用图标 → 选择「打开」→ 再点一次「打开」；
3. 若仍提示「已损坏，无法打开」，在终端执行一次：

   ```bash
   xattr -dr com.apple.quarantine /Applications/BTViewer.app
   ```

未签名时系统**不允许注册开机自启**：需要在「系统设置 → 通用 → 登录项」里手动添加 BTViewer。
Intel Mac 目前没有预编译包，可按「开发」一节从源码构建（需要补 `resources/aria2/mac-x64/aria2c`）。

## 常见问题

### macOS 提示「无法验证开发者」或「已损坏」

见上一节。前者是未签名导致的常规提示，右键「打开」即可；后者通常是二进制被剥掉签名，
重新下载完整安装包即可（包内 `aria2c`、`ffmpeg/ffprobe` 均已签名）。

### aria2c ENOENT

表示找不到 aria2c。请安装 aria2，或者通过 `ARIA2C_PATH` 指定路径。

### RPC 服务未响应

检查 aria2c 是否能执行、动态库是否完整，以及本机是否有端口冲突。

### 解析成功但没有文件

磁力链接首先只能解析出 info hash。客户端还需要从 DHT、Tracker 或 Peer 获取 metadata。请检查网络、防火墙、代理和资源本身是否仍有活跃节点。

### 可以下载但无法播放

Chromium/Video.js 对视频编码和容器格式有支持边界。建议优先使用 MP4/H.264 或浏览器兼容的音频格式。

## 更新日志

各版本变更见 [CHANGELOG.md](CHANGELOG.md)；1.1.0 之前的版本未在该文件维护，可查看 [GitHub Releases](https://github.com/dsjerry/btviewer/releases)。

## 免责声明

本应用仅提供 BitTorrent、HTTP(S)/FTP 直链与 Metalink 协议的下载与播放功能，不内置、不推荐、不分发任何受版权保护的资源。使用者需自行确保下载与分享的内容合法，并承担相应的法律责任。

## 许可证

[MIT](./LICENSE)
