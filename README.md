# BTViewer

简体中文 | [English](./README.en.md)

BTViewer 是一个基于 Electron 的本地 BT 媒体工具。它负责解析磁力链接或 `.torrent` 文件，并提供保存到媒体库、播放可播放资源和下载全部资源三种操作。欢迎通过 [Issues](https://github.com/dsjerry/btviewer/issues) 反馈问题，参与贡献请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 当前架构

```text
Electron + React UI
        ↓ IPC
本地 aria2c（JSON-RPC）
        ↓
DHT / UDP Tracker / TCP Peer
        ↓
本地 HTTP Range 流服务
        ↓
Video.js 播放器
```

项目不再使用 WebTorrent 作为下载引擎。aria2 负责资源发现和下载，Electron 主进程负责 RPC 管理及本地媒体流转发，renderer 只负责界面和交互。

## 功能

- 解析磁力链接和 `.torrent` 文件，解析后展示完整文件列表
- 解析后选择下一步操作：
  - **保存到媒体库**：保留任务，不自动下载全部文件
  - **播放**：选择第一个可播放的视频或音频文件，并开始按需下载（数据未就绪时自动等待）
  - **下载全部资源**：选择任务中的全部文件并开始下载
- 媒体库管理：浏览任务文件、移除记录或删除任务与已下载文件
- 下载任务状态、速度、节点数、进度与剩余时间展示，支持暂停、恢复和移除
- 设置页：自定义下载目录、Tracker 列表、最大同时下载数（持久化并对新任务生效）
- 本地 HTTP Range 流播放（带访问令牌，防止本机其它进程读取）
- 自动注入公共 Tracker，支持通过环境变量或设置页自定义
- 自定义无边框窗口和深色媒体工作台界面，内置应用图标
- Windows（x64）与 Linux（amd64）开发环境内置 aria2c

## 环境要求

- Node.js 20+
- npm
- Electron 支持的平台
- aria2c：
  - Windows（x64）与 Linux（amd64）开发环境可使用项目内 `resources/aria2` 的二进制
  - macOS 及其它平台需自备对应平台的 aria2c 文件

也可以通过环境变量指定 aria2c 路径：

```bash
ARIA2C_PATH=/absolute/path/to/aria2c npm run dev
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
  torrent-engine.ts    aria2 RPC 与本地媒体流服务
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

## 打包说明

`electron-builder.yml` 已配置将 `resources/aria2` 复制到应用资源目录。跨平台发布时，需要分别提供：

```text
Linux:  resources/aria2/aria2c
Windows: resources/aria2/aria2c.exe
macOS:  resources/aria2/aria2c
```

Linux aria2 使用的动态库也需要随应用提供，或确保目标系统已经安装对应运行库。

## 常见问题

### aria2c ENOENT

表示找不到 aria2c。请安装 aria2，或者通过 `ARIA2C_PATH` 指定路径。

### RPC 服务未响应

检查 aria2c 是否能执行、动态库是否完整，以及本机是否有端口冲突。

### 解析成功但没有文件

磁力链接首先只能解析出 info hash。客户端还需要从 DHT、Tracker 或 Peer 获取 metadata。请检查网络、防火墙、代理和资源本身是否仍有活跃节点。

### 可以下载但无法播放

Chromium/Video.js 对视频编码和容器格式有支持边界。建议优先使用 MP4/H.264 或浏览器兼容的音频格式。

## 许可证

[MIT](./LICENSE)
