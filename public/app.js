// Share Files client. Pairs with the other side over the signaling WebSocket,
// opens a WebRTC DataChannel and streams file bytes peer-to-peer. The role is
// decided by the path: /send is the sender, /receive/<id> is the receiver.
//
// Transfer protocol over the DataChannel (ordered, so ordering is guaranteed):
//   {"t":"file","name","size","mime"}   // start of one file
//   <ArrayBuffer> ...                    // raw chunks for that file
//   {"t":"file-end"}                     // file complete
//   {"t":"all-done"}                     // every queued file sent
// Flow control uses the DataChannel's own bufferedAmount backpressure, so the
// sender never queues more than BUFFER_HIGH bytes ahead of the wire.

const ICE = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
};

const CHUNK_SIZE = 64 * 1024; // 64 KiB per DataChannel message
const BUFFER_HIGH = 8 * 1024 * 1024; // pause sending above this
const BUFFER_LOW = 1 * 1024 * 1024; // resume below this

// Receiver option: stream incoming files straight to a chosen folder instead
// of buffering them in memory. Chromium-only; hidden when unavailable.
const CAN_SAVE_TO_FOLDER = typeof window.showDirectoryPicker === "function";

const $ = (id) => document.getElementById(id);
const t = (key, vars) => (window.I18N ? window.I18N.t(key, vars) : key);
const path = location.pathname.toLowerCase();
const isSender = path === "/send";
const role = isSender ? "sender" : "receiver";
const receiveMatch = path.match(/^\/receive\/([a-z0-9][a-z0-9_-]{2,23})$/);
const room = isSender ? rememberedRoom() : (receiveMatch ? receiveMatch[1] : "");

// ---------- Small UI helpers ----------

function log(msg, level) {
  const el = $("log");
  if (!el) return;
  const line = document.createElement("div");
  if (level) line.className = level;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.appendChild(line);
  while (el.childElementCount > 400) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

const BADGE_KEY = { waiting: "badge.waiting", connecting: "badge.connecting", live: "badge.live", idle: "badge.idle" };
let badgeState = "idle";

function setBadge(state) {
  badgeState = state;
  const el = $("stateBadge");
  if (!el) return;
  el.textContent = t(BADGE_KEY[state] || "badge.idle");
  el.className = "badge " + state;
  el.hidden = false;
}

// Keep text references so the labels can be re-translated on a language change.
const hintState = {
  send: { key: "sender.hint.waiting", vars: null },
  receive: { key: "receiver.hint.waiting", vars: null },
};

function setProgress(id, fraction) {
  const el = $(id);
  if (!el) return;
  el.hidden = false;
  el.firstElementChild.style.width = Math.max(0, Math.min(1, fraction)) * 100 + "%";
}

// ---------- Session id + link ----------

function randomRoom() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}

function rememberedRoom() {
  try {
    const saved = localStorage.getItem("share.room");
    if (saved && /^[a-z0-9][a-z0-9_-]{2,23}$/.test(saved)) return saved;
  } catch { /* storage unavailable */ }
  const id = randomRoom();
  try { localStorage.setItem("share.room", id); } catch { /* storage unavailable */ }
  return id;
}

function sessionLink() {
  return `${location.origin}/receive/${room}`;
}

function tokenFor() {
  const key = "share.token." + role;
  try {
    let t = sessionStorage.getItem(key);
    if (!t) {
      t = crypto.randomUUID().replace(/-/g, "");
      sessionStorage.setItem(key, t);
    }
    return t;
  } catch {
    return crypto.randomUUID().replace(/-/g, "");
  }
}

// ---------- Signaling ----------

let ws = null;

