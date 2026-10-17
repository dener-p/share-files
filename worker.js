// Share Files signaling: a Cloudflare Worker that routes WebSocket connections
// to a Durable Object per share session. Each Session DO pairs exactly one
// sender with one receiver and relays SDP/ICE between them. Files travel over
// a WebRTC DataChannel, peer-to-peer; nothing passes through Cloudflare and
// there is no storage.
//
// A session is ephemeral: it exists only while a participant is connected. The
// DO survives with zero WebSockets, so a receiver that opens a link early just
// waits until the sender (re)appears, and vice versa.

const ROOM_ID_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/;
// SDP with accumulated ICE candidates can get chunky; keep a generous cap.
const MAX_MSG_BYTES = 256 * 1024;
const WS_OPEN = 1; // WebSocket.OPEN
const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function text(body, status) {
  return new Response(body, {
    status,
    headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
  });
}

// Link-preview image (1200x630). Served as a static asset if present.
const OG_IMAGE = "/og.png";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Open Graph metadata per route. Crawlers don't run JS, so the shell's meta
// tags are filled in here, server-side.
function ogFor(kind, room) {
  if (kind === "home") {
    return {
      title: "Share Files",
      description: "Send files to a friend over a private link. WebRTC carries the bytes peer-to-peer, with no account and no server in the middle.",
    };
  }
  if (kind === "send") {
    return {
      title: "Share Files \u2014 send",
      description: "Pick files and send the link to whoever should download them.",
    };
  }
  return {
    title: `Share Files \u2014 download from ${room}`,
    description: `Download the files shared in session ${room}.`,
  };
}

// Serve an HTML shell (the app or the landing page) without caching so a
// deploy takes effect on the next load, filling in the link-preview meta tags.
async function serveShell(env, url, assetPath, og) {
  const res = await env.ASSETS.fetch(new Request(new URL(assetPath, url.origin)));
  let html = await res.text();
  html = html
    .replaceAll("__OG_TITLE__", escapeHtml(og.title))
    .replaceAll("__OG_DESC__", escapeHtml(og.description))
    .replaceAll("__OG_URL__", escapeHtml(url.origin + url.pathname))
    .replaceAll("__OG_IMAGE__", escapeHtml(url.origin + OG_IMAGE))
    .replaceAll("__APP_VERSION__", escapeHtml(String(env.APP_VERSION || "")));
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(NO_STORE)) headers.set(k, v);
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(html, { status: res.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const lower = path.toLowerCase();

    // Signaling: relay to the Durable Object that owns this session.
    if (path === "/ws") {
      const room = (url.searchParams.get("room") || "").toLowerCase();
      if (!ROOM_ID_RE.test(room)) return text("Invalid session ID\n", 400);
      const stub = env.SESSIONS.get(env.SESSIONS.idFromName(room));
      return stub.fetch(request);
    }

    // Landing page: choose Send or Receive.
    if (path === "/") return serveShell(env, url, "/home.html", ogFor("home"));

    // Sender console. The client decides its role from the path.
    if (lower === "/send") return serveShell(env, url, "/index.html", ogFor("send"));

    // Receiver URL. Session IDs are lowercase; redirect a mixed-case path to
    // its canonical form.
    if (lower.startsWith("/receive/")) {
      const recv = lower.match(/^\/receive\/([a-z0-9][a-z0-9_-]{2,23})$/);
      if (!recv) return text("Not found\n", 404);
      if (path !== lower) {
        const target = new URL(`/receive/${recv[1]}`, url.origin);
        target.search = url.search;
        return Response.redirect(target.toString(), 302);
      }
      return serveShell(env, url, "/index.html", ogFor("receive", recv[1]));
    }

    // Short alias: a bare session ID (/abc123) redirects to the canonical
    // /receive/<id>, so typing a code in the address bar just works.
    const alias = lower.match(/^\/([a-z0-9][a-z0-9_-]{2,23})$/);
    if (alias) {
      const target = new URL(`/receive/${alias[1]}`, url.origin);
      target.search = url.search;
      return Response.redirect(target.toString(), 302);
    }

    // Everything else (app.js, theme.css, favicon.png, ...) is a static asset.
    return env.ASSETS.fetch(request);
  },
};

export class Session {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  attachment(ws) {
    return ws.deserializeAttachment() || null;
  }

