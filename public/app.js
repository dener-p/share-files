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

const $ = (id) => document.getElementById(id);
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

const BADGE_TEXT = { waiting: "Waiting", connecting: "Connecting", live: "Connected", idle: "Offline" };

function setBadge(state) {
  const el = $("stateBadge");
  if (!el) return;
  el.textContent = BADGE_TEXT[state] || state;
  el.className = "badge " + state;
  el.hidden = false;
}

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
  ws.addEventListener("open", () => log("Signaling connected"));
  ws.addEventListener("message", (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    onSignal(m);
  });
  ws.addEventListener("close", () => {
    log("Signaling closed", "warn");
    if (!pc || pc.connectionState !== "connected") setBadge("idle");
  });
  ws.addEventListener("error", () => log("Signaling error", "bad"));
}

// ---------- WebRTC ----------

let pc = null;
let dc = null;
let pendingCandidates = [];

function wirePc(conn) {
  conn.addEventListener("icecandidate", (e) => {
    if (e.candidate) signal({ type: "candidate", payload: e.candidate });
  });
  conn.addEventListener("connectionstatechange", () => {
    log("Connection: " + conn.connectionState);
    if (conn.connectionState === "connected") setBadge("live");
    else if (conn.connectionState === "connecting") setBadge("connecting");
    else if (conn.connectionState === "failed") {
      log("Connection failed. No TURN relay is configured, so strict NAT or a firewall can block a direct path.", "bad");
      setBadge("idle");
    }
  });
}

async function startAsSender() {
  if (pc) return;
  setBadge("connecting");
  pc = new RTCPeerConnection(ICE);
  wirePc(pc);
  dc = pc.createDataChannel("file", { ordered: true });
  wireSenderChannel(dc);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signal({ type: "offer", payload: pc.localDescription });
  log("Offer sent");
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
  log("Answer sent");
}

async function handleCandidate(candidate) {
  if (pc && pc.remoteDescription && pc.remoteDescription.type) {
    try { await pc.addIceCandidate(candidate); } catch (e) { log("ICE error: " + e.message, "warn"); }
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

function resetPeer() {
  if (dc) { try { dc.close(); } catch { /* already closed */ } }
  if (pc) { try { pc.close(); } catch { /* already closed */ } }
  pc = null;
  dc = null;
  pendingCandidates = [];
  setBadge("waiting");
  if (isSender) { setSendState("Waiting for the receiver\u2026", false); updateSendButton(); }
  else setReceiveHint("Waiting for the sender\u2026");
}

function onSignal(m) {
  switch (m.type) {
    case "created":
      log("Session created: " + m.room);
      setBadge("waiting");
      break;
    case "joined":
      log("Joined session: " + m.room);
      setBadge("waiting");
      break;
    case "peer-ready":
      log("Peer is here");
      if (isSender) startAsSender().catch((e) => log("Offer failed: " + e.message, "bad"));
      break;
    case "offer":
      if (!isSender) handleOffer(m.payload).catch((e) => log("Answer failed: " + e.message, "bad"));
      break;
    case "answer":
      if (isSender && pc) pc.setRemoteDescription(m.payload).then(flushCandidates).catch((e) => log("Bad answer: " + e.message, "bad"));
      break;
    case "candidate":
      handleCandidate(m.payload);
      break;
    case "peer-left":
      log("Peer disconnected", "warn");
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
    log("Data channel open");
    updateSendButton();
    setSendState("Ready to send", true);
  });
  ch.addEventListener("close", () => {
    log("Data channel closed", "warn");
    updateSendButton();
  });
}

function dcSend(ch, data) {
  return new Promise((resolve) => {
    if (ch.bufferedAmount <= BUFFER_HIGH) {
      ch.send(data);
      resolve();
      return;
    }
    ch.bufferedAmountLowThreshold = BUFFER_LOW;
    const onLow = () => {
      ch.removeEventListener("bufferedamountlow", onLow);
      ch.send(data);
      resolve();
    };
    ch.addEventListener("bufferedamountlow", onLow);
  });
}

// ---------- DataChannel: receiver ----------

let incoming = null; // { name, size, mime, chunks, received, stateEl }

function wireReceiverChannel(ch) {
  ch.binaryType = "arraybuffer";
  ch.addEventListener("open", () => log("Data channel open (receiver)"));
  ch.addEventListener("message", onReceiverData);
  ch.addEventListener("close", () => log("Data channel closed (receiver)", "warn"));
}

function onReceiverData(e) {
  if (typeof e.data === "string") {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.t === "file") startIncoming(msg);
    else if (msg.t === "file-end") finishIncoming();
    else if (msg.t === "all-done") {
      log("All files received");
      setBadge("live");
      setReceiveHint("Done");
    }
    return;
  }
  if (!incoming) return;
  incoming.chunks.push(e.data);
  incoming.received += e.data.byteLength;
  if (incoming.size) setProgress("receiveProgress", incoming.received / incoming.size);
  if (incoming.stateEl) incoming.stateEl.textContent = formatBytes(incoming.received);
}

