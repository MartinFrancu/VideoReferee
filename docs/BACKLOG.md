# Backlog

Everything deliberately set aside, in the order I would do it. Each entry says
what it is and why it waited, so a future session can pick it up without
re-deriving the reasoning.

Ordering is a recommendation, not a plan. The tiers are what matters more than
the order inside them. Items marked **needs use** are questions that only get
easier once the tool has been used more.

**Status: v0.0.1 works.** Two angles, bookmarked and reviewed side by side, at a
real bout. Three observations from that run drive most of P0:

1. The clips were misaligned once, on the first bookmark, and never again.
2. A duplicated frame near the bookmark on one camera, on every bookmark checked.
3. The UI is confusing.

---

## P0 — before anything else

### Capture and replay a bookmark

**The thing that unblocks the other two observations.** A misalignment that
cannot be reproduced cannot be fixed, and cannot be proven fixed. Today the
evidence evaporates: the hub cuts the clip and throws away every input it used.

This is cheap because of INV-2/INV-3. Everything the hub needs is already in one
place — `ingestClip` receives the prefix bytes, the run bytes, the arrival
readings, and reads the sync samples. Writing exactly those to a file, plus a
replay entry point that feeds them back through `cutClipForBookmark`, turns
"could not reproduce" into a regression test that runs in milliseconds with no
phone, no camera and no browser.

Dump, at minimum:

- the raw upload, byte for byte (prefix + run + header)
- the sync sample window for that camera, and the resulting offset *and
  uncertainty*
- the media origin estimate, its uncertainty, and every `(offset, mediaMs)` pair
  it was derived from
- the bookmark's session time, and the computed cut in all three time domains

The user also asked for **view state**, and they are right: the suspicion is the
slider and the seeking, not only the arithmetic. So also record what the review
screen did — which tile was lead, what position each `seekTo` asked for, and what
`currentTime` each video actually landed on. Those are different numbers, and the
gap between "what we asked for" and "what the browser did" is invisible today.

Network data is the least valuable of the three and can wait.

### Why the first bookmark is the suspicious one

A concrete hypothesis for observation 1, worth testing before touching anything.

**Both clock estimators are minimum-of-N estimators, and a minimum of N samples
is biased high when N is small.**

- `estimateClock` uses the *fastest* round trip out of at most 20 samples,
  gathered one per second. In the first few seconds, N is tiny.
- `estimateMediaOrigin` uses the *smallest* arrival lag across the chunks in the
  run. A short ring means few chunks means a worse minimum.

Both improve monotonically as samples accumulate. That alone would be harmless
if the bias were shared — but it is not. Each camera draws its own luck, and a
camera that joined later has had fewer samples, so **the two angles are biased by
different amounts.** The difference is the misalignment, and it shrinks as both
estimates converge.

That predicts exactly the reported symptom: wrong on the first bookmark, right
afterwards, and not reproducible once the hub has been running a while.

It also corrects something this file previously got wrong. The entry below on the
residual ~100 ms bias called it "the same on every camera, so the angles still
agree" — that holds in the steady state, which is where it was measured, and not
at all in the first seconds.

Cheapest possible check: the uncertainty figures for that bookmark. **The tool
already computes them and nothing looks at them** (see *Surface the uncertainty*
below). If the hypothesis is right, the bad bookmark had a large `uncertaintyMs`
on at least one camera and the good ones did not — which is also the fix: refuse
or flag a bookmark taken before the estimates have settled.

### Surface the uncertainty, and refuse to pretend

`ClockEstimate.uncertaintyMs` and `MediaOrigin.uncertaintyMs` both exist, are
both computed on every bookmark, and are consumed by nothing. A camera whose
uncertainty exceeds what review needs should say so, not be silently trusted.
This is the smallest change on this page and it is the one that would have caught
observation 1 while it was happening.

### The camera warm-up, made visible

