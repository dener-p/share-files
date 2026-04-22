export class WebRTCManager {
  pc: RTCPeerConnection;
  dc?: RTCDataChannel;

  onProgress?: (p: number) => void;
  onReceive?: (file: { name: string; size: number; blob: Blob }) => void;
  onOpen?: () => void;

  private chunks: ArrayBuffer[] = [];
  private meta: { name: string; size: number } | null = null;
  private received = 0;

  constructor(
    private sendSignal: (msg: any) => void,
    private isSender: boolean,
  ) {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal({ type: "ice", candidate: e.candidate });
      }
    };

    if (!isSender) {
      this.pc.ondatachannel = (e) => this.setupReceiver(e.channel);
    }
  }

  // ── sender ─────────────────────────
  createDataChannel() {
    this.dc = this.pc.createDataChannel("file");
    this.dc.binaryType = "arraybuffer";

    this.dc.onopen = () => this.onOpen?.();
  }

  async sendFile(file: File, chunkSize: number) {
    if (!this.dc) throw new Error("No data channel");

    this.dc.send(JSON.stringify({ name: file.name, size: file.size }));

    let offset = 0;
    const reader = new FileReader();

    const sendNext = () => {
      const slice = file.slice(offset, offset + chunkSize);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      this.dc!.send(buffer);

      offset += buffer.byteLength;
      this.onProgress?.(Math.round((offset / file.size) * 100));

      if (offset < file.size) {
        if (this.dc!.bufferedAmount > chunkSize * 8) {
          setTimeout(sendNext, 50);
        } else {
          sendNext();
        }
      }
    };

    sendNext();
  }

  // ── receiver ───────────────────────
  private setupReceiver(channel: RTCDataChannel) {
    this.dc = channel;
    this.dc.binaryType = "arraybuffer";

    this.dc.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        this.meta = JSON.parse(ev.data);
        return;
      }

      this.chunks.push(ev.data);
      this.received += ev.data.byteLength;

      if (this.meta) {
        this.onProgress?.(Math.round((this.received / this.meta.size) * 100));

        if (this.received >= this.meta.size) {
          const blob = new Blob(this.chunks);
          this.onReceive?.({
            name: this.meta.name,
            size: this.meta.size,
            blob,
          });
        }
      }
    };
  }

  // ── signaling ──────────────────────
  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async addIce(candidate: RTCIceCandidateInit) {
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}
