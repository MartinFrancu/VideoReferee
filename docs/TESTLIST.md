# Test list

Working artifact for the TDD loop — see `.claude/skills/tdd/SKILL.md`.
`Now` is ordered and Martin sets the order. Anyone may add to `Later`.

---

## Now — M1, the alignment core

Ordered so each test has a reason to exist given the ones before it. Roughly four
batches.

### Batch 1 — reading structure out of a recording

Fixture: `full.webm` (12&nbsp;s, VP9+Opus, Chrome, canvas source).

1. finds the init segment as the bytes before the first cluster
2. reads each cluster's timecode in milliseconds
3. skips a leading partial cluster when the byte run starts mid-cluster
4. treats a cluster id occurring inside block payload as data, not a cluster start

> (4) is the false-positive guard. It needs a crafted fixture rather than a
> recorded one — a byte run with `1f 43 b6 75` embedded in a block.

### Batch 2 — finding what is decodable

5. identifies the video track number from the Tracks element
6. marks a cluster carrying a SimpleBlock with the keyframe flag
7. marks a cluster whose BlockGroup carries no ReferenceBlock
8. does not mark an audio-only cluster as a video keyframe

> Ground truth for 6–8 is ffprobe's keyframe list for the fixture, recorded in
> `fixtures/README.md` so the test does not shell out.

### Batch 3 — cutting

9. a cut clip begins with the init segment
10. a cut clip begins at the last keyframe at or before the requested start
11. rebases the first cluster's timecode to zero
12. preserves the spacing between rebased cluster timecodes
13. includes clusters up to the requested end and no further
14. reports the media time its first frame corresponds to
15. returns nothing when the run contains no keyframe at or before the window

### Batch 4 — time, and the claim the product rests on

16. estimates offset from one round trip as the midpoint
17. prefers the sample with the lowest round-trip time
18. reports offset quality from the spread of recent samples
19. maps a device's media time to session time using its recording anchor
20. **two recordings with different start anchors produce clips whose bookmark
    offsets refer to the same instant**

> (20) is the money test: decode each clip at its reported bookmark offset and
> compare the binary-clock value burned into the frame. Needs a fixture pair
> recorded with staggered starts — generate with the `spike/test` harness.

---

## Later

Unordered. Promote into `Now` when it earns it.

**Container**
- non-default `TimecodeScale` scales cluster timecodes correctly
- a truncated final cluster is dropped rather than emitted
- a recording whose first chunk is one byte still yields an init segment
  *(observed in the spike — Chrome split the EBML magic across two chunks)*
- an fMP4 stream is rejected with a clear error, not a corrupt clip

**Timeline**
- an offset estimate older than N seconds is treated as stale
- a device whose quality degrades past a threshold is flagged, not silently used
- a device that reconnects keeps its identity but resets its anchor

**Bout**
- accepts a bookmark while recording
- rejects a bookmark before the bout has started
- accepts a bookmark while paused *(decision 1: cameras keep rolling)*
- cameras stay enrolled across consecutive bouts
- two taps within a second create two bookmarks *(decision 5)*
- a bout round-trips through save and load

**Clip index**
- reports which cameras are still outstanding for a bookmark
- a duplicate upload for the same (bookmark, camera) replaces rather than duplicates
- a bookmark with no clips at all still renders

**Camera registry**
- a camera that joins mid-bout is enrolled and immediately bookmarkable
- a camera that goes quiet is marked stale without being removed
- nothing breaks with zero cameras connected *(INV-5)*

**Hub integration** — fake cameras replaying fixtures, no browser
- a bookmark fans out to every connected camera
- clips arriving out of order are indexed correctly
- a camera that never uploads leaves the bookmark renderable with the rest

---

## Done

*(empty — M1 not started)*

---

## Design smells

Reports from the stop-and-ask rule: tests that needed disproportionate setup, and
what the design might have wanted instead.

*(empty)*
