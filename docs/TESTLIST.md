# Test list

Working artifact for the TDD loop — see `.claude/skills/tdd/SKILL.md`.
`Now` is ordered and Martin sets the order. Anyone may add to `Later`.

---

## Now — the vertical slice

Stages refer to the road map. `Done` keeps running numbers; items here are
unnumbered until they land, since they get reshaped on the way.

### Stage 6 — a bookmark reaches everyone

- a bookmark reaches every connected camera, not just the one that tapped
- a clip is indexed against its bookmark and its camera
- a bookmark with some angles still in flight is renderable anyway *(INV-2)*

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

**Cut clips** — verified by hand in batch 3, not yet automated
- a cut clip decodes with no missing-reference errors *(needs a decoder, so it
  belongs at the integration level rather than in the unit suite)*
- falling back to the first keyframe **inside** the window when none precedes it,
  instead of returning nothing — "only show the overlap" may beat showing nothing.
  *Deferred until the tool can be used for real: the question is whether a short
  clip beats a blank tile, and that is easier to answer by seeing it than by
  reasoning about it.*

**Hub integration** — fake cameras replaying fixtures, no browser
- a bookmark fans out to every connected camera
- clips arriving out of order are indexed correctly
- a camera that never uploads leaves the bookmark renderable with the rest

---

## Done

### Batch 1 — reading structure out of a recording

Fixture `two-keyframe-gaps.webm`. Module `src/core/media/webm.ts`.

1. ✅ finds the init segment as the bytes before the first cluster
2. ✅ reads every cluster and its timecode in milliseconds
3. ✅ skips a leading partial cluster when the run starts mid-cluster
4. ✅ treats a cluster id inside block payload as data, not a cluster start

### Batch 2 — finding what is decodable

5. ✅ identifies the video track number from the Tracks element
6. ✅ marks the clusters that begin a decodable video segment
7. ✅ marks a cluster whose video arrives as a SimpleBlock with the keyframe flag
8. ✅ does not count another track's keyframe flag as a video keyframe

> Items 7 and 8 of the original batch collapsed into test 6 for the recorded
> fixture, which contains only `BlockGroup` video. Tests 7 and 8 use a crafted
> cluster instead, for the `SimpleBlock` shape the fixture happens not to have.

### Batch 3 — cutting

9. ✅ a cut clip begins with the init segment
10. ✅ begins at the last keyframe at or before the requested start, and reports it
11. ✅ rebases cluster timecodes so the clip starts at zero
12. ✅ includes clusters up to the requested end and no further
13. ✅ returns nothing when no keyframe precedes the requested window

> The original items "rebases the first cluster's timecode to zero" and
> "preserves the spacing" became one test: asserting the whole rebased sequence
> covers both, and they are one behaviour. "Reports the media time its first
> frame corresponds to" merged into test 10 — the clip's start and its report of
> that start are the same claim.

### Batch 4 — reading a camera's clock

Modules `src/core/timeline/clock.ts` and `src/core/timeline/session-time.ts`.

14. ✅ takes the offset from a round trip as the midpoint between send and receive
15. ✅ prefers the fastest round trip when several are available
16. ✅ reports how far the estimate could be wrong, as half the round trip it used
17. ✅ converts a bookmark's session time into the camera's own media time
18. ✅ converts a clip's media start back into session time

> Item 16 was listed as "reports offset quality from the spread of recent
> samples" and became something else. Spread measures jitter; what the referee
> needs is a bound on how wrong the alignment could be, and half the round trip
> is exactly that bound. Item 17 became two tests, one per direction — both are
> needed by the same flow and they are separate behaviours.

### Batch 5 — the claim the product rests on

Module `src/core/alignment.ts`, test `src/core/alignment.integration.test.ts`,
fixtures `pair-north.webm` / `pair-east.webm` / `pair.json`.

19. ✅ two recordings with different start anchors meet at the same instant

> Measured on the committed fixtures: both angles show 12020 ms for a bookmark
> asked for at 12000 ms — 20 ms absolute error, which is one tick of the clock
> bar, and **0 ms between cameras**. The clips start 2.5 s apart on the shared
> timeline and put the bookmark at 4542 ms and 2014 ms respectively, so the
> agreement is the alignment working rather than similar inputs.

### Stage 5 — a recording's true media origin

Modules `src/core/timeline/media-origin.ts`, plus `offset` on `Cluster`.

28. ✅ takes the origin from the arrival that lagged least
29. ✅ reports how far the estimate could be wrong, from the spread of the lags
30. ✅ has nothing to say until a chunk has arrived
31. ✅ pairs each cluster with the arrival that delivered its first byte
32. ✅ ignores a cluster no arrival accounts for
33. ✅ matches the origin burned into north's frames
34. ✅ matches the origin burned into east's frames
35. ✅ leaves the two cameras agreeing far more closely than onstart would

> Measured against the frames: inferred origin is 83 ms out on one camera and
> 55 ms on the other, where `recorder.onstart` was 796 ms and 663 ms out. The
> divergence *between* cameras — the only figure a referee sees — drops from
> 133 ms to 28 ms. On an earlier recording the onstart divergence was 856 ms, so
> that error is not a fixed bias anyone could calibrate away.

### Stage 4 — the camera keeps rolling

Module `web/camera/ring.js`, tested like everything else despite shipping to a
phone without a build step.

25. ✅ drops the oldest chunk once it falls outside the window
26. ✅ never drops the pinned prefix, however long the recording runs
27. ✅ reports where each retained chunk sits in the run and when it arrived

> Test 25 failed first because the *test* was wrong, not the code: it expected
> the pinned prefix to appear in the run as well. Prefix and run are separate by
> design — the hub receives both and knows they are not contiguous.

