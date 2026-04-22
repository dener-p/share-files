import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import type { ElysiaWS } from "elysia/ws";

const clients = new Map<string, ElysiaWS>();
type msgType = {
  type: "join";
  to?: string;
};

const app = new Elysia()
  .use(
    cors({
      origin: [/localhost:\d+/, "share.puhl.dev", "https://share.puhl.dev"],
    }),
  )
  .ws("/ws", {
    open(ws) {
      console.log(`connected at ${ws.id}`);
      clients.set(ws.id, ws);
      ws.send(JSON.stringify({ type: "id", id: ws.id }));
    },

    message(ws) {
      const from = ws.id;
      const msg = ws.body as msgType;

      if (msg.type === "join" && msg.to && clients.has(msg.to)) {
        const host = clients.get(msg.to)!;
        host.send(
          JSON.stringify({
            type: "peer-joined",
            from,
          }),
        );
        return;
      }

      if (!msg.to || !clients.has(msg.to)) {
        console.log("no target found for", msg.type, "from", from);
        return;
      }

      const target = clients.get(msg.to)!;
      target.send(
        JSON.stringify({
          ...msg,
          from,
        }),
      );
    },

    close(ws) {
      clients.delete(ws.id);
    },
  })
  .listen(3000);

export type app = typeof app;
