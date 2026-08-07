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

**There is no live recipe for this one.** It was produced by the spike harness,
and the spike was deleted once its work had been ported. Recover the harness from
git if this fixture ever needs regenerating:

```
git show 9cfe058:spike/test/harness.js > harness.js
git show 9cfe058:spike/server/server.js > server.js
```

The harness burns a shared-epoch clock into the video, both as digits and as a
16-cell binary bar readable by `ffmpeg` — so a test can assert *which instant* a
decoded frame shows, not merely that it decoded. `tools/make-alignment-fixtures.mjs`
does the same job for the pair below and is the model to follow if this ever gets
a modern replacement.

---

## `pair-north.webm` + `pair-east.webm` + `pair.json`

The staggered pair used by `src/core/alignment.integration.test.ts`. Two cameras
record the same stretch of wall-clock time but start about six seconds apart, so
their media timelines have unrelated origins — the situation that makes clips
look aligned when they are not.

Every frame carries the session time it was captured at, twice: as digits for a
human, and as a 16-cell binary bar that `ffmpeg` can read back out of a decoded
frame. A clip can therefore be asked what moment it is *actually* showing,
without trusting any of our own bookkeeping.

The bar is described by `clockBar` in `pair.json`: 16 cells across the full
width, cell *i* lit when bit *i* of `round(sessionMs / 20)` is set, occupying
50 px at y=420. Crop that strip, average each cell to one pixel, threshold at
half brightness.

Regenerate with `node tools/make-alignment-fixtures.mjs`, which needs
`npx playwright install chromium` once. Every number in `pair.json` is measured,
not assumed — including the media origin, which is read back out of the frames.

### `recorder.onstart` is not the media time origin

Measured on these recordings:

| camera | media origin (session) | `onstart` fired at | lag |
|---|---|---|---|
| north | 740 ms | 1329 ms | **589 ms** |
| east | 6560 ms | 8005 ms | **1445 ms** |

A recording's media time zero is roughly when the *track* began producing
frames, which is before `MediaRecorder.start()` is called and well before
`onstart` fires. The gap is not constant: it depends on what the device was
doing during setup, and here the two cameras differ by 856 ms.

This matters because the spike anchors on exactly that event
(`recordingStartLocal = Date.now()` in `onstart`). Substituting `onStartSessionMs`
for `mediaOriginSessionMs` in the alignment test moves the two angles 860 ms
apart — `expected 860 to be less than or equal to 60` — against 0 ms with the
measured origin.

The fixtures record both values so the difference stays visible. A hub cannot
measure the origin from pixels, so it needs another way to find it; see
`docs/TESTLIST.md`.
