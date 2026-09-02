# BTViewer

BTViewer 是一个基于 Electron 的本地 BT 媒体工具。它负责解析磁力链接或 `.torrent` 文件，并提供保存到媒体库、播放可播放资源和下载全部资源三种操作。

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

- 解析磁力链接和 `.torrent` 文件
- 解析后选择下一步操作：
  - **保存到媒体库**：保留任务，不自动下载全部文件
  - **播放**：选择第一个可播放的视频或音频文件，并开始按需下载
  - **下载全部资源**：选择任务中的全部文件并开始下载
- 下载任务状态、速度、节点数和进度展示
- 暂停、恢复和移除任务
- 本地 HTTP Range 流播放
- 自定义无边框窗口和深色媒体工作台界面
- Linux amd64 开发环境内置 aria2c

## 环境要求

- Node.js 20+
- npm
- Electron 支持的平台
- aria2c：
  - Linux 开发环境可使用项目内的 `resources/aria2/aria2c`
  - Windows 和 macOS 需要准备对应平台的 aria2c 文件

也可以通过环境变量指定 aria2c 路径：

```bash
ARIA2C_PATH=/absolute/path/to/aria2c npm run dev
```

Linux 下如果使用系统 aria2：

```bash
sudo apt update
sudo apt install aria2
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

下面的链接用于测试解析、节点发现、metadata 获取和媒体文件列表：

```text
magnet:?xt=urn:btih:2DD9DE911E0AEADCE51C9A6D6DF96B21C0524458
```

该链接只包含 info hash，没有显式 Tracker。是否能获取 metadata 取决于资源当前是否仍有活跃 peer，以及当前网络是否允许 DHT、UDP Tracker 和 BitTorrent Peer 连接。

## 目录说明

```text
electron/
  main.ts              Electron 主进程、窗口和 IPC
  preload.ts           安全 IPC bridge
  torrent-engine.ts    aria2 RPC 与本地媒体流服务
src/
  components/          首页、媒体库、下载任务和播放器
  services/ipc.ts      renderer 端 IPC 类型封装
  styles/global.css    自定义视觉系统
resources/aria2/       随应用分发的 aria2 二进制资源
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

MIT
