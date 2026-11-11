# 测试指南

[English](./testing.en.md)

## 本地验证

```bash
npm run verify
npm run build
npm run smoke
```

`npm run smoke` 会启动真实应用和本地文件服务，验证「添加任务 → 下载 → 完成」流程；需先构建并使用 Node.js 22+。目前 Windows CI 会运行该测试。

## 测试磁力链接

以下是 Blender 基金会开源电影（CC 授权）的资源，可用于测试解析、下载与播放：

**Sintel**（约 1.06 GB）

```text
magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80
```

**Big Buck Bunny**（约 263 MB）

```text
magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80
```

**Cosmos Laundromat**（约 700 MB）

```text
magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=Cosmos+Laundromat&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80
```

**裸磁力版 Sintel**（不含 `tr=` 参数，可验证 Tracker 自动注入）

```text
magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10
```

资源解析依赖活跃 Peer 与当前网络的 DHT、Tracker 和 BitTorrent 连接能力。
