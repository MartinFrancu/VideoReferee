# Fixtures

Committed recordings used by the core tests. Each entry records the ground truth
so tests can assert against known values without shelling out to `ffprobe`.

## `two-keyframe-gaps.webm`

A 12-second recording produced by Chrome's `MediaRecorder` from a canvas source
(`spike/test/harness.js`), with `start(250)` so chunks arrive every 250 ms.

Named for the property that makes it useful: it spans **four keyframes**, so a
clip cut anywhere after the start has to snap backwards past at least one of them.

| Property | Value |
|---|---|
| Size | 1 005 298 bytes |
| Codecs | VP9 video, Opus audio |
| Video track number | 1 |
| Init segment | first **189** bytes (everything before the first cluster) |
| Clusters | **43**, timecodes spanning 0 – 11 706 ms |
| First cluster timecodes | 0, 314, 546, 854, 1214, 1505, 1806, 2114 ms |
| Keyframe cluster timecodes | **0, 3357, 6722, 10086 ms** |
| Keyframe packet PTS (ffprobe) | 0.000, 3.357, 6.722, 10.089 s |
| Video packets | 676 |
| `TimecodeScale` | default (1 000 000 ns — one tick is one millisecond) |

Two details worth knowing before writing tests against it:

- **Clusters carry unknown size** (`01 ff ff ff ff ff ff ff`), so a cluster ends
  where the next one begins, not at a declared length.
- **Video blocks sit in `BlockGroup`, not `SimpleBlock`.** Keyframe-ness is
  therefore the *absence* of a `ReferenceBlock` child, not a flag bit. Audio blocks
  are `SimpleBlock`s and every one of them has the keyframe flag set — which is why
  a naive "any keyframe flag" check reports every cluster as a keyframe.

The keyframe cluster timecode 10086 differs from the packet PTS 10089 because the
cluster starts 3 ms before the keyframe it contains. Both are correct.

### Regenerating

```
cd spike/server && npm start
cd spike/test && npm install && node harness.js --cameras 1 --marks 10
```

The harness burns a shared-epoch clock into the video, both as digits and as a
16-cell binary bar readable by `ffmpeg` — so a test can assert *which instant* a
decoded frame shows, not merely that it decoded.
