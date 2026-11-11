# Testing guide

[简体中文](./TESTING.md)

## Local checks

```bash
npm run verify
npm run build
npm run smoke
```

`npm run smoke` launches the real app and a local file server to verify the add → download → complete flow. Build first and use Node.js 22+. Windows CI currently runs this test.

## Test magnets

These Blender Foundation open movies are CC-licensed and can be used to test parsing, downloading and playback:

**Sintel** (~1.06 GB)

```text
magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80
```

**Big Buck Bunny** (~263 MB)

```text
magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80
```

**Cosmos Laundromat** (~700 MB)

```text
magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=Cosmos+Laundromat&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80
```

**Bare Sintel magnet** (without `tr=` parameters, for testing automatic tracker injection)

```text
magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10
```

Resolution depends on active peers and whether the current network allows DHT, trackers and BitTorrent connections.
