<p align="center">
  <img src="./resources/icon.png" alt="BTViewer 应用图标" width="112" height="112">
</p>

<h1 align="center">BTViewer</h1>

<p align="center">多协议下载 · 本地媒体库 · 即下即播</p>

<p align="center">
  <strong>简体中文</strong> | <a href="./README.en.md">English</a>
</p>

BTViewer 是一款基于 Electron + React 的桌面下载与媒体播放应用，支持磁力 / torrent、HTTP(S) / FTP、Metalink，以及可选的 yt-dlp 视频站点与 HLS 下载。任务和导入的本地媒体可在媒体库中统一管理、归入合集并播放。

[下载发布版本](https://github.com/dsjerry/btviewer/releases) · [安装说明](./docs/INSTALLATION.md) · [开发指南](./docs/DEVELOPMENT.md) · [问题排查](./docs/TROUBLESHOOTING.md)

## 功能

- 解析磁力和 `.torrent`，可保存任务、边下边播或下载所选文件
- 支持 HTTP(S) / FTP 直链、Metalink，以及通过 yt-dlp 处理的 HLS 和视频站点
- 媒体库支持本地媒体导入、自定义合集、搜索、筛选与排序
- 内置播放器支持续播、跨任务播放列表、字幕及兼容播放
- RSS 订阅、批量任务控制、限速、Tracker 设置和下载完成动作
- 简体中文 / English 界面，支持 Windows、Linux 和 macOS

## 快速开始

**使用安装包：**从 [Releases](https://github.com/dsjerry/btviewer/releases) 下载对应平台版本。当前 macOS 发布包为 Apple 芯片（arm64），首次打开方式见[安装说明](./docs/INSTALLATION.md)。

**从源码运行：**需要 Node.js 20+（推荐 22+）和 npm。

```bash
npm install
npm run dev
```

BT 与直链下载不需要 yt-dlp。视频站点和 HLS 的可选依赖可在「设置 → 视频站点解析」中检查或安装，详见[视频站点指南](./docs/video-sites.md)。

## 文档

- [安装与打包](./docs/INSTALLATION.md)
- [开发、测试与项目结构](./docs/DEVELOPMENT.md)
- [视频站点与 YouTube 画质](./docs/video-sites.md)
- [测试指南与示例磁力](./docs/TESTING.md)
- [常见问题](./docs/TROUBLESHOOTING.md)
- [贡献指南](./CONTRIBUTING.md)
- [更新日志](./CHANGELOG.md)

本应用不内置或分发受版权保护的资源；使用者需自行确保下载与分享的内容合法。

[MIT License](./LICENSE)
