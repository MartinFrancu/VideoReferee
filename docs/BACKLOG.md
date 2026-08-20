# Backlog

Everything we might want to do, most worth doing first. One line each — where an
item has reasoning worth keeping, it points at [notes.md](notes.md).

Nothing finished lives here. [CHANGELOG.md](../CHANGELOG.md) says what was done
and the commit says why.

**Needs use** marks a question that only gets easier after another event.

---

## P0 — next

- **Tune `review.trustedWithinMs`.** An angle now says how far out it could be,
  and 100 ms is a guess. A fake camera on localhost measured 180 ms, so real
  phones may flag everything — one event's numbers settles it. **Needs use.**
- **Test the min-of-N hypothesis.** Why the first bookmark of a session is the
  suspicious one, and now checkable against captures → [notes](notes.md#why-the-first-bookmark-is-the-suspicious-one).
- **Capture what the review screen did.** The hub's side is recorded; the
  browser's is not — which tile was lead, what each seek asked for, where the
  video actually landed. The suspicion is the seeking as much as the arithmetic.

## P1 — trust in the numbers

- **Warm-up measured from the estimates,** not from buffered seconds standing in
  for them. The figure it needs now exists.
- **Audit the session↔media time transfer** end to end against a real capture.
  The chain is four pure functions → [notes](notes.md#the-time-transfer-chain).
- **A rolling clock estimate** instead of the fastest round trip
  → [notes](notes.md#a-better-sync-method).
- **The residual ~100 ms media-origin bias** → [notes](notes.md#the-residual-media-origin-bias).
- **Stale estimates.** An offset older than N seconds describes a network that no
  longer exists, and is trusted as if it did.
- **A camera that reconnects** keeps its identity but resets its recording anchor.
- **Longer pre-roll.** 1.5 s is probably too short; 4–5 s is likelier right, and
  needs `camera.ringWindowMs` raised with it. **Needs use.**
- **The duplicated frame near the bookmark.** Real, does not affect a decision, a
  unit test whenever wanted → [notes](notes.md#the-duplicated-frame).
- **Prove a cut clip decodes** with no missing-reference errors. Needs a decoder,
  so it belongs at the integration level.
- **Fall back to a keyframe inside the window.** When none precedes the requested
  start, the cut returns nothing at all; the last fraction of a second may beat a
  blank tile. **Needs use.**

## P2 — the tool a referee can drive

- **Resolving does not move you on.** Deciding should advance to the next
  undecided bookmark, never onto one still gathering, stopping at the end.
- **The scrubber does not show where the bookmark is.** A tick at zero, and a
  band per clip showing how far each reaches.
- **The sweep cannot be undone.** One click, bulk, irreversible. "Marked 8 done ·
  undo" on the notice that already appears.
- **The rest of the keyboard.** Space to play and pause, a key per resolution,
  Escape to leave the bookmark. Arrows already step.
- **Hide an angle that cannot reach the instant** rather than veiling it. Check
  first whether the veil appears at all while stepping — a report suggests not.
- **Rename a camera.** The name is set when the camera is added and never again,
  so a phone handed to somebody else keeps the wrong person's name on every
  bookmark it answers. Adding and removing (0.0.25, 0.0.26) covers the rest of
  managing them.
- **Identify which camera is which.** Flash something on the phone when its card
  is clicked — better in a hall than a thumbnail, since you are looking at the
  phone, not the screen.
- **Delete a single bookmark.** Clearing them all is done; one at a time is not.
- **Name a bookmark.** `Bookmark` already has room.
- **Zoom on a paused video,** to look closely at a hand.
- **Join bookmarks that overlap** — two taps at the same instant are usually one
  incident → [notes](notes.md#joining-bookmarks-that-overlap). **Needs use.**
- **What the colours mean.** Red, blue, purple and grey are stored as colours and
  mean nothing to the tool. Naming them is a label, not a shape. **Needs use.**
- **Adding a camera mid-bout.** Allowed by the model; the question is whether
  showing the control invites a mistake. **Needs use.**
- **The operator screen has nowhere to put a test.** Angular components are
  checked by driving a real browser, script by script, and none are kept.
  Infrastructure, so its own chunk.
- **Revisit an old bout as a feature,** rather than as the debugging it grew out
  of → [notes](notes.md#revisiting-an-old-bout). **Needs use.**

## P3 — surviving a real venue

- **Collect the phones' logs into the debug dump.** The hub's side is in; the
  phones each hold their own log and nothing gathers them.
- **Bound the disk.** `clips/` grows all event and capture records are never
  pruned. Only the raw uploads are capped today.
- **Deliver a clip that missed its window.** The hub re-asks for ~23 s, then the
  footage is gone. A phone off the Wi-Fi longer than that still loses it.
- **Health beyond alive/dead.** Battery, heat, storage, ring occupancy, upload
  backlog. "Is camera 3 about to die" should be answerable at a glance.
- **Screen-lock hardening.** The wake lock is not re-taken after the page is
  hidden. If backgrounding kills the stream on some phone, that is the signal to
  wrap the camera page rather than fight the browser.
- **A certificate that survives changing networks**
  → [notes](notes.md#certificates-and-changing-networks).
- **Docs that describe the plan rather than the tool.** `build-plan.md`,
  `TESTLIST.md`, `architecture.md` and `review-screen.md` are all behind on fact.
- **A walkthrough that runs on Windows.** Developed on Linux, run at the
  tournament on Windows, and that gap has already produced one crash.
- **A bout access token.** Nothing stops a phone on the same Wi-Fi injecting
  bookmarks.

## P4 — container handling

Nothing here is wrong today; each is a way the parser could be wrong on hardware
we have not used → [notes](notes.md#container-handling).

- **Fragmented MP4, for iOS Safari.** **Still unanswered: what an iPhone reports.**
- **Non-default `TimecodeScale`.** We assume one tick is one millisecond.
- **A truncated final cluster** is emitted rather than dropped.
- **A first chunk of one byte.** Handled by accident rather than by test.

## P5 — beyond the tool

- **Pull full recordings off the phones after a bout.** Kept open by one extra
  sink on the ring.
- **Two screens** — the operator at a table, the referee at the ring.
- **Group bookmarks that mark the same moment,** as against joining them into
  one. **Needs use.**
- **Scoring and a tournament layer.** Out of scope by decision; kept open by
  stable ids and an open `meta` field.