*(user request: "if some 20s of recording is needed to start, lets add loader on
the cam and probably show the cam as loading in the hub")*

Not only a nicety — the same clock. A camera is genuinely not ready for a while
after joining: the ring is filling, and both estimates above are still
converging. The operator has no way to know that, so the natural thing to do —
add cameras, immediately bookmark — is the worst case. Show the warm-up on the
phone and on the hub, and derive "ready" from the actual estimates rather than a
fixed timer.

### Stop the review screen lying about what it is showing

*(user request: "when slider is moving (or we are out of frames), lets black or
dim the video")*

While dragging, only the lead tile moves; the others hold a stale frame that
looks like current footage. Beyond a clip's footage, the tile shows the nearest
frame with a small text note that is easy to miss. Both cases present a frame
that is not the requested instant *as if it were* — which is precisely the
failure mode being hunted. Dim or black them.

This is UI polish that is also instrumentation, which is why it sits in P0 rather
than with the rest of the polish.

### Remove start/end bout

*(user request)*

Confirmed: it does nothing. The camera page only logs the phase
(`web/camera/camera.js`), recording runs continuously from join, and no cut
depends on it. A control that implies state it does not have is worse than no
control. If point-counting ever arrives it can come back.

### The duplicated frame near the bookmark

Seen on one camera, on every bookmark checked. Small enough not to hurt, specific
enough to be a real clue about the cut. Suspects, in order: the keyframe snap-back
emitting a cluster that overlaps the next one; the rebased timecodes putting two
frames on the same instant; a truncated final cluster (see below). Needs the dump
to tell them apart — with the raw bytes saved, this is a unit test.

---

## P1 — trust in the numbers

**Audit the session↔media time transfer end to end.** The user reports the math
looked dubious and did not have time to dig. It deserves a proper walk with the
dump as evidence rather than a defence. The chain is short —
`clock.ts` → `media-origin.ts` → `session-time.ts` → `alignment.ts` — and every
step is already a pure function, so it can be gone through one number at a time
against a real captured bookmark.

**A better sync method than the fastest-round-trip estimate.** A hub heartbeat
every second or so, feeding a rolling estimate. `estimateClock` already takes
samples and returns an offset, so this changes *how samples are gathered*, not
the interface. Related to the min-of-N bias above: a rolling estimate with a
warm-up requirement addresses both.

**A residual ~100 ms shared bias in the media origin.** The origin is inferred
from the smallest delay ever observed, and no chunk arrives with zero delay, so
the estimate lands late and every clip shifts early. Measured at 80–100 ms *in
the steady state*, where it is shared across cameras and therefore cancels for
review. Correctable only by calibrating a typical encode latency, which is
guesswork. Lives in one module.

**Stale estimates.** An offset older than N seconds describes a network that no
longer exists and should be treated as stale rather than trusted.

**A camera that reconnects** keeps its identity but its recording anchor resets.

**Pre-roll and post-roll as configuration.** Currently constants. 1.5 s of
pre-roll is probably too short; 4–5 s is likelier to be what a referee wants,
which implies a ~30 s ring buffer. Interacts with the warm-up above — a longer
ring takes longer to fill.

**A cut clip decodes with no missing-reference errors.** Verified by hand in
batch 3, never automated. Needs a decoder, so it belongs at the integration level.

---

## P2 — the tool a referee can actually drive

Mostly the user's UI list. Grouped because they share a surface and are best done
in one pass.

**Identify which camera is which.** Asked as a question: *is there a way to
identify a camera for the user?* Nothing today ties a name in the list to a phone
on a tripod. Cheapest honest answers: show the live thumbnail on the hub, or
flash something on the phone screen when its card is clicked. The second is
better in a hall — it works when the camera is across the room and the operator
is looking at the phone, not the screen.

**Kick a camera, and re-show its QR.** A camera added by mistake or a phone
swapped mid-tournament stays on the list forever, and there is no way to get the
join QR back once the dialog is closed.

**Delete a single bookmark.** Clearing them all is done (session menu → *Clear
all bookmarks*, behind a confirmation). Removing one at a time is not, and is the
likelier need once bookmarks get names.

**Name a bookmark.** The user likes this. Cheap: `Bookmark` already has room.

**Zoom on a paused video.** A referee wants to look closely at a hand. Only
meaningful once paused, which is the normal review state anyway.

**Clamp the review scrubber to what each clip actually holds.** Now partly done —
the slider spans what at least one angle holds. What remains is per-angle
behaviour, which is the dim/black item in P0.

**Falling back to a keyframe inside the window.** When no keyframe precedes the
requested start, `cutClip` returns nothing. Showing the last fraction of a second
may beat showing a blank tile. **Needs use.**

**Adding a camera mid-bout.** The user is unsure whether it should even be
visible. Nothing in the model forbids it (INV-5); this is purely a question of
whether showing the control invites a mistake. **Needs use.**

---

## P3 — surviving a real venue

**Collect the cameras' logs into one dump.** *(user request)* The natural
extension of P0's capture: the hub asks every phone for its recent log and
aggregates them into a single file next to the hub-side dump. Worth doing once
the hub-side capture exists and its shape is known — building both at once risks
designing the aggregation before knowing what is worth aggregating.

**Upload queue with retry and resume.** A phone that loses Wi-Fi mid-bout must
still deliver its clip. The difference between a demo and something that survives
a tournament.

**Health beyond alive/dead.** Battery, thermal state, storage headroom, ring
occupancy, upload backlog. "Is camera 3 about to die" has to be answerable at a
glance.

**Wake Lock and screen-lock hardening.** Held on one phone. If backgrounding
kills the stream on other devices, that is the signal to wrap the camera page in
Capacitor rather than fight the browser.

**A walkthrough that runs on Windows.** The hub is developed on Linux and run at
the tournament on Windows, and the first thing that gap produced was a hub that
died on its first page load (see TESTLIST). Unit tests now reach Windows by
injecting the path flavour, but no end-to-end walkthrough has ever run there.

**A bout access token.** Nothing stops a phone on the same Wi-Fi from injecting
bookmarks.

**Saving a bout to disk — done, as far as it goes.** The session menu saves
cameras, bookmarks and the clips inline into one JSON file, loads one back, and
clears the bookmarks behind a confirmation (`src/core/state.ts`,
`/api/state`, `/api/reset`).

What it deliberately does *not* carry is the derivation — the sync samples, the
media-origin samples and both uncertainties. Those are computed at ingest and
discarded, so a saved file shows what the hub concluded but not how, and cannot
replay a cut. That is still the P0 capture work; the state file is the obvious
place to put it when it exists, and the format number is there to bump.

Two smaller gaps: a loaded camera is listed as never-joined, so the card reads
"waiting for its QR to be scanned" when it means "this camera was somewhere
else"; and the file is read whole into memory on both sides, which is fine for a
bout and would not be for an afternoon.

---

## P4 — container handling, when the format changes

Nothing here is wrong today. Each is a way the current parser could be wrong on
hardware we have not used.

**Fragmented MP4, for iOS Safari.** The clip builder is WebM-only. If an iPhone
reports a non-WebM mimeType the camera page must say so loudly rather than upload
clips that cannot decode. Developable offline from a single fixture recorded on
the phone. **Still unanswered: what an iPhone actually reports.**

**Non-default `TimecodeScale`.** We assume one tick is one millisecond, true for
Chrome's default. A recorder that disagrees produces clips wrong by a constant
factor.

**A truncated final cluster** is emitted rather than dropped. Harmless so far —
the last cluster of a clip is the tail of the window — but a run ending
mid-cluster carries a partial one. A suspect for the duplicated frame.

**A first chunk of one byte.** Observed in the spike: Chrome split the EBML magic
number across two chunks. The parser handles it by accident rather than by test.

---

## P5 — beyond the tool

**Pulling full recordings off the phones after a bout.** Decision 2(c): each
phone writes the whole bout locally, only snippets go over the wire live, full
files collected afterwards. Keeping this open costs one extra sink on the ring.

**Two screens.** The operator sits at a table, the referee is in the ring. One
browser tab today; the seam is there when it is needed.

**Grouping bookmarks that mark the same moment.** Two taps a second apart make
two bookmarks by decision, because they often mark different fighters. Presenting
them together is a separate concern. **Needs use.**

**Scoring, and a tournament layer above bouts.** Out of scope by decision — paper
works for scoring, synchronised video is what does not exist otherwise. Kept open
by two cheap things only: stable IDs and an open `meta` field on `Bookmark` and
`Bout`. Auto-reporting to hemaratings.com would attach there.
