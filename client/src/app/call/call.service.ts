import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { RoomPlayer, RoomView, Session } from '../core/models';
import { RoomStore } from '../core/room.store';
import { SocketService } from '../core/socket.service';
import { UiService } from '../core/ui.service';

// Browsers send video straight to each other (WebRTC); the server only passes the setup messages along.
// Everyone in the call links to everyone else, which suits a table of up to 6.

const VIDEO_CONSTRAINTS: MediaTrackConstraints = { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 20 }, facingMode: 'user' };
const VOICE_LEVEL = 0.035; // loudness (RMS, 0..1) that counts as talking rather than background noise
const VOICE_HOLD_MS = 350; // keep the glow through the short gaps between words
const VOICE_POLL_MS = 120;

interface SignalData {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  session?: string;
  target?: string;
}

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  session: string | null | undefined;
  stream: MediaStream | null;
  audio: HTMLAudioElement | null;
  /** incoming messages, handled one at a time */
  queue: Promise<void>;
  /** network candidates that arrived before the offer or answer */
  candidates: RTCIceCandidateInit[];
}

interface Voice {
  track: MediaStreamTrack;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  lastLoud: number;
}

const newSession = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The video call: local camera and microphone, the peer connections, remote audio and who is speaking. */
@Injectable({ providedIn: 'root' })
export class CallService {
  private readonly store = inject(RoomStore);
  private readonly sockets = inject(SocketService);
  private readonly ui = inject(UiService);

  /** This tab is in the call. */
  readonly active = signal(false);
  readonly joining = signal(false);
  readonly mic = signal(false);
  readonly cam = signal(false);
  /** Ids of the players who are talking right now. */
  readonly speaking = signal<ReadonlySet<string>>(new Set());
  /** Bumped whenever anything about the call changes (who has video, who is muted, who is speaking). */
  readonly revision = signal(0);

  private confirmed = false; // the server has our current session
  private session: string | null = null; // new on every join, so the others know to make fresh links
  private stream: MediaStream | null = null; // our camera and microphone
  private iceServers: RTCIceServer[] | null = null;
  private announced: string | null = null; // the media state last sent to the server
  private mediaKey = '';

  private readonly peers = new Map<string, Peer>();
  /** One <video> per place a player's picture is drawn (a lobby seat, a chip, a video box): the same stream can play in several. */
  private readonly videoEls = new WeakMap<HTMLElement, HTMLVideoElement>();
  private readonly voices = new Map<string, Voice>();
  private audioCtx: AudioContext | null = null;
  private voiceTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    const onSignal = (payload: { from: string; data: SignalData }) => this.onSignal(payload);
    const onForceMute = (payload: { by?: string }) => this.onForceMute(payload);
    this.sockets.socket.on('rtc_signal', onSignal);
    this.sockets.socket.on('force_mute', onForceMute);

    // Runs after every state update (and when you leave the room): brings the links in line with who is in the call.
    effect(() => {
      const view = this.store.view();
      const session = this.store.session();
      untracked(() => {
        this.sync(view, session);
        this.noteMediaChanges(view);
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.sockets.socket.off('rtc_signal', onSignal);
      this.sockets.socket.off('force_mute', onForceMute);
      this.teardown();
    });
  }

  // ---------- joining and leaving ----------

  async join(): Promise<void> {
    if (this.active() || this.joining()) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      this.ui.toast(window.isSecureContext ? 'This browser does not support video calls.' : 'Video calls need a secure (https) address.');
      return;
    }
    this.joining.set(true);
    try {
      if (!this.iceServers) {
        const config = await this.store.request<{ iceServers?: RTCIceServer[] }>('rtc_config');
        this.iceServers = config?.iceServers ?? [];
      }
      const stream = await getLocalStream();
      const view = this.store.view();
      if (!view || !this.store.session()) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      // A camera or microphone can stop mid-call (unplugged, or taken by another app).
      for (const track of stream?.getTracks() ?? []) track.addEventListener('ended', () => this.deviceStopped(track));
      // You join with your camera and microphone off; turn them on with the buttons when you're ready.
      for (const track of stream?.getTracks() ?? []) track.enabled = false;
      this.mic.set(false);
      this.cam.set(false);
      if (!stream) this.ui.toast('Camera and microphone are blocked. You can still see and hear the others.');
      else this.ui.toast(stream.getVideoTracks().length
        ? 'You joined with your camera and microphone off. Turn them on with the buttons at the top.'
        : 'No camera found. You joined with your microphone off.');
      this.active.set(true);
      this.confirmed = false;
      this.session = newSession();
      if (stream?.getAudioTracks().length) this.watchVoice(view.youId, stream);
      this.announceMedia();
    } finally {
      this.joining.set(false);
      this.touch();
    }
  }

