export const SIGNALING_URL = typeof window !== "undefined" && window.location.hostname === "share.puhl.dev" 
  ? "wss://api-share.puhl.dev/ws" 
  : "ws://localhost:3000/ws";

export type SignalMessage = {
  type: string;
  id?: string;
  to?: string;
  from?: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export class WebRTCManager {
  public peerConnection: RTCPeerConnection;
  public dataChannel?: RTCDataChannel;
  private ws: WebSocket;
  public myId: string = "";
  
  public onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  public onDataChannelOpen?: () => void;
  public onMessage?: (data: ArrayBuffer | string) => void;
  public onIdAssign?: (id: string) => void;

  constructor(private targetPeerId?: string) {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.targetPeerId) {
        this.sendSignal({
          type: "candidate",
          to: this.targetPeerId,
          candidate: event.candidate,
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      this.onConnectionStateChange?.(this.peerConnection.connectionState);
    };

    if (!targetPeerId) {
      // Sender: Create the data channel
      this.dataChannel = this.peerConnection.createDataChannel("file-transfer");
      this.setupDataChannel();
    } else {
      // Receiver: Wait for the data channel
      this.peerConnection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
    }

    this.ws = new WebSocket(SIGNALING_URL);
    this.ws.onmessage = this.handleSignal.bind(this);
  }

  private setupDataChannel() {
    if (!this.dataChannel) return;
    this.dataChannel.binaryType = "arraybuffer";
    this.dataChannel.onopen = () => this.onDataChannelOpen?.();
    this.dataChannel.onmessage = (event) => {
      this.onMessage?.(event.data);
    };
  }

  private sendSignal(msg: SignalMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.ws.addEventListener("open", () => {
        this.ws.send(JSON.stringify(msg));
      }, { once: true });
    }
  }

  private async handleSignal(event: MessageEvent) {
    const msg: SignalMessage = JSON.parse(event.data);

    if (msg.type === "id" && msg.id) {
      this.myId = msg.id;
      this.onIdAssign?.(this.myId);

      // If we are the receiver, initiate the offer once we get our ID
      if (this.targetPeerId) {
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        this.sendSignal({ type: "offer", to: this.targetPeerId, offer });
      }
    } else if (msg.type === "offer" && msg.offer) {
      this.targetPeerId = msg.from; // Sender learns receiver's ID
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.offer));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      this.sendSignal({ type: "answer", to: this.targetPeerId, answer });
    } else if (msg.type === "answer" && msg.answer) {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.answer));
    } else if (msg.type === "candidate" && msg.candidate) {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
    }
  }

  public send(data: string | ArrayBuffer) {
    if (this.dataChannel?.readyState === "open") {
      this.dataChannel.send(data);
    }
  }
  
  public close() {
    this.dataChannel?.close();
    this.peerConnection.close();
    this.ws.close();
  }
}