### Stages 1–2 — the hub wakes, cameras enrol

Modules `src/core/cameras.ts`, `src/core/protocol.ts`, `src/hub/`.

20. ✅ a camera that has been invited is not yet live
21. ✅ a camera goes live when it joins with the token it was given
22. ✅ a join with an unknown token is refused
23. ✅ a camera that has not been heard from recently is no longer live
24. ✅ a camera that has gone quiet is distinguishable from one that never joined

> The last one came out of walking the slice rather than from the list: a stale
> camera and one whose QR was never scanned both read as "waiting to join", which
> are different problems for whoever is running the table.

---

## Notes from the loop

**Batch 1 — ported logic does not get driven by its tests.** Tests 1 and 2 went
red first and drove the code. Tests 3 and 4 passed the moment they were written,
because the implementation had already been derived in the spike. So they are
characterisation tests, not design pressure: they lock in behaviour we already
had rather than discovering it.

That is a fair trade here — these are exactly the cases that produced the
"every bookmark shows the same early moment" bug — but it means batch 1 proved
less about the design than the ceremony suggests. Expect real design pressure
only where the code is genuinely new: the cut API (batch 3) and the timeline
maths (batch 4).

**Tests that never go red need a manufactured red.** Both were verified by
mutation: dropping the Timecode-child check from `isClusterStart` makes test 4
fail (`expected [ { timeMs: Infinity }, …(1) ] to have a length of 1 but got 2`).

**A test can only detect a mutation the fixture can express.** Test 3 survives
the `isClusterStart` mutation above, and no rewording fixes that: the loosened
check only misfires where a decoy `1f 43 b6 75` exists, and the real recording
contains none outside genuine cluster starts. Detecting it requires a crafted
run, which is exactly what test 4 is for.

Test 3 was still strengthened — it now asserts that a mid-stream slice yields
*every* later cluster unchanged, rather than just checking the first one — and it
is load-bearing for its own claim. Mutating `findClusterStarts` to assume the run
begins at a cluster boundary fails all four tests, test 3 with
`expected [ 1.2331101224956094e+303, 546, …(40) ] to deeply equal [ 314, 546, … ]`.

The general lesson: pick the mutation that matches the test's claim, not a
convenient one. A test surviving an unrelated mutation says nothing.

**Batch 2 — the loop worked properly here, unlike batch 1.** Test 7 drove the
`SimpleBlock` branch in minimally, checking the keyframe flag but not the track
number, because nothing yet demanded the track. Running the suite then failed
*test 6*: `expected [ Array(43) ] to deeply equal [ +0, 3357, 6722, 10086 ]`.
Every one of the 43 clusters looked decodable, because every Opus block sets the
keyframe flag.

That is triangulation doing its job — an existing test forced the new code to be
*correct*, not merely general — and it is the trap that would have silently made
every clip start at the wrong place. Worth noting the difference from batch 1: the
pressure appeared as soon as the code was genuinely new rather than ported.

**Batch 3 — the unit suite cannot tell you the clip plays.** Every assertion in
batch 3 is about structure: which clusters, what timecodes, what prefix. All
thirteen tests would still pass if the rebased bytes produced something no player
could open — which is exactly the failure the spike shipped for days.

So it was checked out of band: both cut clips decode through ffmpeg with zero
"Not all references are available" errors, and a frame decoded at a known media
time shows the expected moment. That check is recorded under Later as an
integration test, because it needs a decoder and does not belong in the unit
suite. Until it exists, treat green here as "the structure is right", not "the
clip plays".

**Batch 4 — a test can pass for the wrong reason if the data lets it.** Test 15
first listed its samples fastest-last, which made "prefer the fastest" and "take
the most recent" indistinguishable — a plausible wrong implementation would have
passed. Moving the fastest sample into the middle fixes it: the mutant now fails
with `expected 100 to be -480`.

Worth generalising, since it is the second time this has come up: when a test
picks one item out of several, arrange the data so that position and property
disagree. Otherwise the test pins neither.

**Not a gap: the two mapping tests only pin a sum.** `toMediaMs` and
`toSessionMs` use `offsetMs` and `recordingStartedAt` only as their total, so no
test can distinguish a mis-split between them. That is not a hole in the tests —
it is the model. The pair never appears separately.

**Batch 5 — the test found the bug before it was written.** Generating the
fixture pair meant recording each camera's start anchor, and checking that anchor
against the clock burned into the frames showed it was wrong by 589 ms for one
camera and 1445 ms for the other. `recorder.onstart` fires well after the media
clock has started, by an amount that varies with what the device was doing.

The spike anchors on exactly that event. Feeding `onStartSessionMs` into the
alignment test instead of the measured origin fails it with
`expected 860 to be less than or equal to 60`.

Two lessons. Building an honest fixture is itself a test — the discrepancy
surfaced while writing the generator, not while writing the assertion. And a
tolerance should be set from the measurement, not guessed beforehand: the initial
bounds of 100 ms and 150 ms would have passed with the 860 ms bug present had the
anchor been slightly better, because they were picked before anything was known.

**Design note.** Batch 2 forced `Cluster` to grow `bytes` and `bodyOffset`, and
that was the right way round: batch 1 left the extent out because nothing needed
it, and the test that needed it said so. Cutting will use the same two fields, so
no speculative field was ever added.

---

## Design smells

Reports from the stop-and-ask rule: tests that needed disproportionate setup, and
what the design might have wanted instead.

*(none yet — test 4's 8-line setup is at the edge of comfortable, and points at
wanting a small fixture-builder helper if more crafted runs are needed)*
