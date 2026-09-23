# The Solo spike — what it is and how to run it

Built to answer one question: **can a recording made on an iPhone be stepped one
frame at a time?** Everything else on the screen is there to make that question
askable on a real phone rather than in a lab.

It is not the finished tool. It has no icon, no offline cache, and it is served
off the laptop — all three of which the finished version drops. See
[solo-plan.md](solo-plan.md).

## Running it

On the laptop:

```
npm start
```

On the phone, on the same Wi-Fi, open the address it prints with `/solo/` on the
end:

```
https://192.168.1.3:3000/solo/
```

Accept the certificate warning once, allow the camera, and it is running. If
that phone has used the main version before, the certificate is already
accepted.

## Using it

1. **Point it at the fight** — landscape is better, and the layout knows it.
2. **START.**
3. **BOOKMARK** whenever you see something. It keeps filming. Up to five; the
   dots along the top show how many you have.
4. **STOP** when the fight is stopped.
5. **1 2 3** along the top switches between the marks. Switching is instant.
6. **Loop / Scrub / Step / Shuttle** along the bottom switch how you look at the
   moment. They are four different answers to the same question and only one of
   them needs to survive — see below.
7. **New bout** throws it away and goes back to filming.

The readout on the picture is relative to the mark itself: `+0.00s` is the
instant you pressed the button. The hairline under the picture is where you are
in the window.

## The four ways of looking, and what to judge

Switching mode keeps the mark and the position, so the same instant can be
looked at four ways one after another. That is the point of having four.

**Loop** — it goes round on its own. The only control is speed: `1× ½× ¼× ⅛×`.
Press and hold the picture to freeze it while you look, let go and it carries
on; a quick tap freezes it and leaves it frozen.

**Scrub** — the slider is the whole thing. The toggle decides whether letting go
carries on playing or leaves it where you put it. Tap the picture to start or
stop.

**Step** — four buttons, one and three frames each way. Nothing else, and a
touch on the picture does nothing, so a frame you have found cannot be lost by
resting a thumb on it.

**Shuttle** — no control at all: drag your thumb anywhere across the picture and
the footage follows. The full width is the full window. It is here because a
whole picture is a much bigger target than a slider, and because it works
one-handed without looking at your hand.

**What to tell me:** which one you reached for without thinking, which one was
annoying, and whether any of them is obviously wrong for a hall. Guesses about
which is better are worth nothing next to using them once.

## Setting the window

**before / after** live behind the ⓘ now — they are set once rather than while
looking. Find the numbers that suit and tell me what they were.

## What to look for

**Tap ⓘ.** The first line is the answer:

```
stepping WORKS here — a step moved 33, 33, 34, 33 ms  (one frame is 33 ms)
```

That is the result we want, and it means the whole approach stands up. If it
says **COARSE**, seeking can only reach keyframes and the approach has to be
replaced with WebCodecs. If it says **UNEVEN**, it is worth knowing how uneven.

The measurement counts frame steps only. It reads the media time of the frame
the device actually displayed — asking for a position and reading back the
position you asked for proves nothing — so step forward five or six times before
looking.

**Also worth reading in that panel:**

- *camera* — what resolution and frame rate the phone actually granted, and what
  container it recorded. Safari records MP4; everything else records WebM.
- *marks — page clock vs camera clock* — the two timings for each mark. There is
  a button to switch which one the review screen uses. If the moment you marked
  sits visibly off-centre, try the other clock and see whether it lands better.
  **This is the second thing worth reporting back.**
- *what this device has* — whether WebCodecs and the rest exist, which decides
  what the fallback can be built on.

## What it deliberately does not do

No icon, no offline cache, no sharing, no saving, no settings, no audio. All of
those are cheap once the question above is answered, and pointless before.

## Reporting back

A screenshot of the ⓘ panel after stepping through a mark answers almost
everything. Beyond that:

- Did the marked moment land where you expected, or early, or late?
- What did you end up setting *before* and *after* to?
- Did anything stop the camera — a notification, the screen sleeping, switching
  apps?
- How hot did the phone get, and how long did you film for?
