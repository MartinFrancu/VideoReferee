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
| Cluster byte offsets (first three) | 189, 18 655, 24 411 |
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

### The burned-in counter leads media time by ~0.25 s

The digits drawn into the frame start counting when the harness sets up its
canvas, which is a moment before `MediaRecorder.start()`. Media time 0 of this
fixture therefore shows **0.2**, not 0.0.

Subtract ~0.25 s before comparing a decoded frame's digits against a media time.
The offset is constant across the whole recording, so it cancels out when
comparing two clips with each other — which is what the cross-camera sync check
does.

### All 43 cluster timecodes, in milliseconds

Keyframe clusters in **bold**.

> **0**, 314, 546, 854, 1214, 1505, 1806, 2114, 2405, 2706, 3004, 3305, **3357**,
> 3606, 3905, 4206, 4514, 4805, 5106, 5414, 5705, 6006, 6314, 6605, **6722**,
> 6906, 7204, 7506, 7814, 8105, 8406, 8714, 9005, 9306, 9614, 9905, **10086**,
> 10206, 10504, 10806, 11106, 11405, 11706

### Regenerating

```
cd spike/server && npm start
cd spike/test && npm install && node harness.js --cameras 1 --marks 10
```

The harness burns a shared-epoch clock into the video, both as digits and as a
16-cell binary bar readable by `ffmpeg` — so a test can assert *which instant* a
decoded frame shows, not merely that it decoded.
