import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import type { ElysiaWS } from "elysia/ws";

const clients = new Map<string, ElysiaWS>();

const app = new Elysia()
  .use(
    cors({
      origin: [/localhost:\d+/, "share.puhl.dev", "https://share.puhl.dev"],
    }),
  )
  .ws("/ws", {
    open(ws) {
      const id = crypto.randomUUID();
      clients.set(id, ws);
      ws.data = { id };
      console.log(`connected at ${id}`);

      ws.send(JSON.stringify({ type: "id", id }));
    },

    message(ws, raw) {
      const msg = JSON.parse(raw.toString());
      const from = ws.data.id;

      console.log({ msg: msg });
      if (msg.to && clients.has(msg.to)) {
        console.log(`message send from ${from} to ${msg.to}`);
        clients.get(msg.to)!.send(
          JSON.stringify({
            ...msg,
            from,
          }),
        );
      }
    },

    close(ws) {
      clients.delete(ws.data.id);
    },
  })
  .listen(3000);

export type app = typeof app;
