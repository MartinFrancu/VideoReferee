# VideoReferee — feasibility spike

Throwaway code, not the real app. It exists to answer one question before we
build anything real in Angular:

> Can a phone's mobile browser reliably record video for a whole bout, keep a
> local rolling buffer, and burst-upload just the bookmarked slice to a local
> server — well enough for a referee to review synced angles in seconds?

## How it works

- Each phone opens `camera.html`. It records continuously into a **local
  rolling buffer** (last ~20s), uploading nothing by default.
- Tapping BOOKMARK (on any phone) tells the server "a bookmark happened at
  time T". The server broadcasts that to **every** connected phone.
- Every phone — not just the one that tapped — then uploads its own buffered
  slice covering `T - 1.5s` to `T + 1s`, so the referee can see all angles,
  even from cameras that didn't tap anything.
- Sync is timestamp-only for this spike (a lightweight NTP-style clock-offset
  estimate per phone) — no audio cross-correlation yet.
- The referee opens `referee.html` on the laptop, sees bookmarks arrive live,
  and clicking one shows all received angles side by side.

## Setup

Requires Node.js and the phones + laptop on the **same local Wi-Fi network**.

```
cd spike/server
npm install
npm run gen-cert   # creates a throwaway self-signed TLS cert
npm start
```

Camera access (`getUserMedia`) and Wake Lock only work in a "secure context",
so this has to be served over `https://`, even on the local network — plain
`http://192.168.x.x` will silently fail to get camera permission. That's what
the self-signed cert is for.

Find your laptop's local IP (e.g. `ipconfig getifaddr en0` on macOS, or check
Wi-Fi settings) — the server prints the URLs to use on startup.

## Running a test session

1. On the laptop: open `https://<laptop-ip>:3000/referee.html`. Accept the
   certificate warning once.
2. On each phone: open `https://<laptop-ip>:3000/camera.html`. Accept the
   certificate warning, allow camera + microphone permission, and enter a
   camera name (e.g. "north", "east") when prompted.
3. Tap BOOKMARK on any phone and confirm a clip shows up for every connected
   camera in the referee page within a couple seconds.

## Test protocol — what we're actually checking

- [ ] **Continuous recording**: leave a phone recording for 3–5 minutes
      (typical bout length). Does the camera preview / recording ever
      silently die?
- [ ] **Screen lock**: lock the phone's screen mid-recording. Does Wake Lock
      keep it alive, or does recording stop?
- [ ] **App switch**: switch to another app and back mid-recording. Does the
      stream survive?
- [ ] **Weak/dropped Wi-Fi**: step out of range briefly, come back. Do
      buffered bookmarks still upload once reconnected, or are they lost
      silently?
- [ ] **Cross-camera sync**: with two phones running, tap bookmark and check
      whether the two clips actually show the "same moment" using nothing but
      the timestamp-offset sync — good enough for refereeing, or noticeably
      off?
- [ ] **iOS specifics** (this is the known risk area): test on the iPhone
      13 mini first — mimeType picked, whether Wake Lock is honored, whether
      screen-lock kills the stream despite it.

## Success / failure read-out

- **Success** → recording survives a full bout, Wake Lock prevents
  screen-lock kills, bookmarked clips arrive reliably, and timestamp sync
  looks close enough. We proceed to build the real Angular MVP on this same
  architecture (local buffer + broadcast-triggered burst upload).
- **Failure** → if screen-lock/backgrounding reliably kills the stream
  despite Wake Lock, that's the signal to wrap the camera page in Capacitor
  before building further, rather than fighting the browser.

## Explicitly out of scope here

No Angular, no styling polish, no auth, no database (clips are just files on
disk), no bout/session management, no multi-bout support, no export, no
audio-based sync. This code is meant to be thrown away once it's answered the
question above.