  leave(): void {
    this.teardown();
    if (this.store.session()) this.announceMedia();
    else this.announced = null;
    this.touch();
  }

  /** Closes every link and releases the camera, microphone, audio meters and video elements. */
  private teardown(): void {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    for (const id of [...this.voices.keys()]) this.stopWatchingVoice(id);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.confirmed = false;
    this.session = null;
    this.active.set(false);
    this.mic.set(false);
    this.cam.set(false);
    this.removeVideos();
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.speaking.set(new Set());
    // Avatars drawn while in the call lose their video and call classes.
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.in-call:not(.vtile)'))) {
      el.classList.remove('in-call', 'speaking', 'has-video');
      el.querySelectorAll(':scope > .mic-off').forEach((n) => n.remove());
    }
  }

  /** Takes the video elements of one player (or all) out of the page and lets go of their streams. */
  private removeVideos(playerId?: string): void {
    const selector = playerId ? `video.av-video[data-for="${playerId}"]` : 'video.av-video';
    for (const video of Array.from(document.querySelectorAll<HTMLVideoElement>(selector))) {
      video.srcObject = null;
      video.remove();
    }
  }

  private deviceStopped(track: MediaStreamTrack): void {
    if (!this.active() || this.stream?.getTracks().every((t) => t !== track)) return;
    if (track.kind === 'video') this.cam.set(false);
    else this.mic.set(false);
    this.ui.toast(track.kind === 'video' ? 'Your camera stopped.' : 'Your microphone stopped.');
    this.announceMedia();
    this.touch();
  }

  private announceMedia(): void {
    const media = this.active() ? { joined: true, mic: this.mic(), cam: this.cam(), session: this.session } : { joined: false };
    const key = JSON.stringify(media);
    if (key === this.announced) return;
    this.announced = key;
    void this.store.request('set_media', { media });
  }

  toggle(kind: 'audio' | 'video'): void {
    const all = kind === 'audio' ? this.stream?.getAudioTracks() : this.stream?.getVideoTracks();
    const tracks = all?.filter((t) => t.readyState === 'live');
    if (!tracks?.length) {
      this.ui.toast(kind === 'audio' ? 'No microphone available.' : 'No camera available.');
      return;
    }
    const flag = kind === 'audio' ? this.mic : this.cam;
    const on = !flag();
    flag.set(on);
    for (const track of tracks) track.enabled = on;
    this.announceMedia();
    this.touch();
  }

  /** The host asks everyone else in the call to mute. */
  muteAll(): void {
    void this.store.action('mute_all');
  }

  /** The host muted everyone: switch our microphone off (we can turn it back on). */
  private onForceMute({ by }: { by?: string }): void {
    if (!this.active()) return;
    if (this.mic()) {
      this.mic.set(false);
      for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = false;
      this.announceMedia();
    }
    this.ui.toast(`🔇 ${by ?? 'The host'} muted everyone. Click the microphone to unmute.`);
    this.touch();
  }

  // ---------- keeping the links in line with the room ----------

  private touch(): void {
    this.revision.update((n) => n + 1);
  }

  /** Who is in the call, and how: when it changes, redraw the videos and avatars. */
  private noteMediaChanges(view: RoomView | null): void {
    const key = JSON.stringify(view?.players.map((p) => [p.id, p.connected, p.media.joined, p.media.mic, p.media.cam, p.media.session]) ?? []);
    if (key === this.mediaKey) return;
    this.mediaKey = key;
    this.touch();
  }

  private sync(view: RoomView | null, session: Session | null): void {
    if (!view || !session) {
      if (this.active()) this.leave();
      return;
    }
    if (!this.active()) return;
    const me = view.players.find((p) => p.id === view.youId);
    if (me?.media.session === this.session) {
      this.confirmed = true;
    } else if (this.confirmed) {
      // The server dropped us from the call (our connection was replaced): rejoin with fresh links.
      for (const id of [...this.peers.keys()]) this.closePeer(id);
      this.session = newSession();
      this.confirmed = false;
      this.announceMedia();
      return;
    }
    if (!this.confirmed) return;
    const present = new Set<string>();
    for (const player of view.players) {
      if (player.id === view.youId || !player.connected || !player.media.joined) continue;
      present.add(player.id);
      const peer = this.peers.get(player.id);
      if (peer?.session === player.media.session) continue;
      if (peer) this.closePeer(player.id);
      // Of each pair, the player with the smaller id starts the link; the other answers its offer.
      // Both are in the call by then, so the offer is never sent to a page that is not ready for it.
      if (view.youId < player.id) this.createPeer(player.id, player.media.session);
    }
    for (const id of [...this.peers.keys()]) if (!present.has(id)) this.closePeer(id);
  }

  // ---------- peer connections ----------

  private sendSignal(to: string, data: Record<string, unknown>): void {
    this.sockets.emit('rtc_signal', { to, data: { ...data, session: this.session, target: this.peers.get(to)?.session } });
  }

  private createPeer(id: string, remoteSession: string | null | undefined): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers ?? [] });
    // "Perfect negotiation": both sides may offer; on a clash the polite one gives way.
    const peer: Peer = {
      pc,
      polite: this.store.youId() > id,
      makingOffer: false,
      ignoreOffer: false,
      session: remoteSession,
      stream: null,
      audio: null,
      queue: Promise.resolve(),
      candidates: [],
    };
    this.peers.set(id, peer);

    const tracks = this.stream?.getTracks() ?? [];
    for (const track of tracks) pc.addTrack(track, this.stream!);
    // Still receive the other person's sound and picture when we send none of our own.
    if (!tracks.some((t) => t.kind === 'audio')) pc.addTransceiver('audio', { direction: 'recvonly' });
    if (!tracks.some((t) => t.kind === 'video')) pc.addTransceiver('video', { direction: 'recvonly' });

    pc.ontrack = ({ track, streams }) => {
      if (this.peers.get(id) !== peer) return;
      peer.stream ??= streams[0] ?? new MediaStream();
      if (!peer.stream.getTracks().includes(track)) peer.stream.addTrack(track);
      if (track.kind === 'audio') {
        this.playAudio(peer);
        this.watchVoice(id, peer.stream);
      }
      track.onunmute = () => this.touch();
      this.touch();
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.sendSignal(id, { candidate: candidate.toJSON() });
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.sendSignal(id, { description: pc.localDescription?.toJSON() });
      } catch (err) {
        console.warn('Video offer failed', err);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
      if (pc.connectionState === 'connected' || pc.connectionState === 'failed') this.touch();
    };
    return peer;
  }

  private closePeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.pc.ontrack = null;
    peer.pc.onicecandidate = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    if (peer.audio) {
      peer.audio.srcObject = null;
      peer.audio.remove();
    }
    this.stopWatchingVoice(id);
    this.removeVideos(id);
    this.touch();
  }

  /** Other players' voices play from hidden audio elements that stay put while the table redraws (plain DOM, never Angular's). */
  private playAudio(peer: Peer): void {
    if (!peer.audio) {
      peer.audio = document.createElement('audio');
      peer.audio.autoplay = true;
      document.getElementById('rtc-audio')?.append(peer.audio);
    }
    if (peer.audio.srcObject !== peer.stream) peer.audio.srcObject = peer.stream;
    peer.audio.play().catch(() => {});
  }

  private onSignal({ from, data }: { from: string; data: SignalData }): void {
    // Ignore messages meant for an earlier join of ours.
    if (!this.active() || !data || data.target !== this.session) return;
    let peer = this.peers.get(from);
    if (!peer || peer.session !== data.session) {
      // Their join may reach us here before the room update does.
      if (!this.store.players().some((p) => p.id === from)) return;
      if (peer) this.closePeer(from);
      peer = this.createPeer(from, data.session);
    }
    const target = peer;
    target.queue = target.queue.then(() => this.handleSignal(from, target, data));
  }

  private async handleSignal(from: string, peer: Peer, data: SignalData): Promise<void> {
    const { pc } = peer;
    if (this.peers.get(from) !== peer) return;
    try {
      if (data.description) {
        const clash = data.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && clash;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        for (const candidate of peer.candidates.splice(0)) await pc.addIceCandidate(candidate).catch(() => {});
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          this.sendSignal(from, { description: pc.localDescription?.toJSON() });
        }
      } else if (data.candidate) {
        if (!pc.remoteDescription) {
          peer.candidates.push(data.candidate);
          return;
        }
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          if (!peer.ignoreOffer) console.warn('Video network candidate rejected', err);
        }
      }
    } catch (err) {
      console.warn('Video link problem', err);
    }
  }

  // ---------- video elements ----------

  hasLiveVideo(playerId: string): boolean {
    if (playerId === this.store.youId()) {
      return this.active() && this.cam() && Boolean(this.stream?.getVideoTracks().some((t) => t.readyState === 'live'));
    }
    const player = this.store.players().find((p) => p.id === playerId);
    return Boolean(player?.media.cam && this.liveVideoTrack(playerId));
  }

  private liveVideoTrack(playerId: string): MediaStreamTrack | null {
    return this.peers.get(playerId)?.stream?.getVideoTracks().find((t) => t.readyState === 'live' && !t.muted) ?? null;
  }

  /** The <video> element for a player's picture inside `owner` (an avatar tile or a video box), pointed at their stream. */
  videoFor(playerId: string, owner: HTMLElement): HTMLVideoElement {
    const isMe = playerId === this.store.youId();
    let video = this.videoEls.get(owner);
    if (!video) {
      video = document.createElement('video');
      video.dataset['for'] = playerId;
      video.className = `av-video${isMe ? ' self' : ''}`;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true; // sound comes from the audio elements (and never our own)
      // Fills its box whatever the box is (an avatar tile or a video box).
      video.style.position = 'absolute';
      video.style.inset = '0';
      // No browser picture-in-picture button, cast button or right-click video menu on the faces.
      video.disablePictureInPicture = true;
      video.disableRemotePlayback = true;
      video.setAttribute('disablepictureinpicture', '');
      video.setAttribute('disableremoteplayback', '');
      video.addEventListener('contextmenu', (event) => event.preventDefault());
      this.videoEls.set(owner, video);
    }
    const stream = isMe ? this.stream : this.peers.get(playerId)?.stream ?? null;
    if (video.srcObject !== stream) video.srcObject = stream;
    return video;
  }

  /** Starts a video that was paused by being moved in the page. */
  keepPlaying(video: HTMLVideoElement): void {
    queueMicrotask(() => video.paused && video.play().catch(() => {}));
  }

  /**
   * Puts a player's live video in an avatar tile, with a muted sign when their mic is off.
   *
   * Protocol with the avatar component (which owns the host's own children: the picture or initials):
   *  - the call only ever adds the children `video.av-video` and `span.mic-off` at the END of the host, plus the
   *    classes `in-call`, `speaking` and `has-video`, and takes exactly those away again on every call;
   *  - the video fills the tile (absolutely positioned, opaque), so the avatar's own picture or initials stay in the
   *    DOM underneath, and Angular keeps updating them without ever being disturbed;
   *  - so it is safe to call this again whenever `revision()` or the avatar changes, even if the avatar component
   *    cleared and refilled its content in between: it is idempotent.
   */
  attachVideo(host: HTMLElement, playerId: string): void {
    host.querySelectorAll(':scope > .av-video, :scope > .mic-off').forEach((n) => n.remove());
    const isMe = playerId === this.store.youId();
    const player = this.store.players().find((p) => p.id === playerId);
    const inCall = isMe ? this.active() : player?.media.joined;
    if (!inCall) {
      host.classList.remove('in-call', 'speaking', 'has-video');
      return;
    }
    host.classList.add('in-call');
    host.classList.toggle('speaking', this.speaking().has(playerId));
    const live = this.hasLiveVideo(playerId);
    host.classList.toggle('has-video', live);
    if (live) {
      const video = this.videoFor(playerId, host);
      host.append(video);
      this.keepPlaying(video);
    }
    if (!this.micOn(playerId, player)) {
      const sign = document.createElement('span');
      sign.className = 'mic-off';
      sign.dataset['tip'] = 'Microphone off';
      sign.setAttribute('aria-label', 'Microphone off');
      sign.textContent = '🔇';
      host.append(sign);
    }
  }

  /** Whether that player's microphone is on (for the muted sign). */
  micOn(playerId: string, player?: RoomPlayer): boolean {
    if (playerId === this.store.youId()) return this.mic();
    return Boolean((player ?? this.store.players().find((p) => p.id === playerId))?.media.mic);
  }

  // ---------- who is speaking ----------
  // Each voice in the call (ours included) feeds a level meter; a tile glows while its player talks.

  private watchVoice(playerId: string, stream: MediaStream): void {
    const track = stream.getAudioTracks()[0];
    if (!track || this.voices.get(playerId)?.track === track) return;
    this.stopWatchingVoice(playerId);
    try {
      this.audioCtx ??= new AudioContext();
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(() => {});
      const source = this.audioCtx.createMediaStreamSource(new MediaStream([track]));
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser); // a meter only: nothing is played through it
      this.voices.set(playerId, { track, source, analyser, samples: new Float32Array(analyser.fftSize), lastLoud: 0 });
      this.voiceTimer ??= setInterval(() => this.measureVoices(), VOICE_POLL_MS);
    } catch (err) {
      console.warn('Could not watch a voice level', err);
    }
  }

  private stopWatchingVoice(playerId: string | undefined): void {
    const voice = playerId ? this.voices.get(playerId) : undefined;
    if (!voice || !playerId) return;
    voice.source.disconnect();
    this.voices.delete(playerId);
    this.setSpeaking(playerId, false);
    if (!this.voices.size) {
      clearInterval(this.voiceTimer);
      this.voiceTimer = undefined;
    }
  }

  private measureVoices(): void {
    const now = Date.now();
    for (const [playerId, voice] of this.voices) {
      voice.analyser.getFloatTimeDomainData(voice.samples);
      let sum = 0;
      for (const v of voice.samples) sum += v * v;
      if (Math.sqrt(sum / voice.samples.length) > VOICE_LEVEL && this.micOn(playerId)) voice.lastLoud = now;
      this.setSpeaking(playerId, now - voice.lastLoud < VOICE_HOLD_MS);
    }
  }

  private setSpeaking(playerId: string, on: boolean): void {
    if (this.speaking().has(playerId) === on) return;
    const next = new Set(this.speaking());
    if (on) next.add(playerId);
    else next.delete(playerId);
    this.speaking.set(next);
    this.touch();
  }
}

async function getLocalStream(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: VIDEO_CONSTRAINTS,
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    // No camera, or it is blocked: try the microphone alone, then join just to watch and listen.
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return null;
    }
  }
}
