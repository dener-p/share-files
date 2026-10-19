# Share Files

Send files to a friend over a private link. WebRTC carries the bytes
peer-to-peer, so nothing is stored on a server.

A small sibling project to [Golive](https://golive.puhl.dev), which does the
same for screen sharing.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3001
```

Open `/send`, pick files, copy the link, and open that link in another browser
(or on another device). On the receiving side, choose a folder and click
**Download** to start the transfer (pause/resume as needed).

## Deploy

```bash
npm run deploy   # publishes to share.puhl.dev
```

## How it works

- `worker.js` serves the static frontend and runs one Durable Object per
  session, which pairs a sender with a receiver and relays the WebRTC
  offer/answer and ICE candidates. It never sees the files.
- `public/app.js` opens the DataChannel and streams the files in 64 KiB
  chunks with `bufferedAmount` backpressure. The receiver drives the transfer:
  it picks a folder, clicks **Download**, and can pause/resume. If a transfer
  is interrupted it marks the affected files for retry instead of hanging.
- Incoming files stream straight to the receiver's chosen folder (File System
  Access API) so large transfers stay off the memory heap; unsupported
  browsers fall back to in-memory Blob downloads. If Chrome refuses a folder
  (drive roots and folders holding system files are blocked), the UI explains
  why and offers a memory-only download instead.
- The UI ships in English and Brazilian Portuguese. On first load it follows
  the browser's language (via `navigator.languages`) and remembers the user's
  choice in `localStorage`; the selector in the header switches it live.
- STUN only, no TURN: both peers must be reachable directly. If no direct
  path exists, the connection fails visibly instead of relaying. The sender
  tries one automatic ICE restart first.

See [`project.md`](./project.md) for the full design, the copied-from-Golive
notes and the remaining TODOs.

## Theme

The UI reuses Golive's design system, copied into `public/theme.css`
(colors, fonts, buttons, panels, inputs, modal). `public/app.css` layers the
file-specific components on top.
