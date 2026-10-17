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
(or on another device) to receive them.

## Deploy

```bash
npm run deploy   # publishes to share.puhl.dev
```

## How it works

- `worker.js` serves the static frontend and runs one Durable Object per
  session, which pairs a sender with a receiver and relays the WebRTC
  offer/answer and ICE candidates. It never sees the files.
- `public/app.js` opens the DataChannel and streams the files in 64 KiB
  chunks with `bufferedAmount` backpressure.
- STUN only, no TURN: both peers must be reachable directly. If no direct
  path exists, the connection fails visibly instead of relaying.

See [`project.md`](./project.md) for the full design, the copied-from-Golive
notes and the remaining TODOs.

## Theme

The UI reuses Golive's design system, copied into `public/theme.css`
(colors, fonts, buttons, panels, inputs, modal). `public/app.css` layers the
file-specific components on top.
