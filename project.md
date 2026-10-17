# Share Files

## Goal

A tiny browser-based file sharer for sending files to a friend. WebRTC
establishes a direct peer-to-peer connection and the bytes travel over a
DataChannel; nothing is uploaded to or stored on a server. Signaling runs on
Cloudflare Workers + Durable Objects.

This is a sibling project to **Golive** (`golive.puhl.dev`), which shares a
screen over WebRTC. Same idea, pointed at files instead of video. It is a
friends-only tool, not a production file host.

## Scope

- No database, no accounts, no persistent storage.
- One session = one sender + one receiver, paired by a session ID.
- Share a session using a streamer-chosen URL (`/receive/<id>`).
- Files move over a WebRTC DataChannel; the server only relays SDP/ICE.
- STUN only, no TURN. If a direct path fails, show the failure clearly
  instead of silently relaying.
- Both peers must be online at the same time: closing the sender's tab ends
  the transfer.

## Stack

- Frontend: plain HTML/CSS/JS, ES modules, no build step.
- Signaling: a Cloudflare Worker plus one Durable Object per session
  (`Session`), deployed to `share.puhl.dev`.
- Transport: WebRTC `RTCPeerConnection` + ordered `RTCDataChannel`, STUN only.
- No persistence: sessions live in Durable Object memory and vanish when
  everyone disconnects. The DO outlives its WebSockets, so a peer can wait
  for the other to (re)appear.

## User flow

1. The sender opens `/send`, gets a session ID (remembered in
   `localStorage`) and a shareable link `/receive/<id>`.
2. The sender picks files, then sends the link to the receiver.
3. The receiver opens the link. If the sender is not connected yet, it waits
   and connects automatically.
4. The signaling server exchanges the WebRTC offer/answer and ICE candidates.
5. The peers connect directly and the sender streams the files over the
   DataChannel.
6. The receiver gets a download link per file; the sender sees per-file
   progress.

## Transfer protocol

Messages over the DataChannel (ordered, so ordering is guaranteed). Control
messages are JSON strings; file bytes are `ArrayBuffer` chunks:

```
{"t":"file","name":"photo.jpg","size":123456,"mime":"image/jpeg"}
<ArrayBuffer> ...                       // 64 KiB chunks
{"t":"file-end"}
{"t":"all-done"}                        // every queued file sent
```

Flow control uses the DataChannel's `bufferedAmount` backpressure: the sender
pauses above 8 MiB buffered and resumes below 1 MiB. No per-chunk ACKs.

## Files

```
share-files/
  worker.js          Cloudflare Worker: static shell serving + Session DO (signaling)
  wrangler.jsonc     Worker/DO config and the share.puhl.dev custom domain
  package.json       wrangler dev/deploy scripts (dev runs on port 3001)
  .gitignore
  project.md         this file
  README.md
  public/
    theme.css        design tokens + components (COPIED from Golive, see below)
    app.css          Share Files component styles layered on theme.css
    index.html       sender/receiver console
    home.html        landing page (Send / Receive)
    app.js           client: signaling + WebRTC + file transfer
    report.js        "Report a bug" modal (adapted from Golive)
    qr.js            dependency-free QR generator (COPIED verbatim from Golive)
```

## What was copied from Golive

- `public/theme.css` — a verbatim copy of Golive's `style.css` (the whole
  design system: colors, fonts, buttons, panels, inputs, alerts, modal,
  footer). It still contains video/squad/theater/embed rules that Share Files
  does not use. **Trim later** if the file size matters; the tokens in
  `:root` are the part that must stay in sync.
- `public/qr.js` — verbatim; exposes a global `QR`.
- `public/report.js` — adapted: English strings, no i18n dependency, config
  block at the top (`GITHUB_REPO`, `DISCORD_HANDLE`), reads
  `window.shareDiagnostics`.
- The worker's `serveShell()` + OG-meta injection + static-asset pattern from
  Golive's `worker.js`, and the general Worker/DO layout (`wrangler.jsonc`,
  `package.json`, `.gitignore`).

Deliberately **not** copied: `room.js`, `shell.js`, `squad.*`, `app.js`,
`i18n.js`, and Golive's streamer/viewer mesh logic. A file share is 1:1, so
the `Session` DO is much simpler than Golive's `Room`.

## Theme / design tokens

Identical to Golive (see `theme.css` `:root`):

- Background `#0c0e12`, panel `#141720`, input `#1a1e2a`, border `#232838`
- Text `#e6e9f0`, muted `#8b93a7`
- Accent `#4f8cff` (hover `#679dff`)
- Status: ok `#3ecf8e`, warn `#f5a524`, bad `#ff5c5c`
- Fonts: system sans (`--font-sans`), system mono (`--font-mono`)

Duplication across the two repos is intentional — there is no build step and
the token block is small.

## Deployment

```bash
cd share-files
npm install
npx wrangler login
npm run dev      # local Worker + DO on http://localhost:3001
npm run deploy   # publish to Cloudflare (share.puhl.dev)
```

`wrangler.jsonc` deploys the Worker, its `Session` Durable Object and the
static frontend from `public/` to the `share.puhl.dev` custom domain. Remove
any existing tunnel/DNS record for `share.puhl.dev` before the first deploy;
Wrangler creates the DNS record and certificate for the custom domain.

## TODO / instructions for later

- [ ] `git init`, add the remote, first commit.
- [ ] Add `public/favicon.png` (the HTML references `/favicon.png`).
- [ ] Add `public/og.png` (1200x630) for link previews, or drop the
      `og:image` tags and `OG_IMAGE` from `worker.js`.
- [ ] Add a real `README.md` (this project.md is the working doc).
- [ ] Test a real transfer between two devices/networks.
- [ ] Verify ICE/DataChannel behavior across IPv4 and IPv6.
- [ ] Consider a size/memory guard: the receiver holds the whole file in
      memory as chunks before building the Blob. Large files may need
      streaming to disk (File System Access API) instead.
- [ ] Consider chunk-level integrity (e.g. a SHA-256 in the `file` control
      message) so a dropped connection is detectable.
- [ ] Optional: room PIN (Golive has one) and an optional TURN fallback.
- [ ] Trim the unused rules from `theme.css`.
- [ ] Decide whether to keep `report.js`/QR or drop them.
