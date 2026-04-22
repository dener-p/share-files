import { createFileRoute } from "@tanstack/solid-router";
import { createSignal, For, Show } from "solid-js";
import { useWebRTC } from "../hooks/useWebRTC";
import { PeerCard } from "../components/peer-card";
import z from "zod/v4";

const params = z.object({ to: z.string().optional() });
export const Route = createFileRoute("/")({
  component: Home,
  validateSearch: params,
});

// ── App ───────────────────────────────────────────────────────────────────────
export default function Home() {
  const search = Route.useSearch();
  const { peers, receivedFiles, sendFileToAll, myId } = useWebRTC(search().to);
  const [file, setFile] = createSignal<File | null>(null);
  const [dragOver, setDragOver] = createSignal(false);
  const isReceiver = () => !!search().to;
  const isSender = () => !search().to;

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files[0];
    if (f) setFile(f);
  }
  const [copied, setCopied] = createSignal(false);

  const shareLink = () => `${window.location.origin}${window.location.pathname}?to=${myId()}`;

  function copyLink() {
    navigator.clipboard.writeText(shareLink()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div class="min-h-screen bg-[#060b12] text-white font-mono flex items-center justify-center p-6">
      <div class="w-full max-w-5xl">
        {/* ── HEADER ── */}
        <div class="mb-10 text-center">
          <div class="flex items-center justify-center gap-3 mb-3">
            <div class="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shadow-lg shadow-emerald-500/10">
              <span class="text-emerald-400 font-bold">P</span>
            </div>
            <h1 class="text-lg tracking-widest text-zinc-400 uppercase">puhl.send</h1>
          </div>

          <p class="text-xs text-zinc-600 tracking-wider">
            peer-to-peer · encrypted · zero storage
          </p>
        </div>

        <Show when={isSender()}>
          {/* ── DROP ZONE ── */}
          <div
            class={`rounded-2xl border transition-all duration-300 mb-8
          ${
            dragOver()
              ? "border-emerald-400 bg-emerald-500/10"
              : "border-[#1b2a3a] bg-[#0b1220]/70 hover:border-emerald-500/40"
          }
          `}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById("file")?.click()}
          >
            <input
              id="file"
              type="file"
              class="hidden"
              onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] || null)}
            />

            <div class="p-12 text-center">
              <Show
                when={file()}
                fallback={
                  <>
                    <div class="text-5xl mb-4 opacity-70">⇡</div>
                    <p class="text-zinc-300 text-sm">Drop file or click to upload</p>
                    <p class="text-zinc-600 text-xs mt-1">any size · direct transfer</p>
                  </>
                }
              >
                <div class="text-4xl mb-3">📄</div>
                <p class="text-zinc-200 text-sm truncate">{file()!.name}</p>
                <p class="text-zinc-500 text-xs mt-1">
                  {(file()!.size / 1024 / 1024).toFixed(2)} MB
                </p>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    sendFileToAll(file()!);
                  }}
                  class="mt-5 px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm transition shadow-lg shadow-emerald-500/20"
                >
                  send to peers
                </button>
              </Show>
            </div>
          </div>
        </Show>
        <Show when={isSender() && myId()}>
          <div class="mb-8 rounded-2xl border border-[#1b2a3a] bg-[#0b1220]/70 p-5">
            <p class="text-xs text-zinc-600 uppercase tracking-widest mb-3">share link</p>

            <div class="flex gap-2">
              <div class="flex-1 bg-[#060b12] border border-[#1b2a3a] rounded-lg px-3 py-2 text-xs text-zinc-400 truncate">
                {shareLink()}
              </div>

              <button
                onClick={copyLink}
                class={`px-4 py-2 rounded-lg text-xs font-medium transition-all
        ${
          copied()
            ? "bg-emerald-600 text-white shadow-lg shadow-emerald-500/20"
            : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
        }`}
              >
                {copied() ? "✓ copied" : "copy"}
              </button>
            </div>

            <p class="text-xs text-zinc-600 mt-3 text-center">
              send this link to anyone to join the transfer
            </p>
          </div>
        </Show>
        {/* ── PEERS GRID ── */}
        <Show when={isSender() && peers().size > 0}>
          <div class="grid md:grid-cols-2 gap-4 mb-8">
            <For each={[...peers().values()]}>{(peer) => <PeerCard peer={peer} />}</For>
          </div>
        </Show>
        <Show when={isReceiver()}>
          <div class="mb-8 rounded-2xl border border-[#1b2a3a] bg-[#0b1220]/70 p-10 text-center">
            <div class="text-4xl mb-4">🔗</div>
            <p class="text-zinc-300 text-sm">connected to sender</p>
            <p class="text-zinc-600 text-xs mt-1">waiting for file...</p>
          </div>
        </Show>
        {/* ── RECEIVED FILES ── */}
        <Show when={receivedFiles().length > 0}>
          <div class="space-y-3">
            <p class="text-xs text-zinc-600 uppercase tracking-widest">received</p>

            <For each={receivedFiles()}>
              {(file) => (
                <div class="flex items-center justify-between bg-[#0b1220] border border-[#1b2a3a] rounded-xl px-4 py-3">
                  <div>
                    <p class="text-sm text-zinc-200">{file.name}</p>
                    <p class="text-xs text-zinc-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>

                  <a
                    href={file.url}
                    download={file.name}
                    class="text-emerald-400 text-sm hover:underline"
                  >
                    download
                  </a>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
