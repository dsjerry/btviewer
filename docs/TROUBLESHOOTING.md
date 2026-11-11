# 常见问题

[English](./troubleshooting.en.md)

## 磁力链接长时间没有文件列表

裸磁力链接只有 info-hash，客户端还需从 DHT、Tracker 或 Peer 获取 metadata。部分网络会屏蔽 DHT 引导节点或 UDP Tracker；也可能是资源已没有活跃节点。可尝试：

- 确认其他 BT 客户端能否解析同一资源；
- 检查防火墙、代理和网络是否允许 DHT / UDP Tracker / Peer 连接；
- 在设置页配置 Tracker，或用 `ARIA2_TRACKERS` 覆盖内置 Tracker 列表；
- 用 `ARIA2_DHT_ENTRY_POINT` / `ARIA2_DHT_ENTRY_POINT6` 指定可达的 DHT 引导节点。

开发时也可通过环境变量覆盖：

```bash
ARIA2_TRACKERS="<逗号或空格分隔的 Tracker URL>" npm run dev
ARIA2_DHT_ENTRY_POINT="<主机名>:<端口>" npm run dev
ARIA2_DHT_ENTRY_POINT6="[<IPv6 地址>]:<端口>" npm run dev
```

## aria2c ENOENT

应用找不到或无法启动 aria2c。确认当前平台与架构对应的二进制存在且可执行，或用 `ARIA2C_PATH` 指定路径。

## RPC 服务未响应

检查 aria2c 是否可以运行、动态库是否完整，以及 RPC 端口是否被占用。

## 下载成功但无法播放

内置 Chromium 播放器有编码和容器格式限制。优先使用 MP4/H.264 或浏览器兼容的音频格式；也可使用播放器的兼容播放功能（依平台而定）。

## 视频站点或 HLS 下载失败

在「设置 → 视频站点解析」检查 yt-dlp、外部 JS 运行时和 ffmpeg。YouTube 高画质的要求见[视频站点文档](./video-sites.md)。

## macOS 首次打开提示

发布的 macOS 包当前未使用 Apple Developer ID 签名。请按[安装说明](./INSTALLATION.md)手动允许首次打开；若系统报告应用已损坏，也可参考其中的隔离属性处理步骤。

更多信息可在应用内查看日志，并使用「复制诊断信息」收集脱敏后的环境和任务摘要。