function startIncoming(msg) {
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
  state.textContent = "Receiving\u2026";

  li.append(meta, state);
  $("incomingList").appendChild(li);

  incoming = {
    name: msg.name,
    size: msg.size || 0,
    mime: msg.mime || "application/octet-stream",
    chunks: [],
    received: 0,
    stateEl: state,
    row: li,
  };
  setReceiveHint("Receiving\u2026");
}

function finishIncoming() {
  if (!incoming) return;
  const blob = new Blob(incoming.chunks, { type: incoming.mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.className = "file-download";
  link.href = url;
  link.download = incoming.name;
  link.textContent = "Download";
  incoming.row.appendChild(link);
  if (incoming.stateEl) {
    incoming.stateEl.textContent = "Ready";
    incoming.stateEl.className = "file-state ok";
  }
  setProgress("receiveProgress", 1);
  log("Received " + incoming.name);
  incoming = null;
}

// ---------- Sender file queue ----------

const queue = []; // { file, stateEl, state }

function addFiles(list) {
  for (const file of list) {
    if (queue.some((q) => q.file.name === file.name && q.file.size === file.size)) continue;
    queue.push({ file, stateEl: null, state: "" });
  }
  renderQueue();
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
    state.className = "file-state";
    state.textContent = item.state;
    item.stateEl = state;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "file-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      queue.splice(i, 1);
      renderQueue();
    });

    li.append(meta, state, remove);
    ul.appendChild(li);
  });
  $("clearBtn").hidden = queue.length === 0;
  updateSendButton();
}

function setRowState(item, text, cls) {
  item.state = text;
  if (item.stateEl) {
    item.stateEl.textContent = text;
    item.stateEl.className = "file-state" + (cls ? " " + cls : "");
  }
}

function updateSendButton() {
  const btn = $("sendBtn");
  if (!btn) return;
  btn.disabled = !queue.length || !dc || dc.readyState !== "open" || sending;
}

function setSendState(text, ready) {
  const hint = $("sendHint");
  if (hint) hint.textContent = ready ? text : text;
}

let sending = false;

