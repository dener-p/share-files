import { createFileRoute } from "@tanstack/solid-router";
import { createSignal, onMount, Show, For } from "solid-js";
import Copy from "lucide-solid/icons/copy";
import CloudUpload from "lucide-solid/icons/cloud-upload";
import Download from "lucide-solid/icons/download";
import CircleCheckBig from "lucide-solid/icons/circle-check-big";
import LoaderCircle from "lucide-solid/icons/loader-circle";
import { WebRTCManager } from "../lib/webrtc";
import {
  generateKey,
  exportKey,
  importKey,
  encryptForTransfer,
  decryptFromTransfer,
} from "../lib/crypto";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [mode, setMode] = createSignal<"sender" | "receiver" | null>(null);
  const [status, setStatus] = createSignal("Initializing...");
  const [shareLink, setShareLink] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [webrtc, setWebrtc] = createSignal<WebRTCManager>();
  const [cryptoKey, setCryptoKey] = createSignal<CryptoKey>();
  const [files, setFiles] = createSignal<File[]>([]);
  const [isConnected, setIsConnected] = createSignal(false);

  const CHUNK_SIZE = 64 * 1024; // 64KB

  onMount(async () => {
    const hash = window.location.hash.slice(1);

    if (hash && hash.includes(":")) {
      setMode("receiver");
      const [peerId, keyBase64] = hash.split(":");
      try {
        const key = await importKey(keyBase64);
        setCryptoKey(key);

        setStatus("Connecting to sender...");
        console.log({ hash, peerId, keyBase64 });
        const rtc = new WebRTCManager(peerId);
        setWebrtc(rtc);

        rtc.onConnectionStateChange = (state) => {
          console.log("state", state);
          if (state === "connected") {
            setIsConnected(true);
            setStatus("Connected. Waiting for files...");
          }
        };

        let receivedChunks: Uint8Array[] = [];
        let currentFileMetadata: any = null;
        let bytesReceived = 0;

        rtc.onMessage = async (data) => {
          if (typeof data === "string") {
            const msg = JSON.parse(data);
            if (msg.type === "metadata") {
              currentFileMetadata = msg.file;
              receivedChunks = [];
              bytesReceived = 0;
              setProgress(0);
              setStatus(`Receiving ${msg.file.name}...`);
            } else if (msg.type === "eof") {
              setStatus("Decrypting and saving file...");
              const blob = new Blob(receivedChunks, { type: currentFileMetadata.type });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = currentFileMetadata.name;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              setStatus("File downloaded securely!");
              setProgress(100);
              setTimeout(() => setProgress(0), 3000);
            }
          } else {
            // Binary chunk
            if (currentFileMetadata) {
              const decryptedChunk = await decryptFromTransfer(data, key);
              receivedChunks.push(new Uint8Array(decryptedChunk));
              bytesReceived += decryptedChunk.byteLength;
              setProgress(Math.round((bytesReceived / currentFileMetadata.size) * 100));
            }
          }
        };
      } catch (e) {
        setStatus("Invalid secure link.");
      }
    } else {
      setMode("sender");
      const key = await generateKey();
      setCryptoKey(key);
      const keyBase64 = await exportKey(key);

      setStatus("Generating secure link...");
      const rtc = new WebRTCManager();
      setWebrtc(rtc);

      rtc.onIdAssign = (id) => {
        const link = `${window.location.origin}/#${id}:${keyBase64}`;
        setShareLink(link);
        console.log({ id });
        setStatus("Waiting for receiver to connect...");
      };

      rtc.onConnectionStateChange = (state) => {
        if (state === "connected") {
          setIsConnected(true);
          setStatus("Peer connected. Ready to send.");
        }
      };
    }
  });

  const handleCopy = () => {
    navigator.clipboard.writeText(shareLink());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFileSelect = (e: any) => {
    const selected = e.target.files;
    if (selected && selected.length > 0) {
      setFiles(Array.from(selected));
    }
  };

  const sendFiles = async () => {
    const rtc = webrtc();
    const key = cryptoKey();
    if (!rtc || !key || files().length === 0) return;

    for (const file of files()) {
      setStatus(`Sending ${file.name}...`);
      setProgress(0);

      rtc.send(
        JSON.stringify({
          type: "metadata",
          file: { name: file.name, size: file.size, type: file.type },
        }),
      );

      let offset = 0;
      while (offset < file.size) {
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const arrayBuffer = await slice.arrayBuffer();
        const encrypted = await encryptForTransfer(arrayBuffer, key);

        if (rtc.dataChannel && rtc.dataChannel.bufferedAmount > 1024 * 1024 * 5) {
          await new Promise((resolve) => {
            const check = () => {
              if (rtc.dataChannel && rtc.dataChannel.bufferedAmount < 1024 * 1024 * 2) {
                resolve(null);
              } else {
                setTimeout(check, 100);
              }
            };
            check();
          });
        }

        rtc.send(encrypted);
        offset += slice.size;
        setProgress(Math.round((offset / file.size) * 100));
      }

      rtc.send(JSON.stringify({ type: "eof" }));
    }
    setStatus("All files sent securely!");
  };

  return (
    <div class="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 selection:bg-emerald-500/30 font-sans">
      <div class="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
        {/* Glow effect */}
        <div class="absolute -top-32 -left-32 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div class="absolute -bottom-32 -right-32 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div class="relative z-10">
          <div class="flex flex-col items-center mb-8">
            <div class="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mb-4 shadow-inner shadow-black/50 border border-slate-700">
              <Show
                when={mode() === "receiver"}
                fallback={<CloudUpload class="w-8 h-8 text-emerald-400" />}
              >
                <Download class="w-8 h-8 text-emerald-400" />
              </Show>
            </div>
            <h1 class="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 to-indigo-400 bg-clip-text text-transparent">
              Share Files
            </h1>
            <p class="text-slate-400 mt-2 text-center text-sm font-medium">
              End-to-end encrypted peer-to-peer file transfer.
            </p>
          </div>

          <div class="bg-slate-950/50 p-6 rounded-2xl border border-slate-800/80 mb-6 backdrop-blur-sm">
            <div class="flex items-center space-x-3 mb-2">
              <Show when={progress() === 0 && !isConnected()}>
                <LoaderCircle class="w-5 h-5 text-emerald-400 animate-spin" />
              </Show>
              <Show when={isConnected() && progress() === 0}>
                <CircleCheckBig class="w-5 h-5 text-emerald-400" />
              </Show>
              <span class="font-medium text-slate-300">{status()}</span>
            </div>

            <Show when={progress() > 0 && progress() < 100}>
              <div class="w-full bg-slate-800 rounded-full h-2 mt-4 overflow-hidden">
                <div
                  class="bg-emerald-500 h-2 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress()}%` }}
                ></div>
              </div>
              <div class="mt-2 text-right text-xs text-slate-400 font-mono">{progress()}%</div>
            </Show>
          </div>

          <Show when={mode() === "sender"}>
            <div class="space-y-6">
              <div class="flex flex-col space-y-2">
                <label class="text-sm font-semibold text-slate-300 ml-1">Secure Share Link</label>
                <div class="flex items-center space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={shareLink()}
                    class="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                  <button
                    onClick={handleCopy}
                    class="bg-slate-800 hover:bg-slate-700 text-slate-200 p-3 rounded-xl transition-colors border border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  >
                    <Show when={copied()} fallback={<Copy class="w-5 h-5" />}>
                      <CircleCheckBig class="w-5 h-5 text-emerald-400" />
                    </Show>
                  </button>
                </div>
              </div>

              <div class="pt-4 border-t border-slate-800/50">
                <input
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  class="hidden"
                  id="file-upload"
                />
                <label
                  for="file-upload"
                  class="flex items-center justify-center w-full bg-slate-800/50 hover:bg-slate-800 border-2 border-dashed border-slate-700 hover:border-emerald-500/50 rounded-2xl py-8 cursor-pointer transition-all group"
                >
                  <div class="flex flex-col items-center space-y-3">
                    <CloudUpload class="w-8 h-8 text-slate-400 group-hover:text-emerald-400 transition-colors" />
                    <span class="text-slate-300 font-medium">Select files to send</span>
                  </div>
                </label>
              </div>

              <Show when={files().length > 0}>
                <div class="bg-slate-950/30 rounded-xl p-4 border border-slate-800/50">
                  <h3 class="text-sm font-semibold text-slate-300 mb-3 flex items-center justify-between">
                    <span>Selected Files ({files().length})</span>
                  </h3>
                  <div class="space-y-2 max-h-32 overflow-y-auto pr-2">
                    <For each={files()}>
                      {(file) => (
                        <div class="flex items-center justify-between text-sm py-1">
                          <span class="text-slate-400 truncate max-w-[200px]">{file.name}</span>
                          <span class="text-slate-500 text-xs font-mono">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </span>
                        </div>
                      )}
                    </For>
                  </div>

                  <button
                    onClick={sendFiles}
                    disabled={!isConnected()}
                    class={`mt-4 w-full py-3 rounded-xl font-bold flex items-center justify-center space-x-2 transition-all shadow-lg ${isConnected()
                        ? "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20"
                        : "bg-slate-800 text-slate-500 cursor-not-allowed"
                      }`}
                  >
                    <span>Send Files</span>
                  </button>
                </div>
              </Show>
            </div>
          </Show>

          <Show when={mode() === "receiver"}>
            <div class="flex flex-col items-center justify-center py-8">
              <Show
                when={!isConnected()}
                fallback={<Download class="w-16 h-16 text-emerald-500/50 animate-bounce mb-6" />}
              >
                <div class="w-16 h-16 rounded-full border-4 border-slate-800 border-t-emerald-500 animate-spin mb-6"></div>
              </Show>
              <p class="text-slate-400 text-center max-w-xs text-sm">
                <Show
                  when={isConnected()}
                  fallback="Keep this tab open. Waiting for the sender to connect..."
                >
                  Keep this tab open. The download will start automatically once the sender
                  initiates the transfer.
                </Show>
              </p>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
