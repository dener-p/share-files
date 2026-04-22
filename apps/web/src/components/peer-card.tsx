import type { PeerState } from "../types/WebRTC-types";
import { ProgressBar } from "./progress-bar";
import { StatusBadge } from "./status-badge";

export function PeerCard(props: { peer: PeerState }) {
  return (
    <div class="bg-[#0b1220]/80 border border-[#1b2a3a] rounded-2xl p-4 backdrop-blur-md relative overflow-hidden">
      {/* subtle glow */}
      <div class="absolute inset-0 opacity-10 bg-gradient-to-br from-emerald-500 to-transparent pointer-events-none" />

      <div class="relative">
        <div class="flex justify-between items-center mb-3">
          <p class="text-xs text-zinc-500 truncate">peer {props.peer.id.slice(0, 6)}</p>

          <StatusBadge phase={props.peer.phase} />
        </div>

        <ProgressBar value={props.peer.progress} />

        <p class="text-right text-xs text-zinc-500 mt-2">{props.peer.progress}%</p>
      </div>
    </div>
  );
}