async function sendAll() {
  if (sending || !dc || dc.readyState !== "open" || !queue.length) return;
  sending = true;
  updateSendButton();

  const total = queue.reduce((n, q) => n + q.file.size, 0) || 1;
  let sent = 0;
  try {
    for (const item of queue) {
      const file = item.file;
      log("Sending " + file.name);
      setRowState(item, "Sending\u2026");
      await dcSend(dc, JSON.stringify({
        t: "file",
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
      }));
      for (let off = 0; off < file.size; off += CHUNK_SIZE) {
        const buf = await file.slice(off, off + CHUNK_SIZE).arrayBuffer();
        await dcSend(dc, buf);
        sent += buf.byteLength;
        setProgress("sendProgress", sent / total);
        setRowState(item, formatBytes(Math.min(off + buf.byteLength, file.size)) + " / " + formatBytes(file.size));
      }
      await dcSend(dc, JSON.stringify({ t: "file-end" }));
      setRowState(item, "Sent", "ok");
    }
    await dcSend(dc, JSON.stringify({ t: "all-done" }));
    setProgress("sendProgress", 1);
    log("All files sent");
  } catch (e) {
    log("Send failed: " + e.message, "bad");
  } finally {
    sending = false;
    updateSendButton();
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

function setReceiveHint(text) {
  const el = $("receiveHint");
  if (el) el.textContent = text;
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

  $("sendBtn").addEventListener("click", () => sendAll());
  $("clearBtn").addEventListener("click", () => {
    if (sending) return;
    queue.length = 0;
    renderQueue();
  });
}

function wireLinkRow() {
  const input = $("sessionInput");
  const copyBtn = $("copyBtn");
  const qrBtn = $("qrBtn");
  const qrCopy = $("qrCopyBtn");

  if (isSender) {
    $("linkRow").hidden = false;
    $("linkLabel").textContent = "Share this link";
    input.value = sessionLink();
  } else {
    $("linkRow").hidden = false;
    $("linkLabel").textContent = "Session code";
    input.value = room;
    qrBtn.hidden = true;
  }

  const copyValue = isSender ? sessionLink() : room;
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(copyValue);
      const label = $("copyLabel");
      label.textContent = "Copied";
      copyBtn.classList.add("copied");
      setTimeout(() => { label.textContent = isSender ? "Copy link" : "Copy code"; copyBtn.classList.remove("copied"); }, 1600);
    } catch { log("Clipboard unavailable", "warn"); }
  });

  if (!isSender) return;

  qrBtn.addEventListener("click", () => {
    const box = $("qrBox");
    try {
      box.innerHTML = QR.svg(sessionLink(), { ecc: "M", margin: 2, label: "Share Files link" });
    } catch { log("QR failed", "warn"); return; }
    $("qrModal").hidden = false;
    $("qrCloseBtn").focus();
  });
  $("qrCloseBtn").addEventListener("click", () => { $("qrModal").hidden = true; $("qrBox").innerHTML = ""; });
  $("qrModal").addEventListener("click", (e) => { if (e.target === $("qrModal")) { $("qrModal").hidden = true; $("qrBox").innerHTML = ""; } });
  qrCopy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(sessionLink()); } catch { /* clipboard unavailable */ }
  });
}

// ---------- Diagnostics (for the report flow) ----------

window.shareDiagnostics = function () {
  const lines = [
    `role: ${role}`,
    `room: ${room}`,
    `time: ${new Date().toISOString()}`,
    `ua: ${navigator.userAgent}`,
    `connection: ${pc ? pc.connectionState : "-"}`,
  ];
  const el = $("log");
  if (el) lines.push("", el.textContent);
  return lines.join("\n");
};

// ---------- Boot ----------

function boot() {
  if (!room) {
    log("No session id in the URL", "bad");
    return;
  }
  document.querySelectorAll('[data-role="sender"]').forEach((n) => { n.hidden = !isSender; });
  document.querySelectorAll('[data-role="receiver"]').forEach((n) => { n.hidden = isSender; });
  $("subtitle").textContent = isSender
    ? "Pick files, share the link, and keep this tab open while the other side downloads."
    : "Waiting for the sender to start the transfer.";
  $("qrBtn").hidden = !isSender;

  $("clearLogBtn").addEventListener("click", () => { $("log").innerHTML = ""; });

  setBadge("idle");
  if (isSender) {
    $("sessionInput").value = sessionLink();
    wireSenderUi();
    setSendState("Waiting for the receiver\u2026", false);
    renderQueue();
  } else {
    setReceiveHint("Waiting for the sender\u2026");
  }
  wireLinkRow();
  connect();

  window.addEventListener("beforeunload", () => {
    if (dc) { try { dc.close(); } catch { /* noop */ } }
    if (pc) { try { pc.close(); } catch { /* noop */ } }
    if (ws) { try { ws.close(); } catch { /* noop */ } }
  });
}

boot();
