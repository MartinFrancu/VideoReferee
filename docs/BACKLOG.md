# Backlog — things deliberately set aside

Nothing here is forgotten and nothing here blocks a vertical slice. Each entry
says what it is and why it waited, so a future session can pick it up without
re-deriving the reasoning.

Revisit after there is something to actually use. Several of these are questions
that only get easier to answer once the tool exists — those are marked
**needs use**.

---

## Sync and timing

**A residual ~100 ms shared bias in the media origin.** The origin is inferred
from the smallest delay ever observed between filming and arrival, and no chunk
arrives with zero delay, so the estimate lands slightly late and every clip
shifts slightly early. Measured at 80-100 ms. It is the same on every camera, so
the angles still agree to 20 ms and review is unaffected; it is also small
against 1.5 s of pre-roll. Correctable only by calibrating a typical encode
latency, which is guesswork — leave it unless something actually needs absolute
accuracy. Lives in `src/core/timeline/media-origin.ts`, one module.

**A better sync method than the fastest-round-trip estimate.**
A hub heartbeat every second or so, feeding a rolling estimate, is likely good
enough and simpler to reason about. The current `estimateClock` already takes
samples and returns an offset, so this is a change of *how samples are gathered*,
not of the interface. **Needs use** — the bar is ±50 ms in practice, and only a
real bout will say whether we clear it.

**Stale and degraded estimates.** An offset older than N seconds should be
treated as stale; a camera whose uncertainty exceeds what review needs should be
flagged rather than silently trusted. The uncertainty figure already exists and
nothing consumes it yet.

**A camera that reconnects** keeps its identity but its recording anchor resets.

---

## Container handling

**Fragmented MP4, for iOS Safari.** The clip builder is WebM-only. If an iPhone
reports a non-WebM mimeType the camera page must say so loudly rather than upload
clips that cannot decode. Now that the hub does the parsing, this is developable
offline from a single fixture recorded on the phone — no device needed after the
first capture.

**Non-default `TimecodeScale`.** We assume one timecode tick is one millisecond,
true for Chrome's default. A recorder that disagrees would produce clips whose
timing is wrong by a constant factor.

**A truncated final cluster** is currently emitted rather than dropped. Harmless
so far — the last cluster of a clip is the tail of the window — but a run that
ends mid-cluster will carry a partial one.

**A first chunk of one byte.** Observed in the spike: Chrome split the EBML magic
number across two chunks. The hub's parser handles it by accident rather than by
test.

---

## Cutting and review

**Falling back to a keyframe inside the window.** When no keyframe precedes the
requested start, `cutClip` returns nothing. Showing the last fraction of a second
may beat showing a blank tile. **Needs use** — easier to judge by seeing it.

**Clamp the review scrubber to what each clip actually holds.** The spike offered
a fixed −5 s regardless of the clip's real span, which is why five seconds of
history was never there. Part of the review screen — see `docs/review-screen.md`
for the full interaction design.

**Pre-roll and post-roll as configuration.** Currently constants. 1.5 s of
pre-roll is probably too short; 4–5 s is likelier to be what a referee wants,
which implies a ~30 s ring buffer.

**A cut clip decodes with no missing-reference errors.** Verified by hand in
batch 3, not automated. Needs a decoder, so it belongs at the integration level.

---

## Robustness, for a real venue

**Upload queue with retry and resume.** A phone that loses Wi-Fi mid-bout must
still deliver its clip. The difference between a demo and something that survives
a tournament.

**Removing a camera.** Enrolments last for the session, so a camera added by
mistake or a phone swapped out mid-tournament stays on the list forever. Noticed
while walking the slice with a long-running hub.

**Health beyond alive/dead.** Battery, thermal state, storage headroom, ring
occupancy, upload backlog. At a real event, "is camera 3 about to die" has to be
answerable at a glance.

**Wake Lock and screen-lock hardening.** Tested on one phone in the spike and it
held. If backgrounding turns out to kill the stream on other devices, that is the
signal to wrap the camera page in Capacitor rather than fight the browser.

**A bout access token.** Nothing currently stops a phone on the same Wi-Fi from
injecting bookmarks.

---

## Beyond the slice

**Saving and restoring a bout** so it can be paused and revisited. A JSON file
per bout is enough; explicitly not a database, since losing one bout to a laptop
crash is acceptable.

**Pulling full recordings off the phones after a bout.** Decision 2(c): each
phone writes the whole bout locally, only snippets go over the wire live, and the
full files are collected afterwards. Keeping this open costs one extra sink on
the ring buffer.

**Two screens.** The operator sits at a table, the referee is in the ring. One
browser tab today; the seam is there when it is needed.

**Grouping bookmarks that mark the same moment.** Two taps a second apart make
two bookmarks by decision, because they often mark different fighters. Presenting
them together is a separate concern. **Needs use.**

**Scoring, and a tournament layer above bouts.** Out of scope by decision — paper
works for scoring, synchronised video is what does not exist otherwise. Kept open
by two cheap things only: stable IDs and an open `meta` field on both `Bookmark`
and `Bout`. Auto-reporting to hemaratings.com would attach there.
