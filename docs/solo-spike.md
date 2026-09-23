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
6. **◀ ▶** step a frame; **Play** replays that moment; **¼× ½×** slow it down;
   the slider scrubs within the moment, and the readout is relative to the mark
   itself — `+0.00s` is the instant you pressed the button.
7. **before / after** re-cut how much is shown either side, live. Find the
   numbers that suit and tell me what they were.
8. **New bout** throws it away and goes back to filming.

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
