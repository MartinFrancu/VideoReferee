# The review screen

Stage 9 on the road map — the thing the whole tool exists for. Not built yet;
this records the interaction design so it does not have to be re-derived.

## The design

Martin's, and the shape is right:

1. Clips appear side by side, each already seeked to the bookmarked instant.
2. One angle is the **lead**. Clicking a tile makes it the lead.
3. Dragging the slider scrubs **only the lead**, live, so the drag feels
   immediate.
4. On release, every other angle jumps to the corresponding instant.
5. Everything stays **paused** there.
6. Separately, once every clip has arrived: play them all, at normal speed and
   in slow motion.

## Why it works — the part worth knowing

Seeking and playing are not the same problem.

**Seeking is exact.** Setting `currentTime` puts a video on a specific frame.
Doing it to four videos at four separately computed positions is four exact
operations, and no error accumulates. Two angles seeked to the same session
instant land on the same instant, every time.

**Playing drifts.** Four `<video>` elements each advance on their own decode
clock. Over seconds they diverge, and holding them together needs a master clock
and constant correction.

So the design's central move — *compare while paused, seek to compare* — avoids
the hard problem rather than solving it, and gives frame-accurate comparison
almost for free. Which is what a referee needs: the call is made on a still
frame, not on smooth playback.

One correction to the premise, though. Scrubbing all angles at once is not
*wrong*, it is **janky**: browsers queue seeks, four decoders thrash, and the
drag lags behind the finger. Leading with one angle is a responsiveness fix, not
a correctness workaround. That is good news — it means "jump all on release"
stays exact, and it is safe to scrub the lead as freely as we like.

## Details to settle when building it

**Pick a lead by default.** Requiring a click before the slider does anything
makes the first interaction a mystery. Default to the first tile and let clicking
change it, with the lead visibly marked.

**The slider is anchored on the bookmark**, not on any clip's start: zero is the
bookmarked instant, negative is before it. That is how a referee thinks — "just
before the hit" — and it is the only frame of reference shared by clips whose
keyframe lead-ins differ.

**Clips do not all cover the same span.** Each starts at its own preceding
keyframe, so at some slider positions an angle has no footage. Clamp that angle
and mark it plainly rather than showing a misleading nearest frame. Decision 2
already says showing only the overlap is acceptable.

**Clamp the slider to what the clips actually hold.** The spike offered a fixed
−5 s regardless, which is why five seconds of history was never there.

**Frame stepping matters more than scrubbing.** Once paused, stepping should
move every angle one frame in session time. `requestVideoFrameCallback` gives
frame boundaries; this is the tool the call actually gets made with.

**Playing them all**, when it comes: drive from one master clock and correct the
others by nudging `playbackRate` a percent or two, never by re-seeking, which
stutters. Slow motion is easier, not harder — absolute drift shrinks with the
rate. Gate the control until every clip has arrived *and* is buffered, so a
half-arrived set cannot be played and then re-laid-out underneath.
