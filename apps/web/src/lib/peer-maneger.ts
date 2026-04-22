// webrtc/PeerManager.ts
import type { Phase, ReceivedFile } from "../types/WebRTC-types";
import { WebRTCManager } from "./webrtc";

export class PeerManager {
  peers = new Map<string, WebRTCManager>();

  constructor(
    private sendSignal: (msg: any) => void,
    private onPeerUpdate: (
      peerId: string,
      update: Partial<{
        phase: Phase;
        progress: number;
      }>,
    ) => void,
    private onReceive: (file: ReceivedFile) => void,
  ) {}

  createPeer(peerId: string, isSender: boolean) {
    const manager = new WebRTCManager((msg) => this.sendSignal({ ...msg, to: peerId }), isSender);

    manager.onProgress = (p) => {
      this.onPeerUpdate(peerId, { progress: p });
    };

    manager.onReceive = (file) => {
      this.onPeerUpdate(peerId, { phase: "done", progress: 100 });

      this.onReceive({
        name: file.name,
        size: file.size,
        url: URL.createObjectURL(file.blob),
        peerId,
      });
    };

    manager.onOpen = () => {
      this.onPeerUpdate(peerId, { phase: "transferring" });
    };

    this.peers.set(peerId, manager);

    return manager;
  }

  get(peerId: string) {
    return this.peers.get(peerId);
  }

  remove(peerId: string) {
    this.peers.delete(peerId);
  }
}
