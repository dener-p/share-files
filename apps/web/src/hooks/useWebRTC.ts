import { createEffect, createSignal, onCleanup } from "solid-js";
import { WebRTCManager } from "../lib/webrtc";
import type { PeerState, Phase, ReceivedFile } from "../types/WebRTC-types";

// hooks/useWebRTC.ts
import { PeerManager } from "../lib/peer-maneger.ts";

export function useWebRTC(targetId?: string) {
  const isSender = !targetId;

  const [peers, setPeers] = createSignal<Map<string, PeerState>>(new Map());
  const [receivedFiles, setReceivedFiles] = createSignal<ReceivedFile[]>([]);
  const [myId, setMyId] = createSignal("");

  let ws: WebSocket;
  let peerManager: PeerManager;

  function updatePeer(peerId: string, update: Partial<PeerState>) {
    setPeers((prev) => {
      const next = new Map(prev);
      const current = next.get(peerId) ?? {
        id: peerId,
        phase: "connecting",
        progress: 0,
      };

      next.set(peerId, { ...current, ...update });
      return next;
    });
  }

  createEffect(() => {
    ws = new WebSocket("ws://localhost:3000/ws");

    const sendSignal = (msg: any) => {
      ws.send(JSON.stringify(msg));
    };

    peerManager = new PeerManager(sendSignal, updatePeer, (file) =>
      setReceivedFiles((f) => [...f, file]),
    );
    ws.onopen = () => {
      if (targetId) {
        ws.send(
          JSON.stringify({
            type: "join",
            to: targetId,
          }),
        );
      }
    };

    ws.onmessage = async (raw) => {
      const msg = JSON.parse(raw.data);
      if (msg.type === "id") {
        setMyId(msg.id);
      }

      if (msg.type === "peer-joined") {
        const peer = peerManager.createPeer(msg.from, isSender);

        updatePeer(msg.from, { phase: "peer-joining" });

        if (isSender) {
          peer.createDataChannel();
          const offer = await peer.createOffer();

          ws.send(
            JSON.stringify({
              type: "offer",
              to: msg.from,
              sdp: offer,
            }),
          );
        }
      }

      if (msg.type === "offer") {
        const peer = peerManager.createPeer(msg.from, false);

        const answer = await peer.handleOffer(msg.sdp);

        ws.send(
          JSON.stringify({
            type: "answer",
            to: msg.from,
            sdp: answer,
          }),
        );
      }

      if (msg.type === "answer") {
        const peer = peerManager.get(msg.from);
        await peer?.handleAnswer(msg.sdp);
      }

      if (msg.type === "ice") {
        const peer = peerManager.get(msg.from);
        await peer?.addIce(msg.candidate);
      }
    };

    onCleanup(() => ws.close());
  });

  function sendFileToAll(file: File) {
    for (const [peerId, peer] of peerManager.peers) {
      updatePeer(peerId, { phase: "transferring" });
      peer.sendFile(file, 64 * 1024);
    }
  }

  return {
    peers,
    receivedFiles,
    sendFileToAll,
    myId,
  };
}
