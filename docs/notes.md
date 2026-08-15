# Notes

The long version of things the [backlog](BACKLOG.md) only has a line for.

Kept because the reasoning cost something to arrive at and would otherwise be
re-derived — a hypothesis worth testing, a measurement someone took, a decision
about why an obvious thing is not obviously right. Nothing here is a task.

---

## Why the first bookmark is the suspicious one

The clips were misaligned once, at the first real bout, on the first bookmark,
and never again. A hypothesis that predicts exactly that:

**Both estimators are minimum-of-N estimators, and a minimum of N samples is
biased high when N is small.**

- `estimateClock` uses the *fastest* round trip out of at most 20 samples,
  gathered one per second. In the first few seconds, N is tiny.
- `estimateMediaOrigin` uses the *smallest* arrival lag across the chunks in a
  run. A short ring means few chunks means a worse minimum.

Both improve as samples accumulate, which alone would be harmless — except the
bias is **not shared**. Each camera draws its own luck, and a camera that joined
later has had fewer samples, so the two angles are biased by different amounts.
That difference is the misalignment, and it shrinks as both estimates converge.

Which predicts the reported symptom precisely: wrong on the first bookmark, right
afterwards, unreproducible once the hub has been running a while.

**How to test it now.** A capture records both uncertainties per angle, and an
angle carries the compounded figure. If the hypothesis holds, a bad bookmark had
a large figure on at least one camera and the good ones did not. That is also the
fix: refuse or flag a bookmark taken before the estimates have settled — flagging
is done, refusing was offered and declined.

**First measured numbers (0.0.24).** A fake camera on localhost, nothing else
running: 180 ms total, of which 1 ms was the clock and the rest the media origin.
The origin estimate is the loose one by two orders of magnitude.

## The time transfer chain

`clock.ts` → `media-origin.ts` → `session-time.ts` → `alignment.ts`. Every step
is a pure function, so the whole chain can be walked one number at a time against
a real captured bookmark. The user reported the arithmetic looked dubious and did
not have time to dig; this deserves a proper walk with a capture as evidence
rather than a defence of it.

## A better sync method

A hub heartbeat every second or so, feeding a rolling estimate, instead of
keeping the fastest round trip out of a fixed window. `estimateClock` already
takes samples and returns an offset, so this changes *how samples are gathered*,
not the interface. Addresses the min-of-N bias above at the same time.

## The residual media-origin bias

The origin is inferred from the smallest delay ever observed, and no chunk
arrives with zero delay, so the estimate lands late and every clip shifts early.
Measured at 80–100 ms **in the steady state**, where it is shared across cameras
and therefore cancels for review — which is why it is not urgent.

It does not cancel in the first seconds, when each camera has drawn a different
amount of luck. Correcting it properly means calibrating a typical encode
latency, which is guesswork. Lives in one module.

## The duplicated frame

Seen on one camera, on every bookmark checked at the first bout. Demoted from P0
on the user's judgement after more use: real, but it does not affect a decision.

Suspects, in order:

1. The keyframe snap-back emitting a cluster that overlaps the next one.
2. The rebased timecodes putting two frames on the same instant.
3. A truncated final cluster (see below).

Cheap to chase now: a capture holds the raw upload, so this is a unit test rather
than an afternoon with two phones.

## Joining bookmarks that overlap

Two taps a second apart, or one from the desk and one from a phone at nearly the
same instant, are almost always the same incident seen twice — and reviewing it
twice wastes the time the tool exists to save.

The judgement is what makes it interesting. Two taps a second apart are
deliberately two bookmarks today, because they often mark **different fighters**,
and joining those would lose a decision. So joining probably wants to be offered
rather than automatic, and probably only while both are still undecided.

Distinct from *grouping* them, which is about presenting two bookmarks together
without deciding they are one.

## Revisiting an old bout

Saving and loading a session grew out of troubleshooting, and the debug dump has
taken that job over — it goes out only, in one zip, to a fixed folder. What is
left under *Session → Save session to a file* is the beginning of something else:
opening last weekend's bout and looking through it again. It has never been
designed as that.

Questions it would have to answer, none settled:

- Does loading merge with a live session or replace it? Today it replaces, and
  closes every camera.
- Should a bout be named and listed, rather than a file the operator keeps track
  of themselves?
- Should the hub hold them, so "where did it go" is never "wherever the browser
  put it"?

Worth doing when somebody actually wants to look at last weekend.

## Certificates and changing networks

A phone files its "accept this certificate" decision against the address it
visited, so a new venue means every phone accepts again. The hub says so at
startup rather than letting it surprise you.

Removing the warning outright needs either a local CA installed on every phone —
more one-time fiddling than the warning it replaces — or a real certificate for a
domain, which needs a domain and a hostname resolving to the laptop's LAN
address. Worth revisiting only if the tool goes beyond a known set of phones.

## Container handling

Nothing here is wrong today. Each is a way the current parser could be wrong on
hardware we have not used.

**Fragmented MP4, for iOS Safari.** The clip builder is WebM-only. If an iPhone
reports a non-WebM mimeType the camera page must say so loudly rather than upload
clips that cannot decode. Developable offline from a single fixture recorded on
the phone. Still unanswered: what an iPhone actually reports.

**Non-default `TimecodeScale`.** We assume one tick is one millisecond, true for
Chrome's default. A recorder that disagrees produces clips wrong by a constant
factor.

**A truncated final cluster** is emitted rather than dropped. Harmless so far —
the last cluster of a clip is the tail of the window — but a run ending
mid-cluster carries a partial one. A suspect for the duplicated frame.

**A first chunk of one byte.** Observed in the spike: Chrome split the EBML magic
number across two chunks. The parser handles it by accident rather than by test.

## Known limits worth remembering

- A saved session is read whole into memory on both sides. Fine for a bout, not
  for an afternoon.
- The hub keeps everything in memory; restarting it loses the session unless it
  was saved.
