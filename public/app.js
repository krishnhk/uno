(() => {
  'use strict';

  const socket = io();
  const $ = (id) => document.getElementById(id);

  const COLOR_LABEL = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' };
  const VALUE_LABEL = { skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four' };
  const FACE = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: 'W', wild4: '+4' };
  const COLOR_ORDER = ['red', 'yellow', 'green', 'blue', 'wild'];
  const VALUE_ORDER = ['skip', 'reverse', 'draw2', 'wild', 'wild4'];
  const TRAIL_LENGTH = 5;
  const MODE_LABEL = { last: 'Play till the end', first: 'First out wins' };
  const MEDALS = ['🥇', '🥈', '🥉'];

  let view = null;             // latest room view pushed by the server
  let session = loadSession(); // { code, name, token } for this tab
  let pendingWildId = null;    // wild card waiting for a color choice
  let trail = [];              // last few discards, drawn as a messy pile
  let trailRound = null;
  let lastAnnouncement = '';
  let chatSeenAt = Date.now(); // chat messages after this count as unread while the drawer is closed
  let wasPlaying = false;      // used to pop up the results when a game ends

  // ---------- small helpers ----------

  /** Builds a DOM element. Text is always set as text, never as HTML. */
  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props ?? {})) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...children.filter((c) => c != null && c !== false));
    return node;
  }

  function loadSession() {
    try {
      return JSON.parse(sessionStorage.getItem('uno.session'));
    } catch {
      return null;
    }
  }

  function saveSession(next) {
    session = next;
    try {
      sessionStorage.setItem('uno.session', JSON.stringify(next));
    } catch {
      // Storage can be unavailable (private mode). The game still works in this tab.
    }
  }

  function clearSession() {
    session = null;
    try {
      sessionStorage.removeItem('uno.session');
    } catch {
      // Nothing to clean up.
    }
  }

  let toastTimer;
  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (node.hidden = true), 3500);
  }

  function request(event, payload = {}) {
    return new Promise((resolve) => {
      socket.emit(event, payload, (res) => {
        if (!res?.ok) {
          toast(res?.error ?? 'No response from the server');
          resolve(null);
          return;
        }
        resolve(res);
      });
    });
  }

  const action = (event, payload) => request(event, payload);

  const rank = (card) => (/^\d$/.test(card.value) ? Number(card.value) : 10 + VALUE_ORDER.indexOf(card.value));
  const compareCards = (a, b) => COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color) || rank(a) - rank(b);

  function describe(card) {
    return card.color === 'wild' ? VALUE_LABEL[card.value] : `${COLOR_LABEL[card.color]} ${VALUE_LABEL[card.value] ?? card.value}`;
  }

  function hashString(text) {
    let hash = 0;
    for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return hash;
  }

  // Every avatar sits on the same UNO-red background; only the character or initials differ.
  const AVATAR_BACKGROUND = 'radial-gradient(circle at 35% 30%, #ff5a4f 0%, #e2202f 45%, #9e0f19 100%)';

  function initials(name) {
    const words = name.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w[0] ?? ''));
    return (words.map((w) => w[0]).join('').slice(0, 2) || name.slice(0, 1)).toUpperCase();
  }

  // Avatar choices. Keep in sync with AVATAR_IMAGES in src/rooms.js.
  // Character pictures (public/avatars/<id>.webp), grouped by series for the picker.
  const AVATAR_CHARACTERS = [
    ['One Piece', [['luffy', 'Luffy'], ['zoro', 'Zoro'], ['nami', 'Nami'], ['usopp', 'Usopp'], ['sanji', 'Sanji'],
      ['chopper', 'Tony Tony Chopper'], ['robin', 'Robin']]],
    ['Naruto', [['naruto', 'Naruto'], ['sasuke', 'Sasuke'], ['sakura', 'Sakura'], ['kakashi', 'Kakashi'], ['hinata', 'Hinata'],
      ['jiraiya', 'Jiraiya'], ['tsunade', 'Tsunade']]],
    ['Attack on Titan', [['eren', 'Eren'], ['mikasa', 'Mikasa'], ['armin', 'Armin'], ['levi', 'Levi'], ['hange', 'Hange'],
      ['erwin', 'Erwin'], ['sasha', 'Sasha']]],
    ['My Hero Academia', [['deku', 'Deku'], ['uraraka', 'Uraraka'], ['bakugo', 'Bakugo'], ['todoroki', 'Todoroki'], ['tsuyu', 'Tsuyu'],
      ['momo', 'Momo'], ['all-might', 'All Might']]],
    ['Jackie Chan Adventures', [['jackie', 'Jackie'], ['jade', 'Jade'], ['uncle', 'Uncle'], ['tohru', 'Tohru'], ['viper', 'Viper'],
      ['el-toro', 'El Toro Fuerte'], ['captain-black', 'Captain Black']]],
  ];
  const AVATAR_IMAGES = AVATAR_CHARACTERS.flatMap(([, list]) => list.map(([id]) => id));
  const avatarImageUrl = (id) => `avatars/${id}.webp`;

  /** What to draw for an avatar: the chosen character picture, or initials, on the shared background. */
  function avatarLook(name, avatar) {
    const image = AVATAR_IMAGES.includes(avatar?.image) ? avatar.image : null;
    return { text: image ? '' : initials(name), image, background: AVATAR_BACKGROUND };
  }

  /** Puts an avatar's face (picture or text) into an element and marks which kind it is. */
  function fillAvatar(el, look, fallbackText = look.text) {
    el.replaceChildren(look.image
      ? h('img', { class: 'avatar-img', src: avatarImageUrl(look.image), alt: '', draggable: false })
      : fallbackText);
    el.classList.toggle('has-image', Boolean(look.image));
  }

  const avatarOf = (playerId) => view?.players.find((p) => p.id === playerId)?.avatar ?? null;

  /** An avatar tile. Your own one is a button that opens the avatar picker. */
  function avatarEl(className, name, avatar, { editable = false } = {}) {
    const look = avatarLook(name, avatar);
    const classes = `${className}${editable ? ' avatar-button' : ''}`;
    const style = `background:${look.background}`;
    const el = editable
      ? h('button', { type: 'button', class: classes, style, 'data-tip': 'Change your avatar', 'aria-label': 'Change your avatar', onclick: openAvatarPicker })
      : h('div', { class: classes, style });
    fillAvatar(el, look);
    if (editable) el.append(h('span', { class: 'avatar-edit', 'aria-hidden': 'true' }, '✎'));
    return el;
  }

  function ordinal(n) {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
  }

  const placeLabel = (place) => `${MEDALS[place - 1] ?? ''} ${ordinal(place)}`.trim();

  function listNames(names) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  /** Other players in turn order, starting with the one after you. */
  function aroundMe(list) {
    const i = list.findIndex((p) => p.id === view.youId);
    return i <= 0 ? list : [...list.slice(i), ...list.slice(0, i)];
  }

  // ---------- home screen ----------

  const nameInput = $('name');
  try {
    nameInput.value = localStorage.getItem('uno.name') ?? '';
  } catch {
    // Name is simply not remembered.
  }

  // ---------- your avatar ----------

  let myAvatar = loadAvatar();

  function loadAvatar() {
    try {
      const saved = JSON.parse(localStorage.getItem('uno.avatar'));
      return { image: AVATAR_IMAGES.includes(saved?.image) ? saved.image : null };
    } catch {
      return { image: null };
    }
  }

  function saveAvatar() {
    try {
      localStorage.setItem('uno.avatar', JSON.stringify(myAvatar));
    } catch {
      // Not remembered between visits.
    }
  }

  /** Your name as others see it: from the room once you have joined, otherwise from the name box. */
  function currentName() {
    const inRoom = view?.players.find((p) => p.id === view.youId);
    return inRoom?.name ?? nameInput.value.trim();
  }

  // Live preview of your avatar on the home screen while you type your name.
  function updateNameAvatar() {
    const name = nameInput.value.trim();
    const look = avatarLook(name || '?', myAvatar);
    const chosen = name || myAvatar.image;
    fillAvatar($('name-avatar-face'), look, chosen ? look.text : '?');
    $('name-avatar').style.background = chosen ? look.background : '';
    $('name-avatar').classList.toggle('has-image', Boolean(look.image));
  }
  nameInput.addEventListener('input', updateNameAvatar);
  updateNameAvatar();

  function openAvatarPicker() {
    renderAvatarPicker();
    $('avatar-dialog').hidden = false;
  }

  function closeAvatarPicker() {
    if ($('avatar-dialog').hidden) return;
    $('avatar-dialog').hidden = true;
    // Already in a room: let everyone else see the new avatar.
    if (view && session) action('set_avatar', { avatar: myAvatar });
  }

  function pickAvatar(change) {
    myAvatar = { image: null, ...change };
    saveAvatar();
    updateNameAvatar();
    showAvatarSelection();
  }

  /** Builds the picker's options once per opening (the initials option depends on your name). */
  function renderAvatarPicker() {
    const name = currentName() || 'You';
    $('avatar-title').textContent = name;


    $('avatar-images').replaceChildren(...AVATAR_CHARACTERS.flatMap(([series, list]) => [
      h('h4', { class: 'avatar-series' }, series),
      h('div', { class: 'avatar-grid' }, ...list.map(([id, label]) => h('button', {
        type: 'button',
        role: 'radio',
        class: 'avatar-option picture',
        'data-image': id,
        'aria-label': label,
        'data-tip': label,
        onclick: () => pickAvatar({ image: id }),
      }, h('img', { src: avatarImageUrl(id), alt: '', loading: 'lazy', draggable: false })))),
    ]));

    showAvatarSelection();
  }

  /** Updates the preview and which options are ticked, without rebuilding (keeps focus and hover). */
  function showAvatarSelection() {
    const look = avatarLook(currentName() || 'You', myAvatar);
    const preview = $('avatar-preview');
    fillAvatar(preview, look);
    preview.style.background = look.background;
    for (const option of $('avatar-images').querySelectorAll('[data-image]')) {
      option.setAttribute('aria-checked', String(option.dataset.image === myAvatar.image));
    }
  }

  $('name-avatar').addEventListener('click', openAvatarPicker);
  $('avatar-done').addEventListener('click', closeAvatarPicker);
  // Clicking outside the window or pressing Escape also closes it.
  $('avatar-dialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeAvatarPicker();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAvatarPicker();
  });

  const codeInput = $('join-form').code;
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  function myName() {
    const name = nameInput.value.trim();
    if (!name) {
      toast('Enter your name first');
      return null;
    }
    try {
      localStorage.setItem('uno.name', name);
    } catch {
      // Not remembered between visits.
    }
    return name;
  }

  async function enterRoom(code, name, token) {
    const res = await request('join_room', { code, name, token, avatar: myAvatar });
    if (!res) return false;
    saveSession({ code: res.code, name, token: res.token });
    render();
    return true;
  }

  $('create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = myName();
    if (!name) return;
    const res = await request('create_room', { name, settings: readSettings(event.currentTarget), avatar: myAvatar });
    if (res) {
      saveSession({ code: res.code, name, token: res.token });
      render();
    }
  });

  $('join-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = myName();
    if (!name) return;
    enterRoom(event.currentTarget.code.value.trim().toUpperCase(), name);
  });

  // ---------- tooltips ----------

  // Anything with a data-tip attribute gets the styled tooltip instead of the browser's plain one.
  const TIP_DELAY_MS = 250;
  const TIP_GAP = 10;
  const tipEl = $('tip');
  let tipTarget = null;
  let tipTimer = 0;

  function showTip(target) {
    const text = target.dataset.tip;
    if (!text || !target.isConnected) return;
    tipEl.textContent = text;

    // Measure, then place above the target, or below it when there is no room above.
    const box = target.getBoundingClientRect();
    const width = tipEl.offsetWidth;
    const height = tipEl.offsetHeight;
    let side = 'top';
    let top = box.top - height - TIP_GAP;
    if (top < 8) {
      side = 'bottom';
      top = box.bottom + TIP_GAP;
    }
    const centre = box.left + box.width / 2;
    const left = Math.min(Math.max(8, centre - width / 2), window.innerWidth - width - 8);

    tipEl.dataset.side = side;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
    tipEl.style.setProperty('--arrow-x', `${centre - left}px`);
    tipEl.classList.add('show');
  }

  function hideTip() {
    clearTimeout(tipTimer);
    tipTarget = null;
    tipEl.classList.remove('show');
  }

  document.addEventListener('pointerover', (event) => {
    const target = event.target.closest?.('[data-tip]');
    if (target === tipTarget) return;
    hideTip();
    if (!target || event.pointerType === 'touch') return;
    tipTarget = target;
    tipTimer = setTimeout(() => showTip(target), TIP_DELAY_MS);
  });
  document.addEventListener('pointerout', (event) => {
    if (tipTarget && !tipTarget.contains(event.relatedTarget)) hideTip();
  });
  // Keyboard users see the tooltip when they tab onto something.
  document.addEventListener('focusin', (event) => {
    const target = event.target.closest?.('[data-tip]');
    if (!target || !target.matches(':focus-visible')) return;
    hideTip();
    tipTarget = target;
    showTip(target);
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('scroll', hideTip, true);

  // ---------- auto-hiding scrollbars ----------

  // A scrollbar shows while its area is scrolling and fades out this long after scrolling stops.
  const SCROLLBAR_HIDE_MS = 500;
  const scrollbarTimers = new WeakMap();

  document.addEventListener('scroll', (event) => {
    const el = event.target === document ? document.documentElement : event.target;
    if (!(el instanceof Element)) return;
    el.classList.add('is-scrolling');
    clearTimeout(scrollbarTimers.get(el));
    scrollbarTimers.set(el, setTimeout(() => el.classList.remove('is-scrolling'), SCROLLBAR_HIDE_MS));
  }, { capture: true, passive: true });

  // ---------- opening animation ----------

  const INTRO_MS = 2900;

  /** Plays the intro, then slides the home screen in. Skipped when rejoining a room or when motion is reduced. */
  function playIntro() {
    const intro = $('intro');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (session || reduceMotion) {
      intro.remove();
      return;
    }

    document.body.classList.add('intro-playing');
    setTimeout(() => {
      intro.classList.add('done');
      document.body.classList.remove('intro-playing');
      document.body.classList.add('home-enter');
      setTimeout(() => intro.remove(), 600);
      // Put the cursor in the name box once it has slid in (not on touch screens, where it would pop up the keyboard).
      if (!nameInput.value && window.matchMedia('(pointer: fine)').matches) {
        setTimeout(() => nameInput.focus({ preventScroll: true }), 700);
      }
    }, INTRO_MS);
  }

  // ---------- video call ----------
  // Browsers send video straight to each other (WebRTC); the server only passes the setup messages along.
  // Everyone in the call links to everyone else, which suits a table of up to 6.

  const VIDEO_CONSTRAINTS = { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 20 }, facingMode: 'user' };
  const call = {
    active: false, // this tab is in the call
    joining: false,
    confirmed: false, // the server has our current session
    session: null, // new on every join, so the others know to make fresh links
    stream: null, // our camera and microphone
    mic: false,
    cam: false,
    iceServers: null,
    announced: null, // the media state last sent to the server
  };
  // playerId -> { pc, polite, makingOffer, ignoreOffer, session, stream, audio, queue, candidates }
  const peers = new Map();
  const videoEls = new Map(); // playerId -> one <video> per player, moved into their avatar on each render

  const newSession = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  async function getLocalStream() {
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

  async function joinCall() {
    if (call.active || call.joining) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      toast(window.isSecureContext ? 'This browser does not support video calls.' : 'Video calls need a secure (https) address.');
      return;
    }
    call.joining = true;
    renderCallControls();
    try {
      if (!call.iceServers) call.iceServers = (await request('rtc_config'))?.iceServers ?? [];
      const stream = await getLocalStream();
      if (!view || !session) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      call.stream = stream;
      // A camera or microphone can stop mid-call (unplugged, or taken by another app).
      for (const track of stream?.getTracks() ?? []) track.addEventListener('ended', () => deviceStopped(track));
      // You join with your camera and microphone off; turn them on with the buttons when you're ready.
      for (const track of stream?.getTracks() ?? []) track.enabled = false;
      call.mic = false;
      call.cam = false;
      if (!stream) toast('Camera and microphone are blocked. You can still see and hear the others.');
      else toast(stream.getVideoTracks().length
        ? 'You joined with your camera and microphone off. Turn them on with the buttons at the top.'
        : 'No camera found. You joined with your microphone off.');
      call.active = true;
      call.confirmed = false;
      call.session = newSession();
      if (stream?.getAudioTracks().length) watchVoice(view.youId, stream);
      announceMedia();
    } finally {
      call.joining = false;
      render();
    }
  }

  function deviceStopped(track) {
    if (!call.active || call.stream?.getTracks().every((t) => t !== track)) return;
    if (track.kind === 'video') call.cam = false;
    else call.mic = false;
    toast(track.kind === 'video' ? 'Your camera stopped.' : 'Your microphone stopped.');
    announceMedia();
    render();
  }

  function leaveCall() {
    for (const id of [...peers.keys()]) closePeer(id);
    stopWatchingVoice(view?.youId);
    call.stream?.getTracks().forEach((t) => t.stop());
    Object.assign(call, { active: false, confirmed: false, session: null, stream: null, mic: false, cam: false });
    for (const video of videoEls.values()) video.remove();
    videoEls.clear();
    if (session) announceMedia();
    else call.announced = null;
  }

  function announceMedia() {
    const media = call.active ? { joined: true, mic: call.mic, cam: call.cam, session: call.session } : { joined: false };
    const key = JSON.stringify(media);
    if (key === call.announced) return;
    call.announced = key;
    request('set_media', { media });
  }

  function toggleTrack(kind) {
    const tracks = (kind === 'audio' ? call.stream?.getAudioTracks() : call.stream?.getVideoTracks())?.filter((t) => t.readyState === 'live');
    if (!tracks?.length) {
      toast(kind === 'audio' ? 'No microphone available.' : 'No camera available.');
      return;
    }
    const on = kind === 'audio' ? (call.mic = !call.mic) : (call.cam = !call.cam);
    for (const track of tracks) track.enabled = on;
    announceMedia();
    render();
  }

  /** Brings the links in line with who is in the call. Runs after every state update. */
  function syncCall() {
    if (!view || !session) {
      if (call.active) leaveCall();
      return;
    }
    if (!call.active) return;
    const me = view.players.find((p) => p.id === view.youId);
    if (me?.media.session === call.session) {
      call.confirmed = true;
    } else if (call.confirmed) {
      // The server dropped us from the call (our connection was replaced): rejoin with fresh links.
      for (const id of [...peers.keys()]) closePeer(id);
      call.session = newSession();
      call.confirmed = false;
      announceMedia();
      return;
    }
    if (!call.confirmed) return;
    const present = new Set();
    for (const player of view.players) {
      if (player.id === view.youId || !player.connected || !player.media.joined) continue;
      present.add(player.id);
      const peer = peers.get(player.id);
      if (peer?.session === player.media.session) continue;
      if (peer) closePeer(player.id);
      // Of each pair, the player with the smaller id starts the link; the other answers its offer.
      // Both are in the call by then, so the offer is never sent to a page that is not ready for it.
      if (view.youId < player.id) createPeer(player.id, player.media.session);
    }
    for (const id of [...peers.keys()]) if (!present.has(id)) closePeer(id);
  }

  function sendSignal(to, data) {
    socket.emit('rtc_signal', { to, data: { ...data, session: call.session, target: peers.get(to)?.session } }, () => {});
  }

  function createPeer(id, remoteSession) {
    const pc = new RTCPeerConnection({ iceServers: call.iceServers ?? [] });
    // "Perfect negotiation": both sides may offer; on a clash the polite one gives way.
    const peer = {
      pc,
      polite: view.youId > id,
      makingOffer: false,
      ignoreOffer: false,
      session: remoteSession,
      stream: null,
      audio: null,
      queue: Promise.resolve(), // incoming messages, handled one at a time
      candidates: [], // network candidates that arrived before the offer or answer
    };
    peers.set(id, peer);

    const tracks = call.stream?.getTracks() ?? [];
    for (const track of tracks) pc.addTrack(track, call.stream);
    // Still receive the other person's sound and picture when we send none of our own.
    if (!tracks.some((t) => t.kind === 'audio')) pc.addTransceiver('audio', { direction: 'recvonly' });
    if (!tracks.some((t) => t.kind === 'video')) pc.addTransceiver('video', { direction: 'recvonly' });

    pc.ontrack = ({ track, streams }) => {
      if (peers.get(id) !== peer) return;
      peer.stream ??= streams[0] ?? new MediaStream();
      if (!peer.stream.getTracks().includes(track)) peer.stream.addTrack(track);
      if (track.kind === 'audio') {
        playAudio(peer);
        watchVoice(id, peer.stream);
      }
      track.onunmute = () => render();
      render();
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) sendSignal(id, { candidate: candidate.toJSON() });
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        sendSignal(id, { description: pc.localDescription.toJSON() });
      } catch (err) {
        console.warn('Video offer failed', err);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
      if (pc.connectionState === 'connected' || pc.connectionState === 'failed') render();
    };
    return peer;
  }

  function closePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    peer.pc.close();
    peer.audio?.remove();
    stopWatchingVoice(id);
    videoEls.get(id)?.remove();
    videoEls.delete(id);
  }

  /** Other players' voices play from hidden audio elements that stay put while the table redraws. */
  function playAudio(peer) {
    if (!peer.audio) {
      peer.audio = h('audio', { autoplay: true });
      $('rtc-audio').append(peer.audio);
    }
    if (peer.audio.srcObject !== peer.stream) peer.audio.srcObject = peer.stream;
    peer.audio.play().catch(() => {});
  }

  socket.on('rtc_signal', async ({ from, data }) => {
    // Ignore messages meant for an earlier join of ours.
    if (!call.active || !data || data.target !== call.session) return;
    let peer = peers.get(from);
    if (!peer || peer.session !== data.session) {
      // Their join may reach us here before the room update does.
      if (!view?.players.some((p) => p.id === from)) return;
      if (peer) closePeer(from);
      peer = createPeer(from, data.session);
    }
    peer.queue = peer.queue.then(() => handleSignal(from, peer, data));
  });

  async function handleSignal(from, peer, data) {
    const { pc } = peer;
    if (peers.get(from) !== peer) return;
    try {
      if (data.description) {
        const clash = data.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && clash;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        for (const candidate of peer.candidates.splice(0)) await pc.addIceCandidate(candidate).catch(() => {});
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          sendSignal(from, { description: pc.localDescription.toJSON() });
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

  function hasLiveVideo(playerId) {
    if (playerId === view.youId) return call.active && call.cam && Boolean(call.stream?.getVideoTracks().some((t) => t.readyState === 'live'));
    const player = view.players.find((p) => p.id === playerId);
    return Boolean(player?.media.cam && liveVideoTrack(playerId));
  }

  function liveVideoTrack(playerId) {
    return peers.get(playerId)?.stream?.getVideoTracks().find((t) => t.readyState === 'live' && !t.muted) ?? null;
  }

  function videoFor(playerId) {
    const isMe = playerId === view.youId;
    let video = videoEls.get(playerId);
    if (!video) {
      video = h('video', { class: `av-video${isMe ? ' self' : ''}`, autoplay: true, playsinline: true });
      video.muted = true; // sound comes from the audio elements (and never our own)
      // No browser picture-in-picture button, cast button or right-click video menu on the faces.
      video.disablePictureInPicture = true;
      video.disableRemotePlayback = true;
      video.setAttribute('disablepictureinpicture', '');
      video.setAttribute('disableremoteplayback', '');
      video.addEventListener('contextmenu', (event) => event.preventDefault());
      videoEls.set(playerId, video);
    }
    const stream = isMe ? call.stream : peers.get(playerId)?.stream;
    if (video.srcObject !== stream) video.srcObject = stream;
    return video;
  }

  /** Puts a player's live video in place of their avatar, with a muted sign when their mic is off. */
  function withVideo(playerId, avatar) {
    const player = view.players.find((p) => p.id === playerId);
    const isMe = playerId === view.youId;
    const inCall = isMe ? call.active : player?.media.joined;
    if (!inCall) return avatar;
    avatar.classList.add('in-call');
    if (speaking.has(playerId)) avatar.classList.add('speaking');
    if (hasLiveVideo(playerId)) {
      const video = videoFor(playerId);
      avatar.classList.add('has-video');
      avatar.replaceChildren(video);
      // Moving a playing video can pause it; carry on.
      queueMicrotask(() => video.paused && video.play().catch(() => {}));
    }
    const micOn = isMe ? call.mic : player.media.mic;
    if (!micOn) avatar.append(h('span', { class: 'mic-off', 'data-tip': 'Microphone off', 'aria-label': 'Microphone off' }, '🔇'));
    return avatar;
  }

  // In the game, wide screens show the videos in a column on each side of the table instead of in the badges.
  const RAILS_MIN_WIDTH = 900;
  let railsOn = false;
  let columnsOn = false; // wide-screen game layout: player tiles in a column on the left

  /** Column width: tiles are 4:3, and up to three stack in a column between the top bar and your badge. */
  function railWidthFor(W, H) {
    const tileH = Math.min(180, (H - 64 - 150 - 2 * 10) / 3);
    return Math.round(Math.min(W >= 1500 ? 260 : 220, Math.max(160, (tileH * 4) / 3 + 16)));
  }

  function renderVideoRails(game) {
    const left = $('video-rail-left');
    const right = $('video-rail-right');
    const self = $('self-video');
    if (!railsOn) {
      left.replaceChildren();
      right.replaceChildren();
      self.replaceChildren();
      return;
    }
    // Your own picture sits small, just above your badge; the others fill the side columns in turn order
    // (the left one, which also has your picture below it, takes the smaller half).
    const me = view.players.find((p) => p.id === view.youId);
    self.replaceChildren(videoTile(game, me));
    const others = aroundMe(game.players)
      .slice(1)
      .map((p) => view.players.find((q) => q.id === p.id))
      .filter((p) => p?.connected && p.media?.joined);
    if (columnsOn) {
      // Wide game layout: your tile joins the others, so both columns hold the same number of boxes.
      // By default the left column is filled first with your own box last in it; you can drag boxes to reorder.
      self.replaceChildren();
      const leftCount = Math.ceil((others.length + 1) / 2);
      const defaults = [...others.slice(0, leftCount - 1), me, ...others.slice(leftCount - 1)];
      const tiles = inVideoOrder(defaults).map((p) => videoTile(game, p));
      left.replaceChildren(...tiles.slice(0, leftCount));
      right.replaceChildren(...tiles.slice(leftCount));
    } else {
      const tiles = inVideoOrder(others).map((p) => videoTile(game, p));
      const half = Math.floor(tiles.length / 2);
      left.replaceChildren(...tiles.slice(0, half));
      right.replaceChildren(...tiles.slice(half));
    }
    for (const video of document.querySelectorAll('.video-rail video, #self-video video')) if (video.paused) video.play().catch(() => {});
  }

  // ---- your own order for the video boxes ----
  // Drag a box onto another to swap their places. The order is yours alone (other players keep theirs)
  // and is remembered in this browser; players you haven't placed keep their usual spot.
  let videoOrder = [];
  try {
    videoOrder = JSON.parse(localStorage.getItem('uno.videoOrder')) ?? [];
  } catch {
    videoOrder = [];
  }

  function inVideoOrder(players) {
    const placed = videoOrder.filter((id) => players.some((p) => p.id === id));
    if (!placed.length) return players;
    // Keep each placed player at the index of the slot it was dragged to, filling the rest in their default order.
    const result = [...players];
    const ranked = players.filter((p) => placed.includes(p.id)).sort((a, b) => placed.indexOf(a.id) - placed.indexOf(b.id));
    const slots = players.map((p, i) => (placed.includes(p.id) ? i : -1)).filter((i) => i >= 0);
    slots.forEach((slot, k) => { result[slot] = ranked[k]; });
    return result;
  }

  function swapVideoBoxes(fromId, toId) {
    const current = [...document.querySelectorAll('.video-rail .vtile')].map((t) => t.dataset.player);
    const a = current.indexOf(fromId);
    const b = current.indexOf(toId);
    if (a < 0 || b < 0 || a === b) return;
    [current[a], current[b]] = [current[b], current[a]];
    videoOrder = current;
    try {
      localStorage.setItem('uno.videoOrder', JSON.stringify(videoOrder));
    } catch {
      // Not remembered after a reload; the order still applies now.
    }
    if (view?.game) renderStage();
  }

  let draggedVideo = null;
  document.addEventListener('dragstart', (event) => {
    const tile = event.target.closest?.('.video-rail .vtile');
    if (!tile) return;
    draggedVideo = tile.dataset.player;
    tile.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedVideo);
  });
  document.addEventListener('dragover', (event) => {
    const tile = event.target.closest?.('.video-rail .vtile');
    if (!draggedVideo || !tile) return;
    event.preventDefault();
    for (const t of document.querySelectorAll('.video-rail .vtile.drop-target')) t.classList.remove('drop-target');
    if (tile.dataset.player !== draggedVideo) tile.classList.add('drop-target');
  });
  document.addEventListener('drop', (event) => {
    const tile = event.target.closest?.('.video-rail .vtile');
    if (!draggedVideo || !tile) return;
    event.preventDefault();
    swapVideoBoxes(draggedVideo, tile.dataset.player);
  });
  document.addEventListener('dragend', () => {
    draggedVideo = null;
    for (const t of document.querySelectorAll('.video-rail .vtile.dragging, .video-rail .vtile.drop-target')) {
      t.classList.remove('dragging', 'drop-target');
    }
  });

  function videoTile(game, p) {
    const isMe = p.id === view.youId;
    const micOn = isMe ? call.mic : p.media.mic;
    const turn = game.roundActive && game.currentPlayerId === p.id;
    const talking = speaking.has(p.id) ? ' speaking' : '';
    return h('div', {
      class: `vtile${turn ? ' turn' : ''}${isMe ? ' me' : ''}${talking}`,
      'data-player': p.id,
      draggable: true,
      title: 'Drag onto another box to swap places',
    },
      hasLiveVideo(p.id)
        ? videoFor(p.id)
        : h('div', { class: 'vtile-placeholder' }, avatarEl('vtile-avatar', p.name, p.avatar)),
      h('div', { class: 'vtile-name' },
        h('span', { class: 'vtile-label' }, isMe ? `${p.name} (you)` : p.name),
        micOn ? null : h('span', { class: 'vtile-mic', 'data-tip': 'Microphone off', 'aria-label': 'Microphone off' }, '🔇')));
  }

  // ---- who is speaking ----
  // Each voice in the call (ours included) feeds a level meter; a tile glows while its player talks.
  const VOICE_LEVEL = 0.035; // loudness (RMS, 0..1) that counts as talking rather than background noise
  const VOICE_HOLD_MS = 350; // keep the glow through the short gaps between words
  let audioCtx = null;
  const voices = new Map(); // playerId -> { source, analyser, samples, lastLoud }
  const speaking = new Set();

  function watchVoice(playerId, stream) {
    const track = stream?.getAudioTracks()[0];
    if (!track || voices.get(playerId)?.track === track) return;
    stopWatchingVoice(playerId);
    try {
      audioCtx ??= new AudioContext();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser); // a meter only: nothing is played through it
      voices.set(playerId, { track, source, analyser, samples: new Float32Array(analyser.fftSize), lastLoud: 0 });
    } catch (err) {
      console.warn('Could not watch a voice level', err);
    }
  }

  function stopWatchingVoice(playerId) {
    const voice = voices.get(playerId);
    if (!voice) return;
    voice.source.disconnect();
    voices.delete(playerId);
    setSpeaking(playerId, false);
  }

  function micIsOn(playerId) {
    if (playerId === view?.youId) return call.mic;
    return Boolean(view?.players.find((p) => p.id === playerId)?.media?.mic);
  }

  function setSpeaking(playerId, on) {
    if (speaking.has(playerId) === on) return;
    if (on) speaking.add(playerId);
    else speaking.delete(playerId);
    for (const tile of document.querySelectorAll(`.vtile[data-player="${playerId}"], [data-player="${playerId}"] .in-call`)) {
      tile.classList.toggle('speaking', on);
    }
  }

  setInterval(() => {
    const now = Date.now();
    for (const [playerId, voice] of voices) {
      voice.analyser.getFloatTimeDomainData(voice.samples);
      let sum = 0;
      for (const v of voice.samples) sum += v * v;
      if (Math.sqrt(sum / voice.samples.length) > VOICE_LEVEL && micIsOn(playerId)) voice.lastLoud = now;
      setSpeaking(playerId, now - voice.lastLoud < VOICE_HOLD_MS);
    }
  }, 120);

  // Line icons for the call buttons (24×24, drawn with the button's text colour). A slash marks "off".
  const CALL_ICONS = {
    mic: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z', 'M19 11a7 7 0 0 1-14 0', 'M12 18v3', 'M8.5 21h7'],
    cam: ['M3 7.5A1.5 1.5 0 0 1 4.5 6h9A1.5 1.5 0 0 1 15 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 16.5Z', 'M15 10.5l6-3.5v10l-6-3.5'],
    hangup: ['M3.5 14.5c4.6-4.4 12.4-4.4 17 0l-1.9 2.4a1 1 0 0 1-1.3.2l-2.5-1.6a1 1 0 0 1-.4-1v-1.6a12 12 0 0 0-5.8 0v1.6a1 1 0 0 1-.4 1l-2.5 1.6a1 1 0 0 1-1.3-.2Z'],
    muteAll: ['M9 3.5a2.5 2.5 0 0 0-2.5 2.5v4.5a2.5 2.5 0 0 0 5 0V6A2.5 2.5 0 0 0 9 3.5Z', 'M14.5 10a5.5 5.5 0 0 1-11 0', 'M9 16v3', 'M17 6.5a2 2 0 1 1 0 4', 'M18.5 13.5c1.4.5 2.5 1.6 2.5 3'],
  };

  function callIcon(name, { off = false } = {}) {
    const paths = CALL_ICONS[name].map((d) => svgEl('path', { d }));
    if (off) paths.push(svgEl('path', { d: 'M4 4l16 16', class: 'slash' }));
    return svgEl('svg', {
      class: 'call-icon',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    }, ...paths);
  }

  function callButtons() {
    const others = view ? view.players.filter((p) => p.id !== view.youId && p.media?.joined).length : 0;
    if (!call.active) {
      return [h('button', {
        type: 'button',
        class: 'call-btn join',
        disabled: call.joining,
        'data-tip': others ? `${others} other player${others === 1 ? ' is' : 's are'} on video` : 'Turn on your camera and microphone',
        'aria-label': 'Join video',
        onclick: joinCall,
      }, callIcon('cam'), h('span', { class: 'call-label' }, call.joining ? 'Connecting…' : `Join video${others ? ` (${others})` : ''}`))];
    }
    const isHost = view?.hostId === view?.youId;
    const anyoneToMute = view.players.some((p) => p.id !== view.youId && p.connected && p.media?.joined && p.media.mic);
    return [
      h('button', {
        type: 'button',
        class: `call-btn round${call.mic ? '' : ' off'}`,
        'aria-pressed': String(!call.mic),
        'data-tip': call.mic ? 'Mute your microphone' : 'Unmute your microphone',
        'aria-label': call.mic ? 'Mute microphone' : 'Unmute microphone',
        onclick: () => toggleTrack('audio'),
      }, callIcon('mic', { off: !call.mic })),
      h('button', {
        type: 'button',
        class: `call-btn round${call.cam ? '' : ' off'}`,
        'aria-pressed': String(!call.cam),
        'data-tip': call.cam ? 'Turn your camera off' : 'Turn your camera on',
        'aria-label': call.cam ? 'Turn camera off' : 'Turn camera on',
        onclick: () => toggleTrack('video'),
      }, callIcon('cam', { off: !call.cam })),
      isHost && others
        ? h('button', {
          type: 'button',
          class: 'call-btn mute-all',
          disabled: !anyoneToMute,
          'data-tip': anyoneToMute ? 'Mute everyone else in the call (they can unmute themselves)' : 'Everyone else is already muted',
          'aria-label': 'Mute everyone',
          onclick: () => action('mute_all'),
        }, callIcon('muteAll', { off: true }), h('span', { class: 'call-label' }, 'Mute all'))
        : null,
      h('button', {
        type: 'button',
        class: 'call-btn round leave',
        'data-tip': 'Leave the video call (you stay in the game)',
        'aria-label': 'Leave video',
        onclick: () => {
          leaveCall();
          render();
        },
      }, callIcon('hangup')),
    ].filter(Boolean);
  }

  // The host muted everyone: switch our microphone off (we can turn it back on).
  socket.on('force_mute', ({ by }) => {
    if (!call.active) return;
    if (call.mic) {
      call.mic = false;
      for (const track of call.stream?.getAudioTracks() ?? []) track.enabled = false;
      announceMedia();
    }
    toast(`🔇 ${by ?? 'The host'} muted everyone. Click the microphone to unmute.`);
    render();
  });

  /** Join / mic / camera / leave buttons, in the lobby bar and the game's top bar. */
  function renderCallControls() {
    $('lobby-call').replaceChildren(...callButtons());
    $('stage-call').replaceChildren(...callButtons());
  }

  // ---------- throwing things ----------
  // During a game you can click another player and throw a tomato or an egg at them, or send a heart.
  // The server tells everyone in the room, and each screen shows it flying from seat to seat and splatting.

  const THROWABLES = {
    tomato: { emoji: '🍅', label: 'Tomato' },
    egg: { emoji: '🥚', label: 'Egg' },
    heart: { emoji: '❤️', label: 'Heart', love: true },
  };
  const THROW_FLIGHT_MS = 650;
  const SPLAT_STAY_MS = 1800;
  // Rapid fire is fine; clicks closer together than the server allows are just skipped.
  const THROW_GAP_MS = 130;
  const MAX_SPLATS = 12;
  let throwTargetId = null;
  let lastThrowAt = 0;

  /** Where a player sits on this screen: their video tile if the videos are beside the table, else their avatar. */
  function seatSpot(playerId) {
    const tile = (railsOn || columnsOn) && document.querySelector(`.video-rail .vtile[data-player="${playerId}"], #self-video .vtile[data-player="${playerId}"]`);
    if (tile) return tile;
    if (playerId === view?.youId) return document.querySelector('#my-badge .pb-avatar');
    return document.querySelector(`#opponents [data-player="${playerId}"] .pb-avatar`);
  }

  function openThrowMenu(playerId, x, y) {
    const player = view?.players.find((p) => p.id === playerId);
    if (!player || playerId === view.youId || !view.game) return;
    hideTip();
    throwTargetId = playerId;
    const menu = $('throw-menu');
    menu.setAttribute('aria-label', `Throw something at ${player.name}`);
    $('throw-options').replaceChildren(...Object.entries(THROWABLES).map(([item, { emoji, label }]) => h('button', {
      type: 'button',
      class: 'throw-option',
      'aria-label': `Throw a ${label.toLowerCase()} at ${player.name}`,
      'data-tip': label,
      onclick: () => throwAt(item),
    }, h('span', { class: 'throw-emoji', 'aria-hidden': 'true' }, emoji))));
    menu.hidden = false;
    // By the player's avatar at the table (even when you clicked their video, where the splat lands),
    // clear of it: below, or above if there's no room.
    const avatar = document.querySelector(`#opponents [data-player="${playerId}"] .pb-avatar`) ?? seatSpot(playerId);
    const seat = avatar?.getBoundingClientRect() ?? { left: x, right: x, top: y, bottom: y };
    const cx = (seat.left + seat.right) / 2;
    const cy = (seat.top + seat.bottom) / 2;
    const clearance = Math.max(70, (seat.bottom - seat.top) * 0.75);
    const below = cy + clearance;
    const top = below + menu.offsetHeight > window.innerHeight - 8 ? cy - clearance - menu.offsetHeight : below;
    const left = Math.min(Math.max(8, cx - menu.offsetWidth / 2), window.innerWidth - menu.offsetWidth - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    menu.querySelector('button')?.focus();
  }

  function closeThrowMenu() {
    $('throw-menu').hidden = true;
    throwTargetId = null;
  }

  /** Throws one and closes the menu; click the player again to throw another (no waiting in between). */
  function throwAt(item) {
    const targetId = throwTargetId;
    closeThrowMenu();
    if (!targetId || Date.now() - lastThrowAt < THROW_GAP_MS) return;
    lastThrowAt = Date.now();
    socket.emit('throw_item', { targetId, item }, () => {});
  }

  // Click (or tap) another player's name chip or cards during a game. (Their video box does nothing on click.)
  for (const id of ['opponents']) {
    $(id).addEventListener('click', (event) => {
      if (event.target.closest('.catch')) return;
      const seat = event.target.closest('[data-player]');
      if (!seat || seat.dataset.player === view?.youId) return;
      event.stopPropagation();
      openThrowMenu(seat.dataset.player, event.clientX, event.clientY);
    });
  }
  document.addEventListener('click', (event) => {
    if (!$('throw-menu').hidden && !event.target.closest('#throw-menu')) closeThrowMenu();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeThrowMenu();
  });

  socket.on('thrown', ({ from, to, item }) => {
    if (!THROWABLES[item] || !view?.game || $('stage').hidden) return;
    const start = seatSpot(from);
    const target = seatSpot(to);
    if (!target) return;
    const centre = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: Math.max(r.width, r.height) };
    };
    const end = centre(target);
    const begin = start ? centre(start) : { x: end.x, y: -40 };
    const projectile = h('div', { class: 'projectile', 'aria-hidden': 'true' }, THROWABLES[item].emoji);
    document.body.append(projectile);
    // A lob: straight across, up and over in an arc, spinning.
    const lift = Math.min(260, 80 + Math.hypot(end.x - begin.x, end.y - begin.y) * 0.35);
    const frames = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = begin.x + (end.x - begin.x) * t;
      const y = begin.y + (end.y - begin.y) * t - lift * 4 * t * (1 - t);
      frames.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${t * 600}deg) scale(${1 + 0.35 * Math.sin(Math.PI * t)})` });
    }
    const sender = view.players.find((p) => p.id === from)?.name ?? 'Someone';
    projectile.animate(frames, { duration: THROW_FLIGHT_MS, easing: 'linear' }).finished.then(() => {
      // Squash flat against the target for a split second.
      const at = `translate(${end.x}px, ${end.y}px) translate(-50%, -50%)`;
      return projectile.animate([
        { transform: `${at} scale(1.2, 0.8)` },
        { transform: `${at} scale(1.7, 0.35)`, opacity: 0.6 },
      ], { duration: 90, easing: 'ease-in', fill: 'forwards' }).finished;
    }).then(() => {
      projectile.remove();
      if (THROWABLES[item].love) sendLove(target, end, to === view?.youId, sender);
      else splatOn(target, end, item, to === view?.youId);
    }).catch((err) => {
      projectile.remove();
      console.warn('Throw animation failed', err);
    });
  });

  /** Plays a Web Animation on a new element inside `parent`, removing it when done. */
  function burstBit(parent, cls, content, frames, options, style = '') {
    const el = h('span', { class: cls, style }, content);
    parent.append(el);
    el.animate(frames, { fill: 'forwards', ...options }).finished.then(() => el.remove(), () => el.remove());
    return el;
  }

  /**
   * The hit. A tomato bursts: a spiky juice splatter shoots out, bits of skin and the stalk fly off,
   * seeds and pulp sit on top. An egg cracks: the shell halves tumble away, the white spreads out
   * like liquid and the yolk drops in with a wobble. The target shakes; then the mess slides down and fades.
   */
  function splatOn(target, at, item, onMe) {
    const size = Math.max(130, at.size * 1.2, Math.min(at.size * 2, 210));
    const box = h('div', { class: `splat splat-${item}`, 'aria-hidden': 'true', style: `left:${at.x}px;top:${at.y}px;width:${size}px;height:${size}px` });
    document.body.append(box);
    // Rapid fire piles splats up; keep the newest few.
    const all = document.querySelectorAll('.splat');
    for (let i = 0; i < all.length - MAX_SPLATS; i++) all[i].remove();
    if (item === 'egg') crackEgg(box, size);
    else burstTomato(box, size);

    if (target.isConnected) {
      target.animate([
        { translate: '0 0', rotate: '0deg' }, { translate: '-7px 3px', rotate: '-4deg' }, { translate: '6px -2px', rotate: '3deg' },
        { translate: '-4px 1px', rotate: '-2deg' }, { translate: '2px 0', rotate: '1deg' }, { translate: '0 0', rotate: '0deg' },
      ], { duration: 460, easing: 'ease-out' });
    }
    if (onMe) toast(`${THROWABLES[item].emoji} Splat! You got hit.`);

    // Gravity wins in the end: the whole mess sags downward, stretches and fades.
    setTimeout(() => {
      box.animate([
        { translate: '-50% -50%', scale: '1 1', opacity: 1 },
        { translate: '-50% calc(-50% + 26px)', scale: '0.97 1.18', opacity: 0 },
      ], { duration: 900, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)', fill: 'forwards' })
        .finished.then(() => box.remove(), () => box.remove());
    }, SPLAT_STAY_MS);
  }

  /** Something flying off the hit: out and up, then falling and spinning as it fades. */
  function flyOff(box, el, size, { angle, reach = 0.6, spin = 360, duration = 800 }) {
    const dx = Math.cos(angle) * size * reach;
    const up = Math.sin(angle) * size * reach;
    box.append(el);
    el.animate([
      { transform: 'translate(-50%, -50%) rotate(0deg) scale(0.6)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${up * 0.6 - size * 0.18}px)) rotate(${spin * 0.4}deg) scale(1)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${up + size * 0.55}px)) rotate(${spin}deg) scale(0.85)`, opacity: 0 },
    ], { duration, easing: 'cubic-bezier(0.25, 0.6, 0.5, 1)', fill: 'forwards' }).finished.then(() => el.remove(), () => el.remove());
  }

  /** Smooth closed outline through points around the centre of a 100×100 box. */
  function blobPath(points) {
    const n = points.length;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const start = mid(points[n - 1], points[0]);
    let d = `M ${start[0].toFixed(1)} ${start[1].toFixed(1)}`;
    points.forEach((p, i) => {
      const m = mid(p, points[(i + 1) % n]);
      d += ` Q ${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
    });
    return `${d} Z`;
  }

  function burstTomato(box, size) {
    // The splatter: a lumpy core, tapered streaks of very different lengths (each ending in a drop),
    // and a few small separate splats thrown further out.
    const parts = [];
    const core = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      const r = 17 + Math.random() * 11;
      return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r];
    });
    const streaks = [];
    const count = 7 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const long = Math.random() < 0.45;
      const len = long ? 34 + Math.random() * 12 : 24 + Math.random() * 8;
      const base = 3 + Math.random() * 3.5;
      const from = 16;
      const px = -Math.sin(a);
      const py = Math.cos(a);
      const bx = 50 + Math.cos(a) * from;
      const by = 50 + Math.sin(a) * from;
      const tx = 50 + Math.cos(a) * len;
      const ty = 50 + Math.sin(a) * len;
      // A narrow wedge: wide where it leaves the core, a thin neck before the drop at the end.
      const d = `M ${(bx + px * base).toFixed(1)} ${(by + py * base).toFixed(1)}`
        + ` Q ${(tx - Math.cos(a) * 6 + px * 0.9).toFixed(1)} ${(ty - Math.sin(a) * 6 + py * 0.9).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}`
        + ` Q ${(tx - Math.cos(a) * 6 - px * 0.9).toFixed(1)} ${(ty - Math.sin(a) * 6 - py * 0.9).toFixed(1)} ${(bx - px * base).toFixed(1)} ${(by - py * base).toFixed(1)} Z`;
      streaks.push(svgEl('path', { d, fill: '#d8231f', class: 'streak' }));
      parts.push(svgEl('circle', { cx: tx + Math.cos(a) * 1.5, cy: ty + Math.sin(a) * 1.5, r: 1.6 + Math.random() * (long ? 2.2 : 1.4), fill: '#d8231f', class: 'streak' }));
    }
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 8;
      const cx = 50 + Math.cos(a) * r;
      const cy = 50 + Math.sin(a) * r;
      const blob = Array.from({ length: 7 }, (_, k) => {
        const b = (k / 7) * Math.PI * 2;
        const rr = 2 + Math.random() * 2.5;
        return [cx + Math.cos(b) * rr, cy + Math.sin(b) * rr];
      });
      parts.push(svgEl('path', { d: blobPath(blob), fill: '#d8231f', class: 'streak' }));
    }
    const splash = svgEl('svg', { viewBox: '0 0 100 100', class: 'splat-art' },
      ...streaks,
      ...parts,
      svgEl('path', { d: blobPath(core), fill: '#e0291f', stroke: '#8f0f12', 'stroke-width': '1' }),
      // Pulp: lighter, wetter patches; then the seeds in it.
      svgEl('path', { d: blobPath(core.map(([x, y]) => [50 + (x - 50) * 0.62, 50 + (y - 50) * 0.62])), fill: '#ff5a43', opacity: '0.75' }),
      ...Array.from({ length: 10 }, () => {
        const a = Math.random() * Math.PI * 2;
        const r = 4 + Math.random() * 11;
        const cx = 50 + Math.cos(a) * r;
        const cy = 50 + Math.sin(a) * r;
        return svgEl('ellipse', { cx, cy, rx: 1.9, ry: 1.1, fill: '#ffe08a', transform: `rotate(${(a * 180) / Math.PI} ${cx} ${cy})` });
      }),
      svgEl('ellipse', { cx: 42, cy: 41, rx: 8, ry: 3.5, fill: 'rgba(255,255,255,0.45)', transform: 'rotate(-30 42 41)' }));
    const art = h('div', { class: 'splat-art-wrap', style: `rotate:${Math.round(Math.random() * 360)}deg` });
    art.append(splash);
    box.append(art);
    art.animate([
      { scale: '0.2', opacity: 0.6 },
      { scale: '1.15', opacity: 1, offset: 0.45 },
      { scale: '0.95', offset: 0.75 },
      { scale: '1' },
    ], { duration: 420, easing: 'ease-out' });
    // Streaks and outer drops shoot out from the middle.
    for (const el of [...streaks, ...parts]) {
      el.animate([{ transform: 'scale(0.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: 160 + Math.random() * 140, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', fill: 'both' });
    }

    // Skin pieces and the stalk fly off; juice drops spray.
    const skin = (w, hgt) => h('span', { class: 'tomato-skin', style: `width:${w}px;height:${hgt}px` });
    for (let i = 0; i < 5; i++) {
      flyOff(box, skin(size * (0.13 + Math.random() * 0.07), size * (0.08 + Math.random() * 0.05)), size, {
        angle: -Math.PI / 2 + (i - 2) * 0.75 + Math.random() * 0.3, reach: 0.55 + Math.random() * 0.25, spin: 300 + Math.random() * 360, duration: 750 + Math.random() * 250,
      });
    }
    flyOff(box, h('span', { class: 'tomato-stalk' }, '🌿'), size, { angle: -Math.PI / 2 - 0.4, reach: 0.7, spin: 540, duration: 950 });
    for (let i = 0; i < 12; i++) {
      const d = 4 + Math.random() * 6;
      flyOff(box, h('span', { class: 'splat-drop', style: `width:${d}px;height:${d}px;background:${i % 3 ? '#e0291f' : '#ff6b55'}` }), size, {
        angle: Math.random() * Math.PI * 2, reach: 0.5 + Math.random() * 0.4, spin: 0, duration: 550 + Math.random() * 300,
      });
    }
  }

  function crackEgg(box, size) {
    // The white spreads slowly, like liquid finding its shape.
    const white = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      const r = 26 + Math.random() * 14;
      return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r * 0.92];
    });
    const whiteSvg = svgEl('svg', { viewBox: '0 0 100 100', class: 'splat-art' },
      svgEl('path', { d: blobPath(white), fill: '#fffdf7', stroke: '#e6dcc4', 'stroke-width': '1.2' }),
      svgEl('path', { d: blobPath(white.map(([x, y]) => [50 + (x - 50) * 0.8, 50 + (y - 50) * 0.8])), fill: '#ffffff', opacity: '0.7' }),
      svgEl('ellipse', { cx: 36, cy: 34, rx: 10, ry: 4, fill: 'rgba(255,255,255,0.9)', transform: 'rotate(-25 36 34)' }));
    const whiteWrap = h('div', { class: 'splat-art-wrap', style: `rotate:${Math.round(Math.random() * 360)}deg` });
    whiteWrap.append(whiteSvg);
    box.append(whiteWrap);
    whiteWrap.animate([
      { scale: '0.25 0.25', opacity: 0.8 },
      { scale: '0.85 0.8', opacity: 1, offset: 0.4 },
      { scale: '1.04 0.98', offset: 0.75 },
      { scale: '1 1' },
    ], { duration: 700, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' });

    // The yolk lands a beat later and jiggles.
    const yolk = svgEl('svg', { viewBox: '0 0 40 40', class: 'egg-yolk' },
      svgEl('circle', { cx: 20, cy: 20, r: 17, fill: '#ffb800', stroke: '#e08a00', 'stroke-width': '1.5' }),
      svgEl('circle', { cx: 20, cy: 21, r: 13, fill: '#ffc93c' }),
      svgEl('ellipse', { cx: 14, cy: 13, rx: 5, ry: 3, fill: 'rgba(255,255,255,0.85)', transform: 'rotate(-30 14 13)' }));
    const yolkWrap = h('div', { class: 'egg-yolk-wrap', style: `width:${size * 0.34}px;height:${size * 0.34}px` });
    yolkWrap.append(yolk);
    box.append(yolkWrap);
    yolkWrap.animate([
      { scale: '0 0', offset: 0 },
      { scale: '0 0', offset: 0.15 },
      { scale: '1.25 0.8', offset: 0.4 },
      { scale: '0.88 1.12', offset: 0.6 },
      { scale: '1.06 0.95', offset: 0.8 },
      { scale: '1 1' },
    ], { duration: 800, easing: 'ease-out', fill: 'backwards' });

    // The shell breaks in two and the halves tumble away; a few small shell bits too.
    const shell = (cls, w) => h('span', { class: `egg-shell ${cls}`, style: `width:${w}px;height:${w * 0.62}px` });
    flyOff(box, shell('left', size * 0.3), size, { angle: Math.PI + 0.5, reach: 0.55, spin: -260, duration: 900 });
    flyOff(box, shell('right', size * 0.3), size, { angle: -0.5, reach: 0.55, spin: 260, duration: 900 });
    for (let i = 0; i < 4; i++) {
      flyOff(box, shell('bit', size * (0.07 + Math.random() * 0.05)), size, {
        angle: -Math.PI / 2 + (Math.random() - 0.5) * 2.4, reach: 0.4 + Math.random() * 0.3, spin: 400 + Math.random() * 300, duration: 650 + Math.random() * 250,
      });
    }
    for (let i = 0; i < 7; i++) {
      const d = 4 + Math.random() * 5;
      flyOff(box, h('span', { class: 'splat-drop', style: `width:${d}px;height:${d}px;background:#fffdf7` }), size, {
        angle: Math.random() * Math.PI * 2, reach: 0.45 + Math.random() * 0.3, spin: 0, duration: 600 + Math.random() * 250,
      });
    }
  }

  /** A heart: a pink glow pulses round the player, little hearts float up, and they do a happy bounce. */
  function sendLove(target, at, onMe, sender) {
    const size = Math.max(110, at.size * 1.1);
    const box = h('div', { class: 'love', 'aria-hidden': 'true', style: `left:${at.x}px;top:${at.y}px;width:${size}px;height:${size}px` });
    document.body.append(box);
    for (let i = 0; i < 2; i++) {
      burstBit(box, 'love-ring', '', [
        { scale: '0.4', opacity: 0.9 },
        { scale: '1.5', opacity: 0 },
      ], { duration: 900, delay: i * 260, easing: 'ease-out' });
    }
    const hearts = ['❤️', '💖', '💕', '💗', '💞'];
    for (let i = 0; i < 14; i++) {
      const dx = (Math.random() - 0.5) * size * 1.3;
      const rise = size * (0.7 + Math.random() * 0.8);
      const sway = (Math.random() - 0.5) * 40;
      burstBit(box, 'love-heart', hearts[i % hearts.length], [
        { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.4}px), calc(-50% - ${rise * 0.3}px)) scale(1.1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(calc(-50% + ${dx + sway}px), calc(-50% - ${rise}px)) scale(0.8) rotate(${sway / 2}deg)`, opacity: 0 },
      ], { duration: 1400 + Math.random() * 700, delay: Math.random() * 350, easing: 'ease-out' },
      `font-size:${16 + Math.random() * 14}px`);
    }
    if (target.isConnected) {
      target.animate([
        { scale: '1' }, { scale: '1.18' }, { scale: '0.94' }, { scale: '1.06' }, { scale: '1' },
      ], { duration: 650, easing: 'ease-out' });
    }
    if (onMe) toast(`💖 ${sender} sent you love!`);
    setTimeout(() => box.remove(), 2600);
  }

  // ---------- connection and server pushes ----------

  socket.on('connect', () => {
    $('conn').textContent = 'Connected';
    $('conn').classList.add('online');
    // Re-join the room after a reconnect, using the token from this tab.
    if (session) {
      enterRoom(session.code, session.name, session.token).then((ok) => {
        if (!ok) leaveLocal('Could not rejoin the room.');
      });
    }
  });

  // The server was restarted with new code: reload so this page runs the matching client.
  let serverVersion = null;
  socket.on('server_version', (version) => {
    if (serverVersion && serverVersion !== version) window.location.reload();
    serverVersion = version;
  });

  socket.on('disconnect', () => {
    $('conn').textContent = 'Reconnecting…';
    $('conn').classList.remove('online');
  });

  socket.on('state', (next) => {
    // Let everyone know when the host changes (for example because the host left).
    const previousHostId = view?.code === next.code ? view.hostId : null;
    if (previousHostId && previousHostId !== next.hostId) {
      const host = next.players.find((p) => p.id === next.hostId);
      toast(next.hostId === next.youId ? '👑 You are now the host' : `👑 ${host?.name ?? 'Someone'} is now the host`);
    }
    // What actually happened (who played what on whom), for the table animations.
    const moments = Moments.between(view, next, next.youId);
    view = next;
    // Count down on this device's own clock from the time left the server reported.
    // (Falls back to the older clock-time field if the server has not been restarted since the update.)
    view.turnDeadline = typeof next.turnRemainingMs === 'number' ? Date.now() + next.turnRemainingMs : next.turnDeadline ?? null;
    render();
    // Animations need the freshly drawn table (where each player's chip and the piles are).
    FX.react?.(moments, view);
  });

  socket.on('room_closed', ({ reason }) => {
    leaveLocal(reason === 'idle' ? 'The room was closed after being idle.' : 'The room was closed.');
  });

  socket.on('kicked', () => leaveLocal('The host removed you from the room.'));

  function leaveLocal(message) {
    clearSession();
    view = null;
    trail = [];
    pendingWildId = null;
    $('color-dialog').hidden = true;
    closeGamePanels();
    render();
    if (message) toast(message);
  }

  // ---------- room controls ----------

  async function leaveRoom() {
    await request('leave_room');
    leaveLocal('You left the room.');
  }
  $('leave-btn').addEventListener('click', leaveRoom);
  $('stage-leave').addEventListener('click', () => {
    if (window.confirm('Leave this game? Your seat stays and the timer plays your turns.')) leaveRoom();
  });

  $('copy-code').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(view.code);
      toast('Room code copied');
    } catch {
      toast(`Room code: ${view.code}`);
    }
  });

  $('start-btn').addEventListener('click', () => action('start_game'));

  // The host's setting changes save straight away; nobody else can change them.
  $('settings-form').addEventListener('change', (event) => {
    if (view?.hostId !== view?.youId) return;
    action('update_settings', { settings: readSettings(event.currentTarget) });
  });
  $('settings-form').addEventListener('submit', (event) => event.preventDefault());

  // The lobby chat and the in-game chat send the same way.
  for (const [formId, inputId] of [['chat-form', 'chat-input'], ['game-chat-form', 'game-chat-input']]) {
    $(formId).addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = $(inputId);
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await action('chat', { text });
    });
  }

  // In the game, Log and Chat are separate panels; opening one closes the other.
  const GAME_PANELS = {
    log: { panel: 'game-log-panel', button: 'log-toggle' },
    chat: { panel: 'game-chat-panel', button: 'chat-toggle' },
  };

  // Panels slide in and out over SLIDE_MS; the table, videos and hand move over at the same pace.
  const SLIDE_MS = 260;
  const SLIDE_EASE = 'cubic-bezier(0.22, 0.8, 0.3, 1)';
  const panelTimers = new Map();
  const panelShowing = (id) => !$(id).hidden && !$(id).classList.contains('closing');

  function toggleGamePanel(name) {
    const opening = !panelShowing(GAME_PANELS[name].panel);
    closeGamePanels();
    if (!opening) return;
    const panel = $(GAME_PANELS[name].panel);
    clearTimeout(panelTimers.get(panel.id));
    panel.classList.remove('closing');
    panel.hidden = false;
    $(GAME_PANELS[name].button).classList.add('active');
    $(GAME_PANELS[name].button).setAttribute('aria-pressed', 'true');
    if (name === 'chat') {
      chatSeenAt = Date.now();
      renderUnread();
      scrollToEnd($('game-chat-log'));
      // Without preventScroll the browser scrolls the whole game sideways to reach the box while the panel slides in.
      $('game-chat-input').focus({ preventScroll: true });
    } else {
      scrollToEnd($('game-log'));
    }
    relayoutStage();
  }

  /** Replaces a container's children, sliding each new one from where its old twin (same class and player) was. */
  function slideIntoPlace(container, nodes) {
    const keyOf = (el) => `${el.classList[0]}|${el.dataset.player ?? ''}`;
    const centre = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const before = new Map([...container.children].map((el) => [keyOf(el), centre(el)]));
    container.replaceChildren(...nodes);
    if (!before.size) return;
    for (const el of nodes) {
      const was = before.get(keyOf(el));
      if (!was) continue;
      const now = centre(el);
      const dx = was.x - now.x;
      const dy = was.y - now.y;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: SLIDE_MS, easing: SLIDE_EASE });
    }
  }

  function relayoutStage() {
    if (view?.game && !$('stage').hidden) renderStage();
  }

  function closeGamePanels() {
    let closed = false;
    for (const { panel: id, button } of Object.values(GAME_PANELS)) {
      $(button).classList.remove('active');
      $(button).setAttribute('aria-pressed', 'false');
      if (!panelShowing(id)) continue;
      closed = true;
      const panel = $(id);
      if ($('stage').hidden) {
        panel.hidden = true; // nothing on screen to animate
        continue;
      }
      panel.classList.add('closing');
      panelTimers.set(id, setTimeout(() => {
        panel.hidden = true;
        panel.classList.remove('closing');
      }, SLIDE_MS));
    }
    if (closed) relayoutStage();
  }

  $('log-toggle').addEventListener('click', () => toggleGamePanel('log'));
  $('chat-toggle').addEventListener('click', () => toggleGamePanel('chat'));
  document.querySelectorAll('[data-close-panel]').forEach((button) => button.addEventListener('click', closeGamePanels));
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeGamePanels();
  });

  // ---------- How to play ----------

  function openHowTo() {
    hideTip();
    $('howto-dialog').hidden = false;
    $('howto-dialog').querySelector('.howto-body').scrollTop = 0;
    $('howto-close').focus();
  }

  function closeHowTo() {
    $('howto-dialog').hidden = true;
  }

  $('howto-btn').addEventListener('click', openHowTo);
  $('howto-close').addEventListener('click', closeHowTo);
  $('howto-dialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeHowTo();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeHowTo();
  });

  // ---------- Wild color wheel ----------

  // If no color has been picked this close to the end of the turn, the wheel picks one so the Wild still gets played.
  const AUTO_PICK_MS = 700;

  function chooseWildColor(color) {
    const cardId = pendingWildId;
    pendingWildId = null;
    $('color-dialog').hidden = true;
    if (cardId) action('play_card', { cardId, color });
  }

  /** The color you hold the most of, not counting the Wild being played. Ties go red, yellow, green, blue. */
  function mostHeldColor() {
    const counts = Object.fromEntries(Object.keys(COLOR_LABEL).map((c) => [c, 0]));
    for (const card of view?.game?.hand ?? []) {
      if (card.id !== pendingWildId && card.color in counts) counts[card.color] += 1;
    }
    return Object.keys(counts).reduce((best, c) => (counts[c] > counts[best] ? c : best));
  }

  document.querySelectorAll('.wedge[data-color]').forEach((button) => {
    button.addEventListener('click', () => chooseWildColor(button.dataset.color));
  });

  function readSettings(form) {
    // Rooms always have 6 seats, so max players is left to the server default.
    // Mode and stacking are only picked in the lobby; a new room starts with the server defaults.
    const settings = {};
    if (form.mode) settings.mode = form.mode.value;
    if (form.stacking) settings.stacking = form.stacking.checked;
    return settings;
  }

  function fillSettings(form, s) {
    form.mode.value = s.mode;
    form.stacking.checked = s.stacking;
  }

  // Re-layout when the window size changes; positions are computed from the stage size.
  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => render());
  });

  // ---------- rendering ----------

  function render() {
    const inRoom = Boolean(view && session);
    $('home').hidden = inRoom;
    $('room').hidden = !inRoom;
    document.body.classList.toggle('on-home', !inRoom);
    const playing = inRoom && view.status === 'playing' && Boolean(view.game);
    document.body.classList.toggle('on-lobby', inRoom && !playing);
    $('room').classList.toggle('playing', playing);
    document.body.classList.toggle('in-game', playing);
    $('stage').hidden = !playing;
    // The game just ended: show the final ranking over the lobby.
    if (wasPlaying && !playing) {
      trail = [];
      closeGamePanels();
      // The next game starts from an empty hand, so its deal animates too.
      seenHand = null;
      seenCounts.clear();
      celebratedFor = null;
      if (view?.lastResult) showResults(view.lastResult);
    }
    // The scorecard closes when you leave or when the host starts the next game.
    if (!inRoom || playing) $('results-dialog').hidden = true;
    // If the host changed while it is open (for example the host left), update its buttons.
    else if (!$('results-dialog').hidden) renderResultsActions();
    wasPlaying = playing;
    // In the lobby, How to play and the connection status sit beside the room code instead of in the top bar.
    const utilHome = inRoom && !playing ? $('lobby-top-right') : document.querySelector('.topbar-right');
    if ($('conn').parentElement !== utilHome) utilHome.append($('howto-btn'), $('conn'));
    syncCall();
    if (!inRoom) return;
    renderCallControls();

    if (playing) {
      renderStage();
    } else {
      renderHeader();
      renderLobbySeats();
      renderLobbyCenter();
      renderLobbyControls();
    }
    renderLog();
    renderChat();
    updateClock();
    // The hovered element may have just been redrawn; don't leave its tooltip floating.
    if (tipTarget && !tipTarget.isConnected) hideTip();
  }

  // ---------- lobby ----------

  function renderHeader() {
    $('room-code').textContent = view.code;
    $('status-line').textContent = `${view.players.length} of ${view.settings.maxPlayers} seats taken`;
  }

  /** Every seat is a card: players in turn order (the host can drag them to reorder), then the open seats. */
  function renderLobbySeats() {
    const empty = Math.max(0, view.settings.maxPlayers - view.players.length);
    $('lobby-seats').replaceChildren(
      ...view.players.map((p, i) => lobbySeatEl(p, i + 1)),
      ...Array.from({ length: empty }, (_, i) => h('li', {
        class: 'seat empty',
        'data-tip': 'Share the room code to fill this seat',
      },
      h('span', { class: 'seat-label' }, `Seat ${view.players.length + i + 1}`),
      h('span', { class: 'open-plus', 'aria-hidden': 'true' }, '+'),
      h('div', { class: 'seat-name' }, 'Open seat'))));
  }

  const CROWN = '<svg viewBox="0 0 24 20" aria-hidden="true"><path d="M2 16L1 5l6 5 5-8 5 8 6-5-1 11z"></path></svg>';

  function lobbySeatEl(seat, seatNo) {
    const isMe = seat.id === view.youId;
    const isHost = view.hostId === view.youId;
    // The host can right-click (or long-press) another player's seat for Remove / Make host.
    const hostMenu = isHost && !isMe;
    const classes = ['seat', 'order-row', isMe ? 'me' : '', seat.connected ? '' : 'away', hostMenu ? 'has-menu' : ''].filter(Boolean);
    let status = seat.id === view.hostId ? 'Host' : 'Ready';
    if (!seat.connected) status = 'Away';
    const crown = seat.id === view.hostId ? h('span', { class: 'host-crown', 'data-tip': 'Host' }) : null;
    if (crown) crown.innerHTML = CROWN;
    const seatEl = h('li', {
      class: classes.join(' '),
      'data-player': seat.id,
      'data-id': seat.id,
      draggable: isHost && view.players.length > 1,
      'data-tip': `Seat ${seatNo}${isHost && view.players.length > 1 ? ' · drag to change the turn order' : ''}${hostMenu ? ' · right-click for options' : ''}`,
    },
      h('span', { class: 'seat-label' }, `Seat ${seatNo}`),
      crown,
      h('div', { class: 'avatar-ring' }, withVideo(seat.id, avatarEl('avatar', seat.name, seat.avatar, { editable: isMe }))),
      h('div', { class: 'seat-name' }, seat.name),
      h('div', { class: 'seat-sub' }, status));
    if (hostMenu) {
      seatEl.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        openSeatMenu(seat, event.clientX, event.clientY);
      });
      addLongPress(seatEl, (x, y) => openSeatMenu(seat, x, y));
    }
    return seatEl;
  }

  // ---------- host's seat menu (lobby) ----------

  function openSeatMenu(player, x, y) {
    hideTip();
    const menu = $('seat-menu');
    menu.replaceChildren(
      h('div', { class: 'seat-menu-head' }, avatarEl('chat-avatar', player.name, player.avatar), h('strong', {}, player.name)),
      h('button', {
        type: 'button',
        role: 'menuitem',
        class: 'seat-menu-item',
        onclick: () => { closeSeatMenu(); action('transfer_host', { playerId: player.id }); },
      }, '👑 Make host'),
      h('button', {
        type: 'button',
        role: 'menuitem',
        class: 'seat-menu-item danger',
        onclick: () => { closeSeatMenu(); action('kick_player', { playerId: player.id }); },
      }, '✕ Remove from room'));
    menu.hidden = false;
    // Keep the menu on screen.
    const left = Math.min(x, window.innerWidth - menu.offsetWidth - 8);
    const top = Math.min(y, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    menu.querySelector('.seat-menu-item').focus();
  }

  function closeSeatMenu() {
    $('seat-menu').hidden = true;
  }

  document.addEventListener('pointerdown', (event) => {
    if (!$('seat-menu').hidden && !event.target.closest('#seat-menu')) closeSeatMenu();
  });
  document.addEventListener('scroll', closeSeatMenu, true);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSeatMenu();
  });

  /** Touch screens: holding a finger on an element for half a second acts like a right-click. */
  function addLongPress(el, onPress) {
    let timer = 0;
    el.addEventListener('touchstart', (event) => {
      const touch = event.touches[0];
      timer = setTimeout(() => onPress(touch.clientX, touch.clientY), 500);
    }, { passive: true });
    for (const type of ['touchend', 'touchmove', 'touchcancel']) {
      el.addEventListener(type, () => clearTimeout(timer), { passive: true });
    }
  }

  function renderLobbyCenter() {
    $('lobby-center').replaceChildren(...(view.lastResult
      ? [h('span', {}, `${view.lastResult.winnerName} won the last game`),
        h('button', { type: 'button', class: 'chip-btn', onclick: () => showResults(view.lastResult) }, 'View results')]
      : []));
  }

  function renderLobbyControls() {
    const isHost = view.hostId === view.youId;
    const host = view.players.find((p) => p.id === view.hostId);
    const canStart = view.players.length >= 2;

    // The host starts whenever at least 2 players are in; everyone else waits for the host.
    $('start-btn').hidden = !isHost;
    $('start-btn').disabled = !canStart;
    const play = h('span', { class: 'btn-icon-fill', 'aria-hidden': 'true' });
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"></path></svg>';
    $('start-btn').replaceChildren(play, 'Start game');
    let hint;
    if (!canStart) hint = isHost ? 'You need at least 2 players. Share the room code!' : 'Waiting for more players to join…';
    else if (isHost) hint = 'Drag players to change the turn order. Right-click a player to remove them or make them host.';
    else hint = `Waiting for ${host?.name ?? 'the host'} to start the game…`;
    $('start-hint').textContent = hint;
    $('start-hint').classList.toggle('waiting-host', !isHost && canStart);

    $('settings-note').textContent = isHost ? '' : 'Host only';
    $('settings-note').dataset.tip = isHost ? '' : `Only ${host?.name ?? 'the host'} (host) can change the game settings`;

    const form = $('settings-form');
    form.classList.toggle('locked', !isHost);
    for (const input of form.querySelectorAll('input')) input.disabled = !isHost;
    const key = JSON.stringify(view.settings);
    if (form.dataset.key !== key) {
      fillSettings(form, view.settings);
      form.dataset.key = key;
    }
  }

  // ---------- turn order (host) ----------

  /**
   * Rows for a turn-order list, in seat order: drag handle, seat number, avatar, name, ▲ ▼.
   * Used in the lobby and on the scorecard (the order is fixed during a game).
   */
  function orderRows() {
    const last = view.players.length - 1;
    return view.players.map((p, i) => {
      const isMe = p.id === view.youId;
      return h('li', { class: 'order-row', draggable: true, 'data-id': p.id },
        h('span', { class: 'drag-handle', 'aria-hidden': 'true', 'data-tip': 'Drag to move' }, '⋮⋮'),
        h('span', { class: 'order-no' }, String(i + 1)),
        avatarEl('chat-avatar', p.name, p.avatar),
        h('span', { class: 'name' }, isMe ? `${p.name} (you)` : p.name),
        h('span', { class: 'order-moves' },
          h('button', { type: 'button', class: 'move-btn', disabled: i === 0, 'aria-label': `Move ${p.name} up`, onclick: () => movePlayer(p.id, i - 1) }, '▲'),
          h('button', { type: 'button', class: 'move-btn', disabled: i === last, 'aria-label': `Move ${p.name} down`, onclick: () => movePlayer(p.id, i + 1) }, '▼')));
    });
  }

  /** Moves a player to a new position in the turn order (host only). */
  function movePlayer(playerId, toIndex) {
    const ids = view.players.map((p) => p.id).filter((id) => id !== playerId);
    ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, playerId);
    action('reorder_players', { playerIds: ids });
  }

  // Drag and drop in any turn-order list: drop a row onto another to take its place.
  let draggedId = null;
  const orderListOf = (event) => event.target.closest?.('.order-list');
  document.addEventListener('dragstart', (event) => {
    const row = event.target.closest?.('.order-list .order-row');
    if (!row) return;
    draggedId = row.dataset.id;
    row.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedId);
  });
  document.addEventListener('dragover', (event) => {
    const list = orderListOf(event);
    const row = event.target.closest?.('.order-row');
    if (!draggedId || !list || !row) return;
    event.preventDefault();
    for (const r of list.querySelectorAll('.drop-target')) r.classList.remove('drop-target');
    if (row.dataset.id !== draggedId) row.classList.add('drop-target');
  });
  document.addEventListener('drop', (event) => {
    const row = event.target.closest?.('.order-list .order-row');
    if (!draggedId || !row) return;
    event.preventDefault();
    const toIndex = view.players.findIndex((p) => p.id === row.dataset.id);
    if (row.dataset.id !== draggedId && toIndex >= 0) movePlayer(draggedId, toIndex);
  });
  document.addEventListener('dragend', () => {
    draggedId = null;
    for (const r of document.querySelectorAll('.order-list .dragging, .order-list .drop-target')) {
      r.classList.remove('dragging', 'drop-target');
    }
  });

  // ---------- game stage ----------

  const SIDE_PANEL_W = 360;
  const SIDE_PANEL_MIN_WIDTH = 1000;

  function renderStage() {
    const game = view.game;
    const stage = $('stage');
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const myTurn = game.roundActive && game.currentPlayerId === view.youId;
    stage.classList.toggle('my-turn', myTurn);

    // The turn moved on while the color wheel was open: close it.
    if (pendingWildId && !myTurn) {
      pendingWildId = null;
      $('color-dialog').hidden = true;
    }

    $('stage-code').textContent = view.code;
    const stillIn = game.players.filter((p) => p.place == null).length;
    const modeLabel = MODE_LABEL[game.mode];
    $('stage-status').textContent = modeLabel
      ? `${modeLabel} · ${stillIn} of ${game.players.length} still playing`
      : `${game.players.length} players`;

    // An open Log or Chat panel docks on the right; on a wide screen the game moves over to make room
    // (on a narrow one the panel covers the table instead).
    const panelOpen = panelShowing('game-log-panel') || panelShowing('game-chat-panel');
    const panelW = panelOpen && W >= SIDE_PANEL_MIN_WIDTH ? SIDE_PANEL_W : 0;
    stage.classList.toggle('panel-docked', panelW > 0);
    stage.style.setProperty('--panel-w', `${panelW}px`);
    const areaW = W - panelW;

    // Wide screens: the other players are tiles in a column on the left (their video when they're on camera),
    // each with its cards fanned out beside it; the table sits to the right of that column.
    const columns = areaW >= COLUMN_MIN_WIDTH && H >= COLUMN_MIN_HEIGHT;
    stage.classList.toggle('column-layout', columns);
    columnsOn = columns;

    // In the video call on a wide screen, the videos get a column on each side and the table sits between them.
    railsOn = call.active && areaW >= RAILS_MIN_WIDTH;
    const railWidth = railsOn ? railWidthFor(areaW, H) : 0;
    stage.classList.toggle('with-rails', railsOn);
    stage.style.setProperty('--rail-w', `${railWidth}px`);
    renderVideoRails(game);
    const tableW = areaW - 2 * railWidth;

    // Layout: the middle of the table sits a little above the centre of the screen.
    const opponents = aroundMe(game.players).slice(1);
    if (columns) {
      renderColumnStage(game, opponents, areaW, H, myTurn, railWidth);
      return;
    }
    stage.style.removeProperty('--table-x');
    const compact = opponents.length > 4 || tableW < 700;
    const center = { x: areaW / 2, y: H * (compact ? 0.45 : 0.44) };
    const radius = {
      x: Math.min(tableW * 0.38, tableW / 2 - (compact ? 60 : 120)),
      y: H * (compact ? 0.28 : 0.31),
    };

    const swirl = $('swirl');
    // Wide, because tilting it flat onto the table squashes it to about half its height.
    const swirlSize = Math.min(tableW * 0.4, H * 0.72);
    swirl.style.cssText = `left:${center.x}px;top:${center.y}px;width:${swirlSize}px;height:${swirlSize}px`;
    swirl.classList.toggle('ccw', game.direction === -1);
    swirl.dataset.color = game.currentColor ?? '';

    renderOpponents(game, opponents, center, radius, compact);

    const middle = $('stage-center');
    middle.style.left = `${center.x}px`;
    middle.style.top = `${center.y}px`;
    middle.replaceChildren(...stageCenter(game, myTurn).filter(Boolean));

    renderTurnBanner(game, myTurn);
    $('my-badge').replaceChildren(badgeEl(playerInfo(game, game.players.find((p) => p.id === view.youId)), { large: true }));
    renderHand(game);
    renderActions(game, myTurn);
    renderDrawnPrompt(game, myTurn);
    renderPendingPrompt(game, myTurn);
    maybeAutoDraw(game, myTurn);
    animateDraws(game);
    animateDiscard(game, lastTurnPlayerId);
    lastTurnPlayerId = game.currentPlayerId;
    maybeCelebrate(game);
  }

  const COLUMN_MIN_WIDTH = 900;
  const COLUMN_MIN_HEIGHT = 520;

  /**
   * The wide-screen layout: a raised glass table in the middle, the other players' tiles seated around
   * its far side (smaller the farther away they sit), each with their cards lying on the table in front of them.
   */
  function renderColumnStage(game, opponents, areaW, H, myTurn, railWidth = 0) {
    const stage = $('stage');
    // The videos (if any) take a column on each side; the table and its seats fit between them.
    const tableW = areaW - 2 * railWidth;
    // Halfway between the seat across the table and the top of your hand.
    const center = { x: areaW / 2, y: Math.round((210 + H - 170) / 2) };
    const table = { rx: Math.min(tableW * (railWidth ? 0.4 : 0.34), 640), ry: Math.min(H * 0.25, 260) };
    stage.style.setProperty('--table-x', `${center.x}px`);
    stage.style.setProperty('--table-y', `${center.y}px`);
    stage.style.setProperty('--table-w', `${table.rx * 2}px`);
    stage.style.setProperty('--table-h', `${table.ry * 2}px`);
    stage.style.setProperty('--hand-w', `${Math.max(320, Math.min(960, tableW - 360))}px`);

    // The colour ring around the deck and discard; the direction arrows lie flat inside it.
    const ring = Math.round(Math.min(table.ry * 1.4, table.rx * 0.85, 270));
    stage.style.setProperty('--ring', `${ring}px`);
    stage.dataset.color = game.currentColor ?? '';
    const swirl = $('swirl');
    swirl.style.cssText = `left:${center.x}px;top:${center.y}px;width:${ring * 0.86}px;height:${ring * 0.86}px`;
    swirl.classList.toggle('ccw', game.direction === -1);
    swirl.dataset.color = game.currentColor ?? '';

    // Seats: each player's cards fanned above their avatar and name.
    // No video: round the far edge of the table (left, across, right). In the call: in a row along the top.
    const count = opponents.length;
    const cw = count > 4 ? 40 : 52;
    const nodes = [];
    opponents.forEach((p, k) => {
      let x;
      let y;
      if (railWidth) {
        const left = center.x - table.rx * 0.95;
        const span = table.rx * 1.9;
        x = count === 1 ? center.x : left + (k * span) / (count - 1);
        y = Math.max(150, center.y - table.ry - 30);
      } else {
        const [from, to] = count > 3 ? [175, 365] : [180, 360];
        const deg = count === 1 ? 270 : from + (k * (to - from)) / (count - 1);
        const t = (deg * Math.PI) / 180;
        x = center.x + table.rx * 1.02 * Math.cos(t);
        y = center.y + table.ry * 1.1 * Math.sin(t);
      }
      x = Math.min(Math.max(x, railWidth + 100), areaW - railWidth - 100);
      y = Math.max(y, 190);
      const info = playerInfo(game, p);
      nodes.push(playerTile(info, { x, y, scale: 1 }));

      // Their cards, upright above their name: every card shown, packed tighter as the hand grows.
      const fanY = y - 36;
      if (p.revealedHand) {
        if (p.revealedHand.length) {
          nodes.push(h('div', { class: 'reveal seat-fan', 'data-player': p.id, style: `left:${x}px;top:${fanY}px` }, revealRow(p.revealedHand, cw)));
        }
      } else if (p.cardCount > 0) {
        const fan = packedFanEl(p.cardCount, cw, cw * 3.4);
        fan.classList.add('opp-fan', 'seat-fan');
        fan.dataset.player = p.id;
        fan.style.cssText += `;left:${x}px;top:${fanY}px`;
        nodes.push(fan);
      }
    });
    slideIntoPlace($('opponents'), nodes);


    const middle = $('stage-center');
    middle.style.left = `${center.x}px`;
    middle.style.top = `${center.y}px`;
    middle.replaceChildren(...stageCenter(game, myTurn).filter(Boolean));

    renderTurnBanner(game, myTurn);
    $('my-badge').replaceChildren(badgeEl(playerInfo(game, game.players.find((p) => p.id === view.youId)), { large: true }));
    renderHand(game);
    renderActions(game, myTurn);
    renderDrawnPrompt(game, myTurn);
    renderPendingPrompt(game, myTurn);
    maybeAutoDraw(game, myTurn);
    animateDraws(game);
    animateDiscard(game, lastTurnPlayerId);
    lastTurnPlayerId = game.currentPlayerId;
    maybeCelebrate(game);
  }

  /** Another player's seat at the table: avatar, name and how many cards they hold. (Videos are in the side columns.) */
  function playerTile(info, box) {
    const finished = info.place !== null && info.place !== undefined;
    const classes = ['opp-tile', info.turn ? 'turn' : '', finished ? 'finished' : '', info.connected ? '' : 'away'];
    const player = view.players.find((q) => q.id === info.id);
    const micOff = player?.media?.joined && !player.media.mic;
    return h('div', {
      class: classes.filter(Boolean).join(' '),
      'data-player': info.id,
      'data-tip': `Throw something at ${info.name}`,
      style: `left:${box.x}px;top:${box.y}px;--seat-scale:${box.scale}`,
    },
    avatarEl('pb-avatar', info.name, avatarOf(info.id)),
    h('span', { class: 'tile-text' },
      h('span', { class: 'tile-name' }, info.name, info.id === view.hostId ? h('span', { class: 'tile-host', 'aria-label': 'Host' }) : null),
      finished ? h('span', { class: 'tile-count' }, placeLabel(info.place)) : null),
    micOff ? h('span', { class: 'tile-muted', 'aria-label': 'Microphone off' }, 'Muted') : null,
    info.connected ? null : h('span', { class: 'tile-away' }, 'Away'),
    info.uno ? h('span', { class: 'bubble' }, 'UNO!') : null,
    info.catchable ? h('button', { type: 'button', class: 'catch', onclick: () => action('catch_uno', { targetId: info.id }) }, 'Catch!') : null,
    info.turn ? h('i', { class: 'tile-timer', 'aria-hidden': 'true' }) : null);
  }

  function playerInfo(game, p) {
    return {
      id: p.id,
      name: p.name,
      cardCount: p.cardCount,
      score: p.score,
      place: p.place,
      connected: view.players.find((q) => q.id === p.id)?.connected ?? false,
      turn: game.roundActive && game.currentPlayerId === p.id,
      uno: p.calledUno && p.cardCount === 1,
      catchable: game.roundActive && p.id !== view.youId && game.unoExposedId === p.id && p.cardCount === 1 && !p.calledUno,
    };
  }

  /**
   * Opponents sit around the top half, clockwise from your left, like the console game.
   * Up to 4 opponents get a full fan of cards turned toward the middle; more than that
   * (or a phone) switches to compact badges with a small fan.
   */
  // Card width and most cards shown in an opponent's fan, by number of opponents (cards are a little
  // larger than flat, since tilting the fan back shortens them).
  const FAN_SIZES = [
    { cw: 52, maxShown: 12 },
    { cw: 52, maxShown: 12 }, // 1 opponent
    { cw: 50, maxShown: 10 }, // 2
    { cw: 46, maxShown: 7 }, // 3
    { cw: 42, maxShown: 5 }, // 4
  ];

  function renderOpponents(game, opponents, center, radius, compact) {
    const count = opponents.length;
    const [start, end] = compact ? [165, 375] : [180, 360];
    const nodes = [];

    opponents.forEach((p, k) => {
      const deg = count === 1 ? 270 : start + (k * (end - start)) / (count - 1);
      const t = (deg * Math.PI) / 180;
      const x = center.x + radius.x * Math.cos(t);
      const y = center.y + radius.y * Math.sin(t);
      const info = playerInfo(game, p);
      const catchBtn = info.catchable
        ? h('button', { type: 'button', class: 'catch', onclick: () => action('catch_uno', { targetId: p.id }) }, 'Catch!')
        : null;

      // Once the game is over, everyone's leftover cards are shown face up instead of the face-down fan.
      const revealed = p.revealedHand;

      if (compact) {
        let cards = null;
        // A full table on a wide screen has room for bigger cards; a phone keeps them small.
        const roomy = $('stage').clientWidth >= 1000;
        if (revealed) cards = revealed.length ? revealRow(revealed, roomy ? 30 : 22) : null;
        else if (p.cardCount > 0) cards = roomy ? fanEl(p.cardCount, 28, 7) : fanEl(p.cardCount, 16, 8);
        nodes.push(h('div', { class: 'opp-compact', 'data-player': p.id, style: `left:${x}px;top:${y}px` },
          badgeEl(info, { vertical: true }),
          cards,
          catchBtn));
        return;
      }

      // Full fan, rotated so the cards point at the middle of the table. The more opponents, the
      // fewer and smaller the cards in each fan, so neighbours don't run into each other or off the screen.
      // (The badge shows the exact count.)
      const { cw, maxShown } = FAN_SIZES[Math.min(count, FAN_SIZES.length - 1)];
      const shown = Math.min(p.cardCount, maxShown);
      const fanLength = cw + Math.max(0, shown - 1) * cw * 0.4;
      if (revealed) {
        if (revealed.length) {
          nodes.push(h('div', { class: 'reveal', 'data-player': p.id, style: `left:${x}px;top:${y}px` }, revealRow(revealed, 38)));
        }
      } else if (shown > 0) {
        const fan = fanEl(p.cardCount, cw, maxShown);
        fan.classList.add('opp-fan');
        fan.dataset.player = p.id;
        // Turn the fan to face the middle, then tip it back in perspective so it lies on the table.
        fan.style.cssText += `;left:${x}px;top:${y}px;`
          + `transform:translate(-50%,-50%) rotate(${deg - 90}deg) perspective(190px) rotateX(58deg)`;
        // Turn each card's "UNO" logo back by the same amount so it reads upright from your seat.
        fan.style.setProperty('--counter', `${90 - deg}deg`);
        nodes.push(fan);
      }
      // The badge sits just past the end of the fan, following the direction of play.
      const tx = -Math.sin(t);
      const ty = Math.cos(t);
      const offset = fanLength / 2 + Math.abs(tx) * 90 + Math.abs(ty) * 36 + 14;
      nodes.push(h('div', { class: 'opp-badge', 'data-player': p.id, style: `left:${x + tx * offset}px;top:${y + ty * offset}px` },
        badgeEl(info),
        catchBtn));
    });

    slideIntoPlace($('opponents'), nodes);
  }

  /** A player's leftover cards laid face up in a row, flipping over one after another. */
  function revealRow(cards, cardWidth) {
    return h('div', { class: 'reveal-row', style: `--reveal-cw:${cardWidth}px` },
      ...[...cards].sort(compareCards).slice(0, 14).map((card, i) => {
        const el = cardEl(card);
        el.style.setProperty('--i', String(i));
        return el;
      }));
  }

  function fanEl(count, cardWidth, maxShown) {
    const shown = Math.min(count, maxShown);
    const step = shown > 1 ? Math.min(6, 44 / shown) : 0;
    return h('div', { class: 'fan', style: `--fan-cw:${cardWidth}px`, 'data-tip': `${count} cards` },
      ...Array.from({ length: shown }, (_, i) => {
        const back = cardBack();
        back.style.setProperty('--rot', `${(i - (shown - 1) / 2) * step}deg`);
        return back;
      }));
  }

  /** A fan with one back per card in the hand, squeezed to stay within maxWidth however many there are. */
  function packedFanEl(count, cardWidth, maxWidth) {
    const step = count > 1 ? Math.min(cardWidth * 0.4, (maxWidth - cardWidth) / (count - 1)) : 0;
    const fan = fanEl(count, cardWidth, count);
    fan.style.setProperty('--fan-step', `${step}px`);
    fan.classList.add('packed');
    for (const [i, back] of [...fan.children].entries()) {
      back.style.setProperty('--rot', `${(i - (count - 1) / 2) * Math.min(4, 40 / count)}deg`);
    }
    return fan;
  }

  function badgeEl(info, { large = false, vertical = false } = {}) {
    const isMe = info.id === view.youId;
    const finished = info.place !== null && info.place !== undefined;
    const classes = [
      'pbadge',
      large ? 'large' : '',
      vertical ? 'vertical' : '',
      info.turn ? 'turn' : '',
      finished ? 'finished' : '',
      info.connected ? '' : 'away',
    ];
    return h('div', { class: classes.filter(Boolean).join(' ') },
      h('div', { class: 'pb-ring' },
        railsOn || columnsOn
          ? avatarEl('pb-avatar', info.name, avatarOf(info.id), { editable: isMe && large })
          : withVideo(info.id, avatarEl('pb-avatar', info.name, avatarOf(info.id), { editable: isMe && large })),
        info.id === view.hostId ? h('span', { class: 'host-tag', 'data-tip': 'Host' }, '★') : null),
      h('div', { class: 'pb-body' },
        h('div', { class: 'pb-name', 'data-tip': info.name }, info.name, isMe ? h('span', { class: 'pb-you' }, 'you') : null),
        h('div', { class: 'pb-stats' },
          finished
            ? h('span', { class: 'pb-place', 'data-tip': 'Finished' }, placeLabel(info.place))
            : h('span', { class: 'pb-count', 'data-tip': 'Cards in hand', 'aria-label': `${info.cardCount} cards in hand` },
              h('span', { class: 'pb-count-card', 'aria-hidden': 'true' }),
              h('b', {}, String(info.cardCount)),
              h('span', { class: 'pb-count-word' }, info.cardCount === 1 ? 'card' : 'cards')),
          info.connected ? null : h('span', { class: 'pb-away' }, 'away'))),
      info.uno ? h('span', { class: 'bubble' }, 'UNO!') : null);
  }

  /** Keeps the last few discards with a stable, slightly random angle so the pile looks tossed. */
  function updateTrail(game) {
    if (game.roundNumber !== trailRound) {
      trail = [];
      trailRound = game.roundNumber;
    }
    for (const entry of trail) entry.fresh = false;
    const top = game.topCard;
    if (top && trail[trail.length - 1]?.card.id !== top.id) {
      const seed = hashString(top.id);
      trail.push({ card: top, rot: (seed % 40) - 20, dx: (seed % 13) - 6, dy: ((seed >> 4) % 11) - 5, fresh: true });
      if (trail.length > TRAIL_LENGTH) trail.shift();
    }
  }

  function stageCenter(game, myTurn) {
    updateTrail(game);

    const canDraw = myTurn && (Boolean(game.pending) || !game.drawnCardId);
    const drawLabel = game.pending ? `Take ${game.pending.count}` : 'Draw';
    const deck = h(canDraw ? 'button' : 'div', {
      class: `deck${canDraw ? ' can-draw' : ''}`,
      type: canDraw ? 'button' : null,
      'data-tip': canDraw ? drawLabel : `${game.drawPileCount} cards left`,
      'aria-label': canDraw ? drawLabel : `Deck, ${game.drawPileCount} cards left`,
      onclick: canDraw ? () => action('draw_card') : null,
    },
    cardBack('deck-card d3'),
    cardBack('deck-card d2'),
    cardBack('deck-card d1'),
    h('span', { class: 'deck-count' }, canDraw ? drawLabel : String(game.drawPileCount)));

    const discard = h('div', { class: 'discard', 'data-tip': game.topCard ? describe(game.topCard) : '' },
      ...trail.map((entry) => {
        const el = cardEl(entry.card);
        el.classList.add('trail');
        el.dataset.trail = entry.card.id;
        if (entry.card.id === discardFlightId) el.classList.add('incoming');
        el.style.setProperty('--t', `translate(${entry.dx}px, ${entry.dy}px) rotate(${entry.rot}deg)`);
        return el;
      }));

    const latest = game.log.at(-1)?.text ?? '';
    const announce = h('div', { class: `announce${latest !== lastAnnouncement ? ' pop' : ''}` }, latest);
    lastAnnouncement = latest;

    const colour = game.currentColor;
    return [
      colour ? h('div', { class: `colour-chip c-${colour}` }, h('span', { class: 'colour-dot', 'aria-hidden': 'true' }), `Colour: ${COLOR_LABEL[colour]}`) : null,
      h('div', { class: 'piles' },
        h('div', { class: 'pile' }, deck, h('span', { class: 'pile-label' }, 'Deck')),
        h('div', { class: 'pile' }, discard, h('span', { class: 'pile-label' }, 'Discard'))),
      game.pending ? h('div', { class: 'pending-chip' }, `+${game.pending.count} waiting`) : null,
      announce,
    ];
  }

  function renderTurnBanner(game, myTurn) {
    const current = game.players.find((p) => p.id === game.currentPlayerId);
    const me = game.players.find((p) => p.id === view.youId);
    let text;
    if (!game.roundActive) {
      text = "Game over! Everyone's cards are revealed";
    } else if (me?.place) {
      text = `You finished ${placeLabel(me.place)}! Watching the others… (${current?.name ?? ''}'s turn)`;
    } else if (!myTurn) {
      text = `${current?.name ?? 'Next player'}'s turn`;
    } else if (needsAutoDraw(game, myTurn)) {
      if (game.pending) text = `No way to answer: taking ${game.pending.count} cards…`;
      else if (me?.missedUno) text = 'You missed calling UNO: drawing a card for you…';
      else text = 'No card to play: drawing one for you…';
    } else if (game.pending) {
      const { stackCard } = pendingChoices(game);
      const options = ['draw', game.challengeable ? 'challenge' : null, stackCard ? 'stack' : null].filter(Boolean);
      text = options.length > 1 ? `Your turn! Choose: ${options.join(', ')}` : `Your turn! Click the deck to take ${game.pending.count}`;
    } else if (game.drawnCardId) {
      text = 'Your turn! Play the card you drew, or keep it';
    } else if (me?.cardCount === 1 && !me.calledUno && !me.missedUno) {
      text = 'Your turn! Press UNO! before your last card, or you draw 2';
    } else {
      text = 'Your turn!';
    }
    $('turn-text').textContent = text;
    $('turn-banner').classList.toggle('mine', myTurn);
  }

  function renderHand(game) {
    // Where each of your cards was before this update, so a card played for you (time ran out)
    // can still fly from your hand to the pile.
    lastHandRects.clear();
    for (const el of $('hand').querySelectorAll('[data-card]')) lastHandRects.set(el.dataset.card, el.getBoundingClientRect());
    const playable = new Set(game.playableIds);
    const hand = [...game.hand].sort(compareCards);
    const count = hand.length;
    // Big hands get a flatter fan so the outer cards stay on screen.
    const step = count > 1 ? Math.min(5, 36 / count) : 0;
    const handEl = $('hand');

    handEl.replaceChildren(...hand.map((card, i) => {
      const canPlay = playable.has(card.id);
      const el = cardEl(card, {
        playable: canPlay,
        drawn: card.id === game.drawnCardId,
        onClick: canPlay ? () => playCard(card) : null,
      });
      const offset = i - (count - 1) / 2;
      el.dataset.card = card.id;
      // A card still flying in from the deck stays hidden until it lands.
      if (flyingIds.has(card.id)) el.classList.add('incoming');
      el.style.setProperty('--rot', `${offset * step}deg`);
      el.style.setProperty('--drop', `${Math.min(Math.abs(offset) * Math.abs(offset) * 0.7, 14)}px`);
      return el;
    }));

    // Overlap the cards just enough that the whole hand fits the space, so it never needs a scrollbar.
    const cardWidth = handEl.firstElementChild?.offsetWidth ?? 96;
    // The outermost cards tilt outward (they turn about a point below the card), so leave room for that swing.
    const outerTilt = (step * Math.max(0, count - 1) / 2) * (Math.PI / 180);
    const swing = cardWidth * 1.5 * 1.3 * Math.sin(outerTilt);
    const room = handEl.clientWidth - 24 - 2 * swing; // inside the hand's side padding
    const relaxed = -cardWidth * 0.22;     // the gap for a small hand
    const fit = count > 1 ? (room - cardWidth) / (count - 1) - cardWidth : 0;
    handEl.style.setProperty('--overlap', `${Math.min(relaxed, fit)}px`);
  }

  // ---------- winner celebration ----------

  const CONFETTI_COLORS = ['#d7263d', '#f4c20d', '#2e9e4f', '#1f6fd1', '#ffffff'];
  const CONFETTI_PIECES = 120;
  const BANNER_MS = 3200;
  let celebratedFor = null; // the winner already celebrated in this game

  /** Celebrates once, as soon as someone takes 1st place. */
  function maybeCelebrate(game) {
    const winner = game.players.find((p) => p.place === 1);
    if (!winner || celebratedFor === winner.id) return;
    celebratedFor = winner.id;
    celebrate(winner.id === view.youId ? '🎉 You win!' : `🏆 ${winner.name} wins!`);
  }

  function clearCelebration() {
    for (const el of document.querySelectorAll('.celebrate-banner, .confetti')) el.remove();
  }

  /** A banner that pops in the middle of the screen, with confetti in the Uno colors. */
  function celebrate(text) {
    const banner = h('div', { class: 'celebrate-banner', role: 'status' }, text);
    document.body.append(banner);
    setTimeout(() => banner.remove(), BANNER_MS);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const layer = h('div', { class: 'confetti', 'aria-hidden': 'true' });
    document.body.append(layer);
    for (let i = 0; i < CONFETTI_PIECES; i++) {
      const piece = h('span', {
        class: 'confetti-piece',
        style: `left:${Math.random() * 100}%;background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]};`
          + `width:${6 + Math.random() * 6}px;height:${10 + Math.random() * 8}px`,
      });
      layer.append(piece);
      piece.animate([
        { transform: 'translate(0, -10vh) rotate(0deg)' },
        { transform: `translate(${(Math.random() - 0.5) * 30}vw, 110vh) rotate(${Math.random() * 1080 - 540}deg)` },
      ], { duration: 2200 + Math.random() * 1400, delay: Math.random() * 400, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)', fill: 'both' });
    }
    setTimeout(() => layer.remove(), 4200);
  }

  // ---------- draw animation ----------

  // Drawn cards travel slowly enough to read: lift and flip, a pause to show the card, then into the hand.
  const DRAW_FLIGHT_MS = 1500;
  const DRAW_STAGGER_MS = 700;    // one card after another when a couple are drawn
  // Many at once (the opening deal, taking +4 or a stack): quicker and overlapping, so it doesn't drag.
  const BULK_DRAW = { flight: 950, stagger: 220 };
  const OPPONENT_DRAW_MS = 900;
  const DISCARD_FLIGHT_MS = 750;  // a played card travelling to the discard pile
  const OPPONENT_FLIGHT_MAX = 3; // cards shown flying to an opponent at once, however many they draw
  let seenHand = null;           // card ids in your hand at the last render; null before the first one
  const seenCounts = new Map();  // opponent id -> card count at the last render
  const flyingIds = new Set();   // your cards still in the air
  const playedFrom = new Map();   // card id -> where it was in your hand when you played it
  const lastHandRects = new Map(); // card id -> where it sat in your hand before the latest update
  let discardFlightId = null;     // the played card on its way to the discard pile
  let lastTurnPlayerId = null;    // whose turn it was at the previous render (who just played)

  /** Compares with the last render and flies newly drawn cards from the deck. */
  function animateDraws(game) {
    const handIds = game.hand.map((c) => c.id);
    const newCards = game.hand.filter((c) => !seenHand?.has(c.id));
    seenHand = new Set(handIds);
    const grew = game.players
      .filter((p) => p.id !== view.youId)
      .map((p) => ({ id: p.id, more: p.cardCount - (seenCounts.get(p.id) ?? 0) }))
      .filter((p) => p.more > 0);
    for (const p of game.players) seenCounts.set(p.id, p.cardCount);

    const deck = document.querySelector('#stage-center .deck');
    if (!deck || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const from = deck.getBoundingClientRect();

    const bulk = newCards.length > 2;
    newCards.forEach((card, i) => {
      const target = $('hand').querySelector(`[data-card="${card.id}"]`);
      if (target) flyToHand(from, target, card, i * (bulk ? BULK_DRAW.stagger : DRAW_STAGGER_MS), bulk ? BULK_DRAW.flight : DRAW_FLIGHT_MS);
    });
    grew.forEach(({ id, more }, k) => {
      const target = $('opponents').querySelector(`.opp-fan[data-player="${id}"]`)
        ?? $('opponents').querySelector(`[data-player="${id}"]`);
      if (!target) return;
      for (let i = 0; i < Math.min(more, OPPONENT_FLIGHT_MAX); i++) {
        flyToOpponent(from, target, (k + i) * DRAW_STAGGER_MS);
      }
    });
  }

  /** A card leaves the deck face down, arcs up, flips over and lands in its place in your hand. */
  function flyToHand(from, target, card, delay, duration = DRAW_FLIGHT_MS) {
    const width = target.offsetWidth;
    const height = target.offsetHeight;
    const box = target.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const rot = Number.parseFloat(target.style.getPropertyValue('--rot')) || 0;
    const dx = from.left + from.width / 2 - cx;
    const dy = from.top + from.height / 2 - cy;
    const scale = from.width / width;

    flyingIds.add(card.id);
    target.classList.add('incoming');

    const front = cardEl(card);
    const back = cardBack();
    for (const face of [front, back]) {
      face.classList.add('fly-face');
      face.style.setProperty('--cw', `${width}px`);
    }
    back.classList.add('fly-back');
    const inner = h('div', { class: 'fly-inner' }, front, back);
    const fly = h('div', {
      class: 'fly',
      style: `left:${cx - width / 2}px;top:${cy - height / 2}px;width:${width}px;height:${height}px`,
    }, inner);
    document.body.append(fly);

    // Where it pauses to be seen: above the hand, between the deck and its slot, a little bigger.
    const handBox = $('hand').getBoundingClientRect();
    const showX = (handBox.left + handBox.width / 2 + (from.left + from.width / 2)) / 2 - cx;
    const showY = handBox.top - height * 0.75 - cy;
    const timing = { duration, delay, fill: 'both' };
    fly.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, easing: 'cubic-bezier(0.3, 0, 0.3, 1)' },
      { transform: `translate(${dx}px, ${dy - 26}px) scale(${scale * 1.06})`, offset: 0.1, easing: 'cubic-bezier(0.25, 0.7, 0.3, 1)' },
      { transform: `translate(${showX}px, ${showY}px) scale(1.45)`, offset: 0.42 },
      { transform: `translate(${showX}px, ${showY - 6}px) scale(1.5)`, offset: 0.66, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' },
      { transform: `rotate(${rot}deg)` },
    ], timing);
    // Face down off the deck, turning over on the way up so it's face up while it's shown.
    inner.animate([
      { transform: 'rotateY(180deg)' },
      { transform: 'rotateY(180deg)', offset: 0.12 },
      { transform: 'rotateY(0deg)', offset: 0.4 },
      { transform: 'rotateY(0deg)' },
    ], { ...timing, easing: 'ease-in-out' })
      .finished.then(() => {
        fly.remove();
        flyingIds.delete(card.id);
        const landed = $('hand').querySelector(`[data-card="${card.id}"]`);
        landed?.classList.remove('incoming');
        // A short glow so the new card stands out in the hand.
        landed?.animate([
          { boxShadow: '0 0 0 4px rgba(255, 220, 80, 0.95), 0 0 26px rgba(255, 220, 80, 0.9)', translate: '0 -14px' },
          { boxShadow: '0 0 0 0 rgba(255, 220, 80, 0)', translate: '0 0' },
        ], { duration: 900, easing: 'ease-out' });
      });
  }

  /** A face-down card flies from the deck to another player's seat and tucks into their hand. */
  function flyToOpponent(from, target, delay) {
    const box = target.getBoundingClientRect();
    const dx = box.left + box.width / 2 - (from.left + from.width / 2);
    const dy = box.top + box.height / 2 - (from.top + from.height / 2);
    const back = cardBack('fly-face');
    back.style.setProperty('--cw', `${from.width}px`);
    const fly = h('div', {
      class: 'fly',
      style: `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px`,
    }, back);
    document.body.append(fly);
    fly.animate([
      { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(0.75) rotate(-12deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.4) rotate(8deg)`, opacity: 0 },
    ], { duration: OPPONENT_DRAW_MS, delay, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)', fill: 'both' })
      .finished.then(() => fly.remove());
  }

  /**
   * The card just played travels to the discard pile from whoever played it (your hand, or their seat),
   * turning to its resting angle on the way. The real top card stays hidden until it arrives.
   */
  function animateDiscard(game, playedBy) {
    const entry = trail[trail.length - 1];
    if (!entry?.fresh || discardFlightId === entry.card.id) return;
    const pile = document.querySelector(`#stage-center .discard [data-trail="${entry.card.id}"]`);
    if (!pile || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let from = playedFrom.get(entry.card.id) ?? (playedBy === view.youId ? lastHandRects.get(entry.card.id) : null);
    playedFrom.clear();
    if (!from && playedBy && playedBy !== view.youId) {
      const seat = $('opponents').querySelector(`.opp-fan[data-player="${playedBy}"]`)
        ?? $('opponents').querySelector(`[data-player="${playedBy}"] .pb-avatar`)
        ?? $('opponents').querySelector(`[data-player="${playedBy}"]`);
      from = seat?.getBoundingClientRect();
    }
    if (!from) return;
    const to = pile.getBoundingClientRect();
    const width = pile.offsetWidth;
    const height = pile.offsetHeight;
    const fx = from.left + from.width / 2 - (to.left + to.width / 2);
    const fy = from.top + from.height / 2 - (to.top + to.height / 2);
    const startScale = playedBy === view.youId ? Math.max(0.6, from.width / width) : 0.55;
    const face = cardEl(entry.card);
    face.classList.add('fly-face');
    face.style.setProperty('--cw', `${width}px`);
    const fly = h('div', {
      class: 'fly',
      style: `left:${to.left + to.width / 2 - width / 2}px;top:${to.top + to.height / 2 - height / 2}px;width:${width}px;height:${height}px`,
    }, face);
    document.body.append(fly);
    discardFlightId = entry.card.id;
    pile.classList.add('incoming');
    fly.animate([
      { transform: `translate(${fx}px, ${fy}px) scale(${startScale}) rotate(0deg)` },
      { transform: `translate(${fx * 0.4}px, ${fy * 0.4 - 50}px) scale(1.25) rotate(${entry.rot / 2}deg)`, offset: 0.55 },
      { transform: `translate(${entry.dx}px, ${entry.dy}px) scale(1) rotate(${entry.rot}deg)` },
    ], { duration: DISCARD_FLIGHT_MS, easing: 'cubic-bezier(0.25, 0.7, 0.3, 1)', fill: 'both' })
      .finished.then(() => {
        fly.remove();
        discardFlightId = null;
        document.querySelector(`#stage-center .discard [data-trail="${entry.card.id}"]`)?.classList.remove('incoming');
      });
  }

  function renderActions(game, myTurn) {
    const me = game.players.find((p) => p.id === view.youId);
    const buttons = [];
    // Too late once the next player has moved (missedUno): no button, the player has to draw.
    if (me && me.cardCount === 1 && !me.calledUno && !me.missedUno && game.roundActive) {
      buttons.push(h('button', { type: 'button', class: 'uno-btn', onclick: () => action('call_uno') }, 'UNO!'));
    }
    // Drawing (or taking the cards owed) is done by clicking the glowing deck; there is no Draw or Pass button.
    $('actions').replaceChildren(...buttons);
  }

  /** Shows the drawn card with Play it / Keep it when the card you just drew can be played. */
  function renderDrawnPrompt(game, myTurn) {
    const card = myTurn && game.drawnCardId ? game.hand.find((c) => c.id === game.drawnCardId) : null;
    const show = Boolean(card) && !pendingWildId;
    $('drawn-prompt').hidden = !show;
    if (!show) return;
    const shown = $('drawn-card').firstElementChild;
    if (shown?.dataset.card !== card.id) {
      const el = cardEl(card);
      el.dataset.card = card.id;
      $('drawn-card').replaceChildren(el);
    }
    $('drawn-note').textContent = game.topCard ? `${describe(card)} goes on the ${describe(game.topCard).toLowerCase()}.` : '';
    $('drawn-play').onclick = () => playCard(card);
    $('drawn-keep').onclick = () => action('pass_turn');
  }

  /**
   * A Draw Two or Wild Draw Four played on you, when you have a choice: take the cards,
   * challenge (Wild Draw Four only), or stack your own card of the same kind (when stacking is on).
   */
  function pendingChoices(game) {
    const pending = game.pending;
    const stackCard = pending ? game.hand.find((c) => game.playableIds.includes(c.id) && c.value === pending.kind) : null;
    return { stackCard };
  }

  function renderPendingPrompt(game, myTurn) {
    const pending = myTurn ? game.pending : null;
    const { stackCard } = pendingChoices(game);
    const show = Boolean(pending) && (game.challengeable || Boolean(stackCard)) && !pendingWildId;
    $('pending-prompt').hidden = !show;
    if (!show) return;
    const from = game.players.find((p) => p.id === pending.from)?.name ?? 'Someone';
    const isFour = pending.kind === 'wild4';
    const fromPlayer = game.players.find((p) => p.id === pending.from);
    $('pending-title').replaceChildren(
      fromPlayer ? avatarEl('pending-avatar', fromPlayer.name, avatarOf(fromPlayer.id)) : '',
      h('span', {}, h('b', {}, from), ' hit you with a', h('br'), h('b', {}, isFour ? 'Wild Draw Four!' : 'Draw Two!')));
    const top = game.topCard;
    const shown = $('pending-card').firstElementChild;
    if (top && shown?.dataset.card !== top.id) {
      const el = cardEl(top);
      el.dataset.card = top.id;
      $('pending-card').replaceChildren(el);
    }
    // Short and direct: name the colour they might have had, then what each outcome costs.
    const colour = pending.prevColor;
    $('pending-hint').replaceChildren(...(game.challengeable
      ? [
        h('span', { class: 'pending-question' }, `Think ${from} has a `,
          colour ? h('b', { class: `colour-word c-${colour}` }, COLOR_LABEL[colour].toLowerCase()) : 'matching',
          ' card?'),
        h('span', { class: 'pending-stakes' },
          h('span', { class: 'stake-right' }, `Right: ${from} draws ${pending.count}`),
          h('span', { class: 'stake-wrong' }, `Wrong: you draw ${pending.count + 2}`)),
      ]
      : []));
    $('pending-hint').hidden = !game.challengeable;
    $('pending-actions').replaceChildren(...[
      h('button', { type: 'button', class: 'btn-chunky yellow', onclick: () => action('draw_card') }, `Draw ${pending.count}`),
      game.challengeable
        ? h('button', { type: 'button', class: 'btn-chunky blue', onclick: () => action('challenge') }, 'Challenge')
        : null,
      stackCard
        ? h('button', { type: 'button', class: 'btn-chunky yellow', onclick: () => playCard(stackCard) }, `Stack ${isFour ? '+4' : '+2'}`)
        : null,
    ].filter(Boolean));
  }

  // When it's your turn and you have nothing to play, the game draws for you after a moment.
  // (A Draw Two you can't answer is taken the same way; a Wild Draw Four waits, since you may challenge.)
  const AUTO_DRAW_MS = 900;
  let autoDrawTimer = 0;

  function needsAutoDraw(game, myTurn) {
    return myTurn && game.playableIds.length === 0 && !game.drawnCardId && !game.challengeable;
  }

  function maybeAutoDraw(game, myTurn) {
    if (!needsAutoDraw(game, myTurn)) {
      clearTimeout(autoDrawTimer);
      autoDrawTimer = 0;
      return;
    }
    if (autoDrawTimer) return;
    autoDrawTimer = setTimeout(() => {
      autoDrawTimer = 0;
      const game = view?.game;
      const stillMyTurn = game?.roundActive && game.currentPlayerId === view.youId;
      if (game && needsAutoDraw(game, stillMyTurn)) action('draw_card');
    }, AUTO_DRAW_MS);
  }

  // ---------- results ----------

  const cardsText = (n) => `${n} card${n === 1 ? '' : 's'}`;

  function resultDetail(mode, row) {
    if (row.cardsLeft === 0) {
      return mode === 'first' ? 'Went out first' : `Finished ${ordinal(row.place)}`;
    }
    if (mode === 'last') return `Left holding ${cardsText(row.cardsLeft)} (${row.handPoints} pts)`;
    return `${cardsText(row.cardsLeft)} left · ${row.handPoints} pts in hand`;
  }

  function resultsTitle(result) {
    const me = result.ranking.find((r) => r.id === view.youId);
    if (!me) return `${result.winnerName} wins!`;
    if (me.place === 1) return 'You win! 🎉';
    if (result.mode === 'last' && me.cardsLeft > 0) return 'Left holding cards!';
    return `You finished ${ordinal(me.place)}`;
  }

  function showResults(result) {
    // The "You win!" banner and confetti are done by now: clear them so they never sit over the scorecard.
    clearCelebration();
    $('results-title').textContent = resultsTitle(result);
    $('results-mode').textContent = MODE_LABEL[result.mode];
    // The podium: 2nd, 1st, 3rd from left to right, each on a block as tall as their place.
    const podium = [result.ranking[1], result.ranking[0], result.ranking[2]].filter(Boolean);
    $('results-podium').replaceChildren(...podium.map((row) => h('div', { class: `podium-spot place-${row.place}` },
      avatarEl('podium-avatar', row.name, avatarOf(row.id)),
      h('div', { class: 'podium-block' },
        h('span', { class: 'podium-name' }, row.name),
        h('span', { class: 'podium-pts' }, `+${row.score} pts`),
        h('span', { class: 'podium-place' }, String(row.place))))));
    $('results-list').replaceChildren(...result.ranking.map((row) => {
      const isMe = row.id === view.youId;
      const isLoser = result.mode === 'last' && row.cardsLeft > 0;
      return h('li', { class: `result-row place-${row.place}${isMe ? ' me' : ''}${isLoser ? ' loser' : ''}` },
        h('span', { class: 'result-place' }, String(row.place)),
        // Their current avatar (initials if they have left the room since).
        avatarEl('result-avatar', row.name, avatarOf(row.id)),
        h('span', { class: 'result-who' },
          h('span', { class: 'result-name' }, isMe ? `${row.name} (you)` : row.name),
          h('span', { class: 'result-detail' }, resultDetail(result.mode, row)),
          row.hand?.length ? revealRow(row.hand, 24) : null),
        isLoser ? h('span', { class: 'result-tag' }, 'Loser') : null,
        h('span', { class: 'result-score' }, `+${row.score}`));
    }));
    renderResultsActions();
    $('results-dialog').hidden = false;
  }

  /** The host gets "Start new game"; everyone else waits for the host. Re-run if the host changes. */
  function renderResultsActions() {
    const isHost = view.hostId === view.youId;
    const host = view.players.find((p) => p.id === view.hostId);
    const leave = h('button', { type: 'button', class: 'btn-chunky results-leave', onclick: leaveRoom }, 'Leave room');
    const enoughPlayers = view.players.length >= 2;

    if (isHost) {
      $('results-actions').replaceChildren(...[
        leave,
        enoughPlayers ? null : h('p', { class: 'results-wait' }, 'Waiting for at least one more player to join.'),
        h('button', {
          type: 'button',
          class: 'btn-chunky yellow',
          disabled: !enoughPlayers,
          onclick: () => action('play_again'),
        }, 'Start new game'),
      ].filter(Boolean));
      return;
    }
    $('results-actions').replaceChildren(
      leave,
      h('p', { class: 'results-wait' },
        h('span', { class: 'wait-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
        `Waiting for ${host?.name ?? 'the host'} to start a new game…`),
    );
  }

  // Closing the scorecard leaves you in the room to wait for players; "View results" brings it back.
  function closeResults() {
    $('results-dialog').hidden = true;
  }

  $('results-close').addEventListener('click', closeResults);
  $('results-dialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeResults();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeResults();
  });

  // ---------- log and chat ----------

  const scrollToEnd = (el) => {
    el.scrollTop = el.scrollHeight;
  };

  function renderLog() {
    const entries = view.game?.log ?? [];
    // In-game log: each move shows the card played (or the backs of cards drawn); the latest move stands out.
    const gameLog = $('game-log');
    gameLog.replaceChildren(...entries.map(({ text, card, drew }) => {
      const pic = logPicture(card, drew, text);
      return h('li', { class: pic ? 'has-pic' : '' }, ...[pic, h('span', { class: 'log-text' }, text)].filter(Boolean));
    }));
    scrollToEnd(gameLog);
  }

  function logPicture(card, drew, text) {
    if (card) {
      const el = cardEl(card);
      // A Wild gets a ring in the color that was chosen.
      const chosen = card.color === 'wild' && text.match(/chose (red|yellow|green|blue)/)?.[1];
      if (chosen) el.style.setProperty('--chosen', `var(--${chosen})`);
      return h('span', { class: `log-pic${chosen ? ' chosen' : ''}` }, el);
    }
    if (!drew) return null;
    // Drawn cards stay hidden: show a card back, with the count when there is more than one.
    return h('span', { class: 'log-pic drew' }, ...[cardBack(), drew > 1 ? h('b', { class: 'log-count' }, `+${drew}`) : null].filter(Boolean));
  }

  const chatTime = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  /** A chat bubble: other people's on the left with their avatar, yours on the right in yellow. */
  function chatMessageEl(message) {
    const sender = view.players.find((p) => p.name === message.from);
    const mine = sender?.id === view.youId;
    return h('div', { class: `chat-msg${mine ? ' mine' : ''}` },
      mine ? null : avatarEl('chat-avatar', message.from, sender?.avatar ?? null),
      h('div', { class: 'chat-bubble' },
        mine ? null : h('span', { class: 'chat-name' }, message.from),
        h('span', { class: 'chat-text' }, message.text),
        h('time', { class: 'chat-time' }, chatTime(message.at))));
  }

  function renderChat() {
    for (const id of ['chat-log', 'game-chat-log']) {
      const log = $(id);
      log.replaceChildren(...(view.chat.length
        ? view.chat.map(chatMessageEl)
        : [h('p', { class: 'chat-empty' }, 'No messages yet. Say hi! 👋')]));
      scrollToEnd(log);
    }
    // Messages count as read when you can see them: in the lobby, or with the in-game chat open.
    const playing = view.status === 'playing' && Boolean(view.game);
    if (!playing || !$('game-chat-panel').hidden) chatSeenAt = Date.now();
    renderUnread();
  }

  function renderUnread() {
    const unread = view ? view.chat.filter((m) => m.at > chatSeenAt).length : 0;
    $('chat-unread').hidden = unread === 0;
    $('chat-unread').textContent = String(unread);
  }

  // ---------- cards ----------

  function rememberPlayedFrom(cardId) {
    const el = $('hand').querySelector(`[data-card="${cardId}"]`) ?? $('drawn-card').firstElementChild;
    if (el) playedFrom.set(cardId, el.getBoundingClientRect());
  }

  function playCard(card) {
    rememberPlayedFrom(card.id);
    if (card.color === 'wild') {
      pendingWildId = card.id;
      $('color-dialog').hidden = false;
      return;
    }
    action('play_card', { cardId: card.id });
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    node.append(...children);
    return node;
  }

  /**
   * The back of a card. The logo is drawn in a 100 x 150 box: an oval, and "UNO" squeezed to a fixed
   * width (textLength) so it always sits inside the oval, with a solid shadow copy just behind it.
   */
  function cardBack(extraClass) {
    const word = (className, dx, dy) => svgEl('text', {
      class: className,
      x: 50 + dx,
      y: 75 + dy,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      textLength: 64,
      lengthAdjust: 'spacingAndGlyphs',
    }, 'UNO');
    const logo = svgEl('svg', { class: 'back-logo', viewBox: '0 0 100 150', 'aria-hidden': 'true' },
      svgEl('g', { class: 'back-logo-turn' },
        svgEl('ellipse', { class: 'back-oval', cx: 50, cy: 75, rx: 45, ry: 27 }),
        word('back-word back-word-shadow', 1.6, 2.2),
        word('back-word', 0, 0)));
    return h('div', { class: `card back ${extraClass ?? ''}` }, logo);
  }

  function cardEl(card, { playable = false, drawn = false, onClick = null } = {}) {
    const face = FACE[card.value] ?? card.value;
    const props = {
      class: `card c-${card.color}${playable ? ' playable' : ''}${drawn ? ' drawn' : ''}`,
      'data-tip': describe(card),
      onclick: onClick,
    };
    const body = [
      h('span', { class: 'corner' }, face),
      h('span', { class: 'center' }, face),
      h('span', { class: 'corner br' }, face),
    ];
    return onClick ? h('button', { type: 'button', ...props }, ...body) : h('div', props, ...body);
  }

  /** Updates the turn countdown text and the sweeping ring on the current player's badge. */
  function updateClock() {
    const game = view?.game;
    const live = Boolean(view?.turnDeadline && game?.roundActive);
    // While drawn cards are still flying to a hand the deadline is further away than a full turn:
    // the clock shows the full time and only starts counting once they have landed.
    const remainingMs = live ? Math.min(view.settings.turnSeconds * 1000, Math.max(0, view.turnDeadline - Date.now())) : 0;
    $('timer').textContent = live ? `${Math.ceil(remainingMs / 1000)}s` : '';
    // The color wheel shows how long is left to choose, and which color it will pick if time runs out.
    const choosing = pendingWildId && !$('color-dialog').hidden;
    const seconds = Math.ceil(remainingMs / 1000);
    $('color-timer').textContent = live && choosing ? `${seconds}s left, else ${COLOR_LABEL[mostHeldColor()]}` : '';
    $('color-bar-fill').style.width = live && choosing ? `${Math.min(100, (remainingMs / (view.settings.turnSeconds * 1000)) * 100)}%` : '0%';
    $('color-timer').classList.toggle('urgent', live && seconds <= 3);
    if (live && choosing && remainingMs <= AUTO_PICK_MS) chooseWildColor(mostHeldColor());
    if (!live) return;
    const fraction = String(remainingMs / (view.settings.turnSeconds * 1000));
    for (const ring of document.querySelectorAll('.pbadge.turn .pb-ring, .opp-tile.turn, #my-badge .pbadge.turn')) ring.style.setProperty('--p', fraction);
    $('timer').style.setProperty('--p', fraction);
  }
  setInterval(updateClock, 250);

  playIntro();
  render();
})();
