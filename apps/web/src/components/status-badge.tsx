import type { Phase } from "../types/WebRTC-types";

export function StatusBadge(props: { phase: Phase }) {
  const map = {
    connecting: "bg-zinc-700 text-zinc-300",
    "peer-joining": "bg-blue-500/20 text-blue-300",
    transferring: "bg-emerald-500/20 text-emerald-300",
    done: "bg-emerald-600/20 text-emerald-400",
    error: "bg-red-500/20 text-red-300",
    idle: "bg-zinc-800 text-zinc-400",
  };

  return <span class={`text-[10px] px-2 py-1 rounded-md ${map[props.phase]}`}>{props.phase}</span>;
}
