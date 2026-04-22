export type Phase = "idle" | "connecting" | "peer-joining" | "transferring" | "done" | "error";

export type PeerState = {
  id: string;
  phase: Phase;
  progress: number;
};

export interface ReceivedFile {
  name: string;
  size: number;
  url: string;
  peerId: string;
}
