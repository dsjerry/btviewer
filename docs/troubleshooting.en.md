# Troubleshooting

[简体中文](./TROUBLESHOOTING.md)

## A magnet stays at “Fetching metadata”

A bare magnet only contains an info hash; the client still needs metadata from DHT, trackers or peers. Some networks block DHT bootstrap nodes or UDP trackers, or the swarm may no longer have active peers. Try:

- Check whether another BT client can resolve the same resource.
- Check firewall, proxy and network access for DHT, UDP trackers and peers.
- Configure trackers in Settings or override the built-in list with `ARIA2_TRACKERS`.
- Set a reachable DHT bootstrap node with `ARIA2_DHT_ENTRY_POINT` / `ARIA2_DHT_ENTRY_POINT6`.

For development, override them with environment variables:

```bash
ARIA2_TRACKERS="<comma- or space-separated tracker URLs>" npm run dev
ARIA2_DHT_ENTRY_POINT="<hostname>:<port>" npm run dev
ARIA2_DHT_ENTRY_POINT6="[<IPv6 address>]:<port>" npm run dev
```

## aria2c ENOENT

The app cannot find or launch aria2c. Check that the binary for the current platform and architecture exists and is executable, or set `ARIA2C_PATH`.

## RPC service is not responding

Check that aria2c can run, its shared libraries are available and the RPC port is not occupied.

## Downloaded media will not play

The built-in Chromium player supports a limited set of codecs and containers. Prefer MP4/H.264 or browser-compatible audio; compatibility playback may help on supported platforms.

## Video-site or HLS download failed

Check yt-dlp, an external JavaScript runtime and ffmpeg under **Settings → Video sites**. See the [video sites guide](./video-sites.en.md) for YouTube quality requirements.

## macOS first-launch warnings

Current macOS release packages are not signed with an Apple Developer ID. Follow the [installation guide](./installation.en.md) to allow the first launch or clear the quarantine attribute if macOS reports that the app is damaged.

For more details, review the in-app logs or copy the redacted diagnostics.