  roleOf(ws) {
    const a = this.attachment(ws);
    return a ? a.role : null;
  }

  // Accepted, still-open sockets with a role, optionally excluding one socket.
  // getWebSockets() can briefly keep returning a socket after it closed, so
  // closed sockets are filtered out; otherwise a stale one blocks a reconnect.
  socketsWithRole(role, exclude) {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws !== exclude && ws.readyState === WS_OPEN && this.roleOf(ws) === role);
  }

  send(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      /* socket already gone */
    }
  }

  otherRole(role) {
    return role === "sender" ? "receiver" : "sender";
  }

  // Tell the peer (if any) that the other side is here and it may start the
  // WebRTC handshake. Only the sender offers, so the sender is told when a
  // receiver arrives; a receiver never has to initiate.
  notifyReady(joined) {
    const joinedRole = this.roleOf(joined);
    if (joinedRole === "receiver") {
      const sender = this.socketsWithRole("sender")[0];
      if (sender) this.send(sender, { type: "peer-ready" });
    }
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return text("Expected a WebSocket upgrade\n", 426);
    }

    const url = new URL(request.url);
    const role = url.searchParams.get("role") === "receiver" ? "receiver" : "sender";
    const room = (url.searchParams.get("room") || "").toLowerCase();
    const token = url.searchParams.get("token") || "";

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept just long enough to deliver a structured error, then close.
    const reject = (code, message, reason) => {
      server.serializeAttachment({ role: "rejected", token: null });
      this.ctx.acceptWebSocket(server, ["rejected"]);
      this.send(server, { type: "error", code, message });
      server.close(1013, reason);
      return new Response(null, { status: 101, webSocket: client });
    };

    // Each role has exactly one seat. A reconnect (same token) reclaims its own
    // seat by replacing the stale socket; a different party is turned away.
    const others = this.socketsWithRole(role);
    const conflicts = token
      ? others.filter((ws) => (this.attachment(ws)?.token || "") !== token)
      : others;
    if (conflicts.length) {
      return reject(
        role === "sender" ? "sender-taken" : "receiver-taken",
        role === "sender"
          ? "This session already has a sender."
          : "This session already has a receiver.",
        "role-taken",
      );
    }
    for (const old of others) {
      this.send(old, { type: "error", code: "replaced", message: "Replaced by another connection." });
      try {
        old.close(4000, "replaced by reconnect");
      } catch {
        /* socket already closed */
      }
    }

    server.serializeAttachment({ role, token });
    this.ctx.acceptWebSocket(server, [role]);

    if (role === "sender") {
      this.send(server, { type: "created", room });
      // A receiver already waiting means we can start right away.
      if (this.socketsWithRole("receiver", server).length) {
        this.send(server, { type: "peer-ready" });
      }
    } else {
      this.send(server, { type: "joined", room });
      this.notifyReady(server);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const role = this.roleOf(ws);
    if (role !== "sender" && role !== "receiver") return;
    if (typeof message !== "string" || message.length > MAX_MSG_BYTES) return;

    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return this.send(ws, { type: "error", code: "bad-json", message: "Invalid JSON" });
    }
    if (!msg || typeof msg.type !== "string") return;

    // Only these are relayed, and only to the other seat.
    if (msg.type !== "offer" && msg.type !== "answer" && msg.type !== "candidate") {
      return this.send(ws, { type: "error", code: "unknown-type", message: "Unknown message type" });
    }

    const peer = this.socketsWithRole(this.otherRole(role))[0];
    if (!peer) {
      this.send(ws, { type: "error", code: "no-peer", message: "The other side is not connected." });
      return;
    }
    this.send(peer, { type: msg.type, payload: msg.payload });
  }

  webSocketClose(ws) {
    this.announceGone(ws);
  }

  webSocketError(ws) {
    this.announceGone(ws);
  }

  // Tell the surviving side that a peer vanished. Guarded so close+error for
  // the same socket do not notify twice.
  announceGone(ws) {
    const a = this.attachment(ws);
    if (!a || a.gone) return;
    a.gone = true;
    try {
      ws.serializeAttachment(a);
    } catch {
      /* socket already closed */
    }
    const peer = this.socketsWithRole(this.otherRole(a.role), ws)[0];
    if (peer) this.send(peer, { type: "peer-left" });
  }
}