function signal(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/ws?room=${encodeURIComponent(room)}&role=${role}&token=${tokenFor()}`;
  ws = new WebSocket(url);
  ws.addEventListener("open", () => log(t("log.signalConnected")));
  ws.addEventListener("message", (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    onSignal(m);
  });
  ws.addEventListener("close", () => {
    log(t("log.signalClosed"), "warn");
    if (!pc || pc.connectionState !== "connected") setBadge("idle");
  });
  ws.addEventListener("error", () => log(t("log.signalError"), "bad"));
}

// ---------- WebRTC ----------

let pc = null;
let dc = null;
let pendingCandidates = [];
let iceRestarted = false; // one automatic ICE restart per connection attempt

function wirePc(conn) {
  conn.addEventListener("icecandidate", (e) => {
    if (e.candidate) signal({ type: "candidate", payload: e.candidate });
  });
  conn.addEventListener("connectionstatechange", () => {
    log(t("log.connection", { state: conn.connectionState }));
    if (conn.connectionState === "connected") {
      iceRestarted = false;
      setBadge("live");
    } else if (conn.connectionState === "connecting") {
      setBadge("connecting");
    } else if (conn.connectionState === "disconnected") {
      log(t("log.connectionInterrupted"), "warn");
    } else if (conn.connectionState === "failed") {
      setBadge("idle");
      // The sender owns the offer, so only it can kick off a fresh ICE
      // gathering. Try once before giving up.
      if (isSender && pc === conn && !iceRestarted && conn.localDescription) {
        iceRestarted = true;
        log(t("log.iceRestart"), "warn");
        restartAsSender().catch((e) => log(t("log.iceRestartFailed", { msg: e.message }), "bad"));
      } else {
        log(t("log.connectionFailed"), "bad");
      }
    }
  });
}

async function startAsSender() {
  // Already live? Nothing to do. Otherwise (re)negotiate from scratch so a
  // peer that reloaded or dropped can reconnect.
  if (pc && dc && dc.readyState === "open") return;
  if (pc) teardownPeer();
  iceRestarted = false;
  setBadge("connecting");
  pc = new RTCPeerConnection(ICE);
  wirePc(pc);
  dc = pc.createDataChannel("file", { ordered: true });
  wireSenderChannel(dc);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signal({ type: "offer", payload: pc.localDescription });
  log(t("log.offerSent"));
}

// Re-offer with fresh ICE credentials, keeping the same peer connection and
// DataChannel. Used when a connection attempt fails.
async function restartAsSender() {
  if (!pc) return;
  const offer = await pc.createOffer({ iceRestart: true });
  await pc.setLocalDescription(offer);
  signal({ type: "offer", payload: pc.localDescription });
  log(t("log.offerResent"));
}

async function handleOffer(payload) {
  if (!pc) {
    pc = new RTCPeerConnection(ICE);
    wirePc(pc);
    pc.addEventListener("datachannel", (e) => {
      dc = e.channel;
      wireReceiverChannel(dc);
    });
  }
  await pc.setRemoteDescription(payload);
  await flushCandidates();
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  signal({ type: "answer", payload: pc.localDescription });
  log(t("log.answerSent"));
}

async function handleCandidate(candidate) {
  if (pc && pc.remoteDescription && pc.remoteDescription.type) {
    try { await pc.addIceCandidate(candidate); } catch (e) { log(t("log.iceError", { msg: e.message }), "warn"); }
  } else {
    pendingCandidates.push(candidate);
  }
}

async function flushCandidates() {
  const list = pendingCandidates;
  pendingCandidates = [];
  for (const c of list) {
    try { await pc.addIceCandidate(c); } catch { /* ignore stale candidate */ }
  }
}

// Close the transport without touching the UI. Clears `sending` so a failed
// transfer never leaves the Send button stuck disabled.
function teardownPeer() {
  if (dc) { try { dc.close(); } catch { /* already closed */ } }
  if (pc) { try { pc.close(); } catch { /* already closed */ } }
  pc = null;
  dc = null;
  pendingCandidates = [];
  sending = false;
  setPaused(false);
}

function resetPeer() {
  teardownPeer();
  setBadge("waiting");
  if (isSender) {
    setSendState("sender.hint.waiting");
    updateSenderUi();
  } else {
    setReceiveHint("receiver.hint.waiting");
    receiveState = "idle";
    manifest = null;
    updateReceiverControls();
  }
}

function onSignal(m) {
  switch (m.type) {
    case "created":
      log(t("log.sessionCreated", { room: m.room }));
      setBadge("waiting");
      break;
    case "joined":
      log(t("log.sessionJoined", { room: m.room }));
      setBadge("waiting");
      break;
    case "peer-ready":
      log(t("log.peerHere"));
      if (isSender) startAsSender().catch((e) => log(t("log.offerFailed", { msg: e.message }), "bad"));
      break;
    case "offer":
      if (!isSender) handleOffer(m.payload).catch((e) => log(t("log.answerFailed", { msg: e.message }), "bad"));
      break;
    case "answer":
      if (isSender && pc) pc.setRemoteDescription(m.payload).then(flushCandidates).catch((e) => log(t("log.badAnswer", { msg: e.message }), "bad"));
      break;
    case "candidate":
      handleCandidate(m.payload);
      break;
    case "peer-left":
      log(t("log.peerLeft"), "warn");
      resetPeer();
      break;
    case "error":
      log(m.message || m.code, m.code === "no-peer" ? "warn" : "bad");
      break;
    default:
      break;
  }
}

// ---------- DataChannel: sender ----------

function wireSenderChannel(ch) {
  ch.binaryType = "arraybuffer";
  ch.addEventListener("open", () => {
    log(t("log.dcOpen"));
    updateSenderUi();
    setSendState("sender.hint.waitingStart");
    sendManifest();
  });
  ch.addEventListener("message", onSenderData);
  ch.addEventListener("close", () => {
    log(t("log.dcClosed"), "warn");
    updateSenderUi();
  });
  ch.addEventListener("error", (e) => {
    log(e && e.error ? t("log.dcErrorDetail", { msg: e.error.message }) : t("log.dcError"), "bad");
  });
}

// The receiver drives the transfer: it sends "start" (Download), and may
// pause/resume mid-transfer. The sender only ever reacts.
function onSenderData(e) {
  if (typeof e.data !== "string") return;
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }
  if (msg.t === "start") {
    setPaused(false);
    sendAll();
  } else if (msg.t === "pause") {
    setPaused(true);
    setSendState("sender.hint.paused");
  } else if (msg.t === "resume") {
    setPaused(false);
    setSendState("sender.hint.sending");
  }
}

// Tell the receiver what is queued (and how big it is) so it can show a
// summary and enable its Download button.
function sendManifest() {
  if (!dc || dc.readyState !== "open") return;
  const files = queue
    .filter((q) => q.state !== "state.sent")
    .map((q) => ({ name: q.file.name, size: q.file.size, mime: q.file.type || "" }));
  const total = files.reduce((n, f) => n + f.size, 0);
  dcSend(dc, JSON.stringify({ t: "manifest", files, total })).catch(() => {
    /* channel went away */
  });
}

// Send one message, respecting the DataChannel's own backpressure. Resolves
// once the message is handed to the channel; rejects if the channel closes or
// errors while we're waiting, so callers never hang forever.
function dcSend(ch, data) {
  return new Promise((resolve, reject) => {
    if (!ch || ch.readyState !== "open") {
      reject(new Error("data channel is not open"));
      return;
    }
    if (ch.bufferedAmount <= BUFFER_HIGH) {
      try {
        ch.send(data);
        resolve();
      } catch (e) {
        reject(e);
      }
      return;
    }

    ch.bufferedAmountLowThreshold = BUFFER_LOW;
    const cleanup = () => {
      ch.removeEventListener("bufferedamountlow", onLow);
      ch.removeEventListener("close", onClose);
      ch.removeEventListener("error", onError);
    };
    const onLow = () => {
      cleanup();
      if (ch.readyState !== "open") { reject(new Error("data channel closed")); return; }
      try {
        ch.send(data);
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    const onClose = () => { cleanup(); reject(new Error("data channel closed")); };
    const onError = (e) => { cleanup(); reject((e && e.error) || new Error("data channel error")); };
    ch.addEventListener("bufferedamountlow", onLow);
    ch.addEventListener("close", onClose);
    ch.addEventListener("error", onError);
  });
}

// ---------- DataChannel: receiver ----------

// Where incoming files go. When set (via the "Choose folder" button) each file
// is streamed straight to disk, so a large transfer never has to fit in memory.
// Otherwise chunks are buffered and offered as a Blob download.
let dirHandle = null;
// Fallback for browsers/folders where folder access is refused: keep the
// incoming bytes in memory and offer them as normal downloads.
let memoryMode = false;
// Last folder-picker failure (error name), shown until the receiver picks a
// folder or chooses the in-memory fallback.
let folderErrorReason = "";
let incoming = null;
let manifest = null; // { count, bytes } from the sender
let receiveState = "idle"; // idle | ready | transferring | paused | done | failed

function wireReceiverChannel(ch) {
  ch.binaryType = "arraybuffer";
  ch.addEventListener("open", () => {
    log(t("log.dcOpenReceiver"));
    updateReceiverControls();
  });
  ch.addEventListener("message", onReceiverData);
  ch.addEventListener("close", () => {
    log(t("log.dcClosedReceiver"), "warn");
    if (incoming) failIncoming("connection closed");
    receiveState = "idle";
    manifest = null;
    updateReceiverControls();
  });
  ch.addEventListener("error", (e) => {
    log(e && e.error ? t("log.dcErrorDetail", { msg: e.error.message }) : t("log.dcErrorReceiver"), "bad");
  });
}

function onReceiverData(e) {
  if (typeof e.data === "string") {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.t === "manifest") onManifest(msg);
    else if (msg.t === "file") startIncoming(msg);
    else if (msg.t === "file-end") finishIncoming();
    else if (msg.t === "all-done") {
      log(t("log.allReceived"));
      receiveState = "done";
      setBadge("live");
      setReceiveHint("receiver.hint.done");
      updateReceiverControls();
    }
    return;
  }
  if (!incoming || incoming.done) return;
  const buf = e.data;
  incoming.received += buf.byteLength;
  if (incoming.writer) {
    // Serialize writes and record (but keep going after) a write error.
    incoming.writeChain = incoming.writeChain
      .then(() => incoming.writer.write(buf))
      .catch((err) => {
        if (!incoming.saveError) incoming.saveError = err.message;
      });
  } else {
    incoming.chunks.push(buf);
  }
  if (incoming.size) setProgress("receiveProgress", incoming.received / incoming.size);
  setStatusEl(incoming.stateEl, "state.progress", {
    done: formatBytes(incoming.received),
    total: incoming.size ? formatBytes(incoming.size) : "?",
  });
}

// The sender announces what is queued so we can show a summary and enable the
// Download button. It re-sends this whenever the queue changes.
function onManifest(msg) {
  const count = Array.isArray(msg.files) ? msg.files.length : 0;
  manifest = { count, bytes: msg.total || 0 };

  // Ignore manifest updates while a transfer is in flight; they'll be picked
  // up by the next download. Otherwise reflect the new queue.
  if (receiveState !== "transferring" && receiveState !== "paused") {
    if (count) {
      const label = count === 1 ? t("receiver.fileCount.one") : t("receiver.fileCount.many", { n: count });
      const summary = t("receiver.summary", { label, size: formatBytes(manifest.bytes) });
      setReceiveHint(
        CAN_SAVE_TO_FOLDER && !dirHandle && !memoryMode
          ? "receiver.hint.chooseFolder"
          : "receiver.hint.ready",
        { summary },
      );
      receiveState = "ready";
    } else {
      if (receiveState !== "done") {
        setReceiveHint("receiver.hint.noFiles");
        receiveState = "idle";
      }
    }
  }
  updateReceiverControls();
}

async function startIncoming(msg) {
  const li = document.createElement("li");
  li.className = "file-row";

  const meta = document.createElement("div");
  meta.className = "file-meta";
  const name = document.createElement("span");
  name.className = "file-name";
  name.textContent = msg.name;
  const size = document.createElement("span");
  size.className = "file-size";
  size.textContent = formatBytes(msg.size || 0);
  meta.append(name, size);

  const state = document.createElement("span");
  state.className = "file-state";
  setStatusEl(state, "state.receiving");

  li.append(meta, state);
  $("incomingList").appendChild(li);

  const item = {
    name: msg.name,
    size: msg.size || 0,
    mime: msg.mime || "application/octet-stream",
    chunks: [],
    received: 0,
    stateEl: state,
    row: li,
    writer: null,
    writeChain: Promise.resolve(),
    saveError: "",
    done: false,
  };
  incoming = item;
  setReceiveHint("receiver.hint.receiving");

  if (!dirHandle) return;

  // Stream to disk. Chunks that arrive while the handle is opening are held in
  // item.chunks and flushed once the writer is ready; if opening fails we fall
  // back to the in-memory path (item.writer stays null).
  try {
    item.name = await uniqueFileName(dirHandle, item.name);
    if (item.name !== msg.name) name.textContent = item.name;
    const fileHandle = await dirHandle.getFileHandle(item.name, { create: true });
    const writer = await fileHandle.createWritable();
    item.writer = writer;
    const buffered = item.chunks;
    item.chunks = [];
    for (const b of buffered) item.writeChain = item.writeChain.then(() => writer.write(b));
  } catch (err) {
    log(t("log.openSaveFailed", { msg: err.message }), "warn");
    item.writer = null;
  }
}

async function uniqueFileName(dir, name) {
  const taken = new Set();
  for await (const handle of dir.values()) taken.add(handle.name);
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}

async function finishIncoming() {
  const item = incoming;
  if (!item || item.done) return;
  incoming = null;
  item.done = true;

  // Disk path.
  if (item.writer) {
    try {
      await item.writeChain;
      if (item.saveError) throw new Error(item.saveError);
      await item.writer.close();
      setStatusEl(item.stateEl, "state.saved", null, "ok");
      setProgress("receiveProgress", 1);
      log(t("log.saved", { name: item.name }));
    } catch (err) {
      setStatusEl(item.stateEl, "state.saveFailed", null, "bad");
      try { if (item.writer.abort) await item.writer.abort(); } catch { /* writer already gone */ }
      log(t("log.saveFailed", { name: item.name, msg: err.message }), "bad");
      receiveState = "failed";
      setReceiveHint("receiver.hint.stopped");
      updateReceiverControls();
    }
    return;
  }

  // In-memory path. If the byte count doesn't match what the sender announced,
  // the transfer was cut short even though file-end somehow arrived.
  if (item.size && item.received < item.size) {
    setStatusEl(item.stateEl, "state.incomplete", null, "bad");
    log(t("log.incompleteBytes", { name: item.name, received: item.received, size: item.size }), "bad");
    receiveState = "failed";
    setReceiveHint("receiver.hint.stopped");
    updateReceiverControls();
    return;
  }

  const blob = new Blob(item.chunks, { type: item.mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.className = "file-download";
  link.href = url;
  link.download = item.name;
  link.textContent = t("receiver.download");
  item.row.appendChild(link);
  setStatusEl(item.stateEl, "state.ready", null, "ok");
  setProgress("receiveProgress", 1);
  log(t("log.received", { name: item.name }));
}

// The stream ended (channel closed, error, or the sender left) before the
// active file was complete. Mark it clearly instead of leaving it "Receiving".
function failIncoming(reason) {
  const item = incoming;
  if (!item) return;
  incoming = null;
  item.done = true;
  if (item.writer) {
    try { Promise.resolve(item.writeChain).finally(() => { try { item.writer.abort(); } catch { /* gone */ } }); }
    catch { /* ignore */ }
  }
  if (item.stateEl) {
    setStatusEl(item.stateEl, "state.incomplete", null, "bad");
  }
  log(t("log.incomplete", { name: item.name }) + (reason ? " (" + reason + ")" : ""), "bad");
  receiveState = "failed";
  setReceiveHint("receiver.hint.stopped");
  setBadge("idle");
  updateReceiverControls();
}

// ---------- Sender file queue ----------

const queue = []; // { file, stateEl, state }

function addFiles(list) {
  for (const file of list) {
    if (queue.some((q) => q.file.name === file.name && q.file.size === file.size)) continue;
    queue.push({ file, stateEl: null, state: "" });
  }
  renderQueue();
  maybeWaitingStart();
}

// If the channel is open and there is something left to send, tell the user the
// receiver has to press Download. Kept out of renderQueue so a language change
// (which re-renders the queue) never overwrites a more specific hint.
function maybeWaitingStart() {
  if (dc && dc.readyState === "open" && !sending && queue.some((q) => q.state !== "state.sent")) {
    setSendState("sender.hint.waitingStart");
  }
}

function renderQueue() {
  const ul = $("fileList");
  ul.innerHTML = "";
  queue.forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "file-row";

    const meta = document.createElement("div");
    meta.className = "file-meta";
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = item.file.name;
    const size = document.createElement("span");
    size.className = "file-size";
    size.textContent = formatBytes(item.file.size);
    meta.append(name, size);

    const state = document.createElement("span");
    state.className = "file-state" + (stateClass(item.state) ? " " + stateClass(item.state) : "");
    state.textContent = item.state ? t(item.state, item.vars) : "";
    item.stateEl = state;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "file-remove";
    remove.textContent = t("sender.remove");
    remove.addEventListener("click", () => {
      if (sending) return;
      queue.splice(i, 1);
      renderQueue();
      maybeWaitingStart();
    });

    li.append(meta, state, remove);
    ul.appendChild(li);
  });
  updateSenderUi();
  sendManifest();
}

function stateClass(key) {
  if (key === "state.sent") return "ok";
  if (key === "state.failed") return "bad";
  return "";
}

function setRowState(item, key, vars, cls) {
  item.state = key;
  item.vars = vars || null;
  if (item.stateEl) {
    item.stateEl.textContent = key ? t(key, vars) : "";
    item.stateEl.className = "file-state" + (cls ? " " + cls : "");
  }
}

function updateSenderUi() {
  const clear = $("clearBtn");
  if (clear) clear.hidden = queue.length === 0;
}

function setSendState(key, vars) {
  hintState.send = { key, vars: vars || null };
  const hint = $("sendHint");
  if (hint) hint.textContent = t(key, vars);
}

let sending = false;
let sendingItem = null;
let paused = false;
let pauseWaiters = [];

// Resolves immediately unless the receiver has paused the transfer; if paused,
// resolves when it resumes (or the peer goes away and we tear down).
function waitIfPaused() {
  if (!paused) return Promise.resolve();
  return new Promise((resolve) => pauseWaiters.push(resolve));
}

function setPaused(value) {
  paused = value;
  if (!paused) {
    const waiters = pauseWaiters;
    pauseWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

async function sendAll() {
  const ch = dc;
  if (sending || !ch || ch.readyState !== "open" || !queue.length) return;
  if (!queue.some((q) => q.state !== "state.sent")) return;
  sending = true;
  setPaused(false);
  setSendState("sender.hint.sending");
  updateSenderUi();

  const total = queue.reduce((n, q) => n + q.file.size, 0) || 1;
  let sent = 0;
  try {
    // Items already marked sent are skipped, so a retry only resends what
    // did not make it.
    for (const item of queue) {
      if (item.state === "state.sent") continue;
      await waitIfPaused();
      if (ch !== dc || ch.readyState !== "open") throw new Error("connection replaced");
      const file = item.file;
      sendingItem = item;
      log(t("log.sending", { name: file.name }));
      setRowState(item, "state.sending");
      await dcSend(ch, JSON.stringify({
        t: "file",
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
      }));
      for (let off = 0; off < file.size; off += CHUNK_SIZE) {
        await waitIfPaused();
        if (ch !== dc || ch.readyState !== "open") throw new Error("connection replaced");
        const buf = await file.slice(off, off + CHUNK_SIZE).arrayBuffer();
        await dcSend(ch, buf);
        sent += buf.byteLength;
        setProgress("sendProgress", sent / total);
        setRowState(item, "state.progress", {
          done: formatBytes(Math.min(off + buf.byteLength, file.size)),
          total: formatBytes(file.size),
        });
      }
      await dcSend(ch, JSON.stringify({ t: "file-end" }));
      setRowState(item, "state.sent", null, "ok");
    }
    await dcSend(ch, JSON.stringify({ t: "all-done" }));
    setProgress("sendProgress", 1);
    setSendState("sender.hint.done");
    log(t("log.allSent"));
  } catch (e) {
    log(t("log.sendFailed", { msg: e.message }), "bad");
    if (sendingItem) setRowState(sendingItem, "state.failed", null, "bad");
    for (const item of queue) {
      if (item !== sendingItem && item.state !== "state.sent") setRowState(item, "state.notSent");
    }
    setSendState("sender.hint.stopped");
    setBadge("idle");
  } finally {
    sending = false;
    sendingItem = null;
    updateSenderUi();
    sendManifest();
  }
}

// ---------- Formatting ----------

function formatBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const value = n / Math.pow(1024, i);
  return (i === 0 ? value : value.toFixed(value >= 10 ? 0 : 1)) + " " + units[i];
}

// ---------- UI wiring ----------

function setReceiveHint(key, vars) {
  hintState.receive = { key, vars: vars || null };
  const el = $("receiveHint");
  if (el) el.textContent = t(key, vars);
}

// Set a row's status text and remember the key/params so it can be re-rendered
// when the language changes.
function setStatusEl(el, key, vars, cls) {
  if (!el) return;
  el.textContent = t(key, vars);
  el.dataset.stateKey = key;
  if (vars) el.dataset.stateVars = JSON.stringify(vars);
  else delete el.dataset.stateVars;
  if (cls != null) el.className = "file-state" + (cls ? " " + cls : "");
}

function refreshStatusEls(root) {
  if (!root) return;
  root.querySelectorAll("[data-state-key]").forEach((el) => {
    const vars = el.dataset.stateVars ? JSON.parse(el.dataset.stateVars) : null;
    el.textContent = t(el.dataset.stateKey, vars);
  });
}

function wireSenderUi() {
  const dropzone = $("dropzone");
  const input = $("fileInput");

  input.addEventListener("change", () => {
    addFiles([...input.files]);
    input.value = "";
  });

  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); }));
  ["dragleave", "dragend"].forEach((ev) =>
    dropzone.addEventListener(ev, () => dropzone.classList.remove("drag")));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag");
    addFiles([...e.dataTransfer.files]);
  });

  $("clearBtn").addEventListener("click", () => {
    if (sending) return;
    queue.length = 0;
    renderQueue();
  });
}

// Receiver controls: choose a folder, start the download, and pause/resume.
// The receiver drives the transfer; the sender only reacts.
function wireReceiverUi() {
  const dirBtn = $("saveDirBtn");
  const dlBtn = $("downloadBtn");
  const pauseBtn = $("pauseBtn");
  const memBtn = $("memoryBtn");

  if (CAN_SAVE_TO_FOLDER) {
    dirBtn.hidden = false;
    dirBtn.addEventListener("click", chooseFolder);
    // Hidden by default; chooseFolder() reveals it if the picker refuses a
    // folder, so the receiver can still fall back to in-memory downloads.
    memBtn.addEventListener("click", () => {
      memoryMode = true;
      folderErrorReason = "";
      updateFolderNote();
      updateReceiverControls();
    });
  }

  dlBtn.addEventListener("click", () => startOrRetry());
  pauseBtn.addEventListener("click", togglePause);
  updateFolderNote();
  updateReceiverControls();
}

// Show where files are going (or why they aren't going to a folder).
function updateFolderNote() {
  const note = $("saveDirNote");
  const dirBtn = $("saveDirBtn");
  if (!note || !dirBtn) return;
  if (dirHandle) {
    note.hidden = false;
    note.textContent = t("receiver.savingTo", { name: dirHandle.name });
    dirBtn.textContent = t("receiver.changeFolder");
  } else if (memoryMode) {
    note.hidden = false;
    note.textContent = t("receiver.memoryModeNote");
  } else if (folderErrorReason) {
    note.hidden = false;
    note.textContent = t("receiver.folderError", { reason: folderErrorReason });
  } else if (!CAN_SAVE_TO_FOLDER) {
    note.hidden = false;
    note.textContent = t("receiver.memoryNote");
  } else {
    note.hidden = true;
  }
}

async function chooseFolder() {
  try {
    dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    memoryMode = false;
    folderErrorReason = "";
    const memBtn = $("memoryBtn");
    if (memBtn) memBtn.hidden = true;
  } catch (err) {
    // AbortError means the user simply cancelled the picker.
    if (err && err.name !== "AbortError") {
      folderErrorReason = err.name || err.message || "unknown";
      const memBtn = $("memoryBtn");
      if (memBtn) memBtn.hidden = false;
    }
    updateFolderNote();
    updateReceiverControls();
    return;
  }
  updateFolderNote();
  updateReceiverControls();
}

// "Download" starts the transfer (and doubles as "Retry" after a failure).
// Files already marked sent are skipped by the sender, so retry is cheap.
function startOrRetry() {
  if (!dc || dc.readyState !== "open") return;
  if (CAN_SAVE_TO_FOLDER && !dirHandle && !memoryMode) {
    // Folder is the default where supported: ask for one, then start.
    chooseFolder().then(() => { if (dirHandle || memoryMode) startOrRetry(); });
    return;
  }
  receiveState = "transferring";
  setReceiveHint("receiver.hint.receiving");
  setBadge("connecting");
  updateReceiverControls();
  dcSend(dc, JSON.stringify({ t: "start" })).catch((e) => {
    log(t("log.couldNotStart", { msg: e.message }), "bad");
    receiveState = "failed";
    updateReceiverControls();
  });
}

function togglePause() {
  if (!dc || dc.readyState !== "open") return;
  if (receiveState === "paused") {
    receiveState = "transferring";
    setReceiveHint("receiver.hint.receiving");
    dcSend(dc, JSON.stringify({ t: "resume" })).catch(() => { /* channel gone */ });
  } else {
    receiveState = "paused";
    setReceiveHint("receiver.hint.paused");
    dcSend(dc, JSON.stringify({ t: "pause" })).catch(() => { /* channel gone */ });
  }
  updateReceiverControls();
}

function updateReceiverControls() {
  const dl = $("downloadBtn");
  const pause = $("pauseBtn");
  if (!dl) return;

  const active = receiveState === "transferring" || receiveState === "paused";
  const canStart = !!manifest && manifest.count > 0 && dc && dc.readyState === "open";
  const needsFolder = CAN_SAVE_TO_FOLDER && !dirHandle && !memoryMode;

  dl.hidden = receiveState === "done";
  dl.textContent = receiveState === "failed" ? t("receiver.retry") : t("receiver.download");
  dl.disabled = active || (!canStart && receiveState !== "failed") || needsFolder;

  pause.hidden = !active;
  pause.textContent = receiveState === "paused" ? t("receiver.resume") : t("receiver.pause");

  const dirBtn = $("saveDirBtn");
  if (dirBtn) dirBtn.disabled = active;
}

function wireLinkRow() {
  const input = $("sessionInput");
  const copyBtn = $("copyBtn");
  const qrBtn = $("qrBtn");
  const qrCopy = $("qrCopyBtn");

  if (isSender) {
    $("linkRow").hidden = false;
    $("linkLabel").textContent = t("link.share");
    input.value = sessionLink();
  } else {
    $("linkRow").hidden = false;
    $("linkLabel").textContent = t("link.code");
    input.value = room;
    qrBtn.hidden = true;
  }

  const copyValue = isSender ? sessionLink() : room;
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(copyValue);
      const label = $("copyLabel");
      label.textContent = t("link.copied");
      copyBtn.classList.add("copied");
      setTimeout(() => { label.textContent = copyLabelText(); copyBtn.classList.remove("copied"); }, 1600);
    } catch { log(t("log.clipboardUnavailable"), "warn"); }
  });

  if (!isSender) return;

  qrBtn.addEventListener("click", () => {
    const box = $("qrBox");
    try {
      box.innerHTML = QR.svg(sessionLink(), { ecc: "M", margin: 2, label: "Share Files link" });
    } catch { log(t("log.qrFailed"), "warn"); return; }
    $("qrModal").hidden = false;
    $("qrCloseBtn").focus();
  });
  $("qrCloseBtn").addEventListener("click", () => { $("qrModal").hidden = true; $("qrBox").innerHTML = ""; });
  $("qrModal").addEventListener("click", (e) => { if (e.target === $("qrModal")) { $("qrModal").hidden = true; $("qrBox").innerHTML = ""; } });
  qrCopy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(sessionLink()); } catch { /* clipboard unavailable */ }
  });
}

function copyLabelText() {
  return t(isSender ? "link.copyLink" : "link.copyCode");
}

// Re-translate everything that is set from JavaScript. Called once when the
// page boots and again whenever the language changes.
function refreshUi() {
  const sub = $("subtitle");
  if (sub) sub.textContent = t(isSender ? "subtitle.sender" : "subtitle.receiver");

  if (isSender) {
    if ($("linkLabel")) $("linkLabel").textContent = t("link.share");
  } else if ($("linkLabel")) {
    $("linkLabel").textContent = t("link.code");
  }
  const copyBtn = $("copyBtn");
  if (copyBtn && !copyBtn.classList.contains("copied") && $("copyLabel")) {
    $("copyLabel").textContent = copyLabelText();
  }

  const sh = $("sendHint");
  if (sh) sh.textContent = t(hintState.send.key, hintState.send.vars);
  const rh = $("receiveHint");
  if (rh) rh.textContent = t(hintState.receive.key, hintState.receive.vars);

  setBadge(badgeState);
  if (isSender) renderQueue();
  updateReceiverControls();
  updateFolderNote();
  refreshStatusEls($("incomingList"));
}

// ---------- Diagnostics (for the report flow) ----------

window.shareDiagnostics = function () {
  const lines = [
    `role: ${role}`,
    `room: ${room}`,
    `time: ${new Date().toISOString()}`,
    `ua: ${navigator.userAgent}`,
    `connection: ${pc ? pc.connectionState : "-"}`,
    `saving_to_folder: ${dirHandle ? "yes (" + dirHandle.name + ")" : "no"}`,
  ];
  const el = $("log");
  if (el) lines.push("", el.textContent);
  return lines.join("\n");
};

// ---------- Boot ----------

function boot() {
  if (!room) {
    log(t("log.noRoom"), "bad");
    return;
  }
  document.querySelectorAll('[data-role="sender"]').forEach((n) => { n.hidden = !isSender; });
  document.querySelectorAll('[data-role="receiver"]').forEach((n) => { n.hidden = isSender; });
  $("qrBtn").hidden = !isSender;

  $("clearLogBtn").addEventListener("click", () => { $("log").innerHTML = ""; });

  setBadge("idle");
  if (isSender) {
    $("sessionInput").value = sessionLink();
    wireSenderUi();
    setSendState("sender.hint.waiting");
    renderQueue();
  } else {
    setReceiveHint("receiver.hint.waiting");
    wireReceiverUi();
  }
  wireLinkRow();
  refreshUi();
  document.addEventListener("i18n:change", refreshUi);
  connect();

  window.addEventListener("beforeunload", () => {
    if (dc) { try { dc.close(); } catch { /* noop */ } }
    if (pc) { try { pc.close(); } catch { /* noop */ } }
    if (ws) { try { ws.close(); } catch { /* noop */ } }
  });
}

boot();
