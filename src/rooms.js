'use strict';

const crypto = require('node:crypto');
const { UnoGame, MODES } = require('./game');
const { UnoError } = require('./errors');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const TURN_SECONDS = 10; // every move has the same fixed time
const GAME_OVER_REVEAL_MS = 5200; // long enough for the winner's celebration to play out
// A host who drops offline gets this long to come back (for example after a page refresh) before
// another player becomes host. A host who clicks Leave is replaced straight away.
const HOST_HANDOVER_MS = 10 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
const CODE_LENGTH = 6;
const MAX_NAME_LENGTH = 16;
const MAX_CHAT_LENGTH = 200;
const CHAT_HISTORY = 100;
// Things players can throw at each other during a game (just for fun; no effect on the rules).
const THROWABLES = ['tomato', 'egg', 'heart'];
const LOBBY_DISCONNECT_MS = 2 * 60 * 1000;
const EMPTY_ROOM_MS = 5 * 60 * 1000;
const LOBBY_IDLE_MS = 30 * 60 * 1000;
// Avatar choices. Keep in sync with AVATAR_CHARACTERS in public/app.js.
// Character pictures, served from public/avatars/<id>.webp.
const AVATAR_IMAGES = [
  'luffy', 'zoro', 'nami', 'usopp', 'sanji', 'chopper', 'robin',
  'naruto', 'sasuke', 'sakura', 'kakashi', 'hinata', 'jiraiya', 'tsunade',
  'eren', 'mikasa', 'armin', 'levi', 'hange', 'erwin', 'sasha',
  'deku', 'uraraka', 'bakugo', 'todoroki', 'tsuyu', 'momo', 'all-might',
  'jackie', 'jade', 'uncle', 'tohru', 'viper', 'el-toro', 'captain-black',
];

function normalizeName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
    throw new UnoError(`Name must be 1 to ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

function normalizeSettings(input = {}) {
  const settings = {
    maxPlayers: Number(input.maxPlayers ?? MAX_PLAYERS),
    mode: String(input.mode ?? 'last'),
    turnSeconds: TURN_SECONDS,
    stacking: Boolean(input.stacking),
  };
  if (!Number.isInteger(settings.maxPlayers) || settings.maxPlayers < MIN_PLAYERS || settings.maxPlayers > MAX_PLAYERS) {
    throw new UnoError(`A room holds ${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
  }
  if (!MODES.includes(settings.mode)) throw new UnoError('Pick a valid game mode');
  return settings;
}

/** A character picture from the list above, or none (the player's initials are shown). */
function normalizeAvatar(input) {
  return { image: AVATAR_IMAGES.includes(input?.image) ? input.image : null };
}

/** Video call state. `session` changes each time the player (re)joins, so peers know to reconnect. */
const NO_MEDIA = Object.freeze({ joined: false, mic: false, cam: false, session: null });

function normalizeMedia(input) {
  if (!input?.joined) return NO_MEDIA;
  const session = String(input.session ?? '').slice(0, 64);
  if (!session) return NO_MEDIA;
  return { joined: true, mic: Boolean(input.mic), cam: Boolean(input.cam), session };
}

function newPlayer(socketId, name, avatar) {
  return {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(), // lets a player reconnect after a dropped connection
    name,
    avatar: normalizeAvatar(avatar),
    socketId,
    connected: true,
    media: NO_MEDIA,
  };
}

/**
 * Owns all rooms. Socket wiring lives in server.js; this class only holds state and rules flow.
 * Every change calls onChange(room) so the server can push fresh views to players.
 */
/**
 * How long drawn cards take to fly from the deck into a hand on screen (matches the client's animation:
 * one or two cards fly slowly one after another, more than that go quickly). The turn clock waits this long.
 */
function drawAnimationMs(cards) {
  if (cards <= 0) return 0;
  const ms = cards <= 2 ? 1500 + (cards - 1) * 700 : 950 + (cards - 1) * 220;
  return Math.min(ms, 6000) + 200;
}

class RoomManager {
  /**
   * gameOverRevealMs: how long the finished table (with everyone's cards face up) stays on screen
   * before the room goes back to the lobby.
   */
  constructor({
    onChange = () => {},
    onClose = () => {},
    onKick = () => {},
    gameOverRevealMs = GAME_OVER_REVEAL_MS,
    hostHandoverMs = HOST_HANDOVER_MS,
  } = {}) {
    this.rooms = new Map();
    this.onChange = onChange;
    this.onClose = onClose;
    this.onKick = onKick;
    this.gameOverRevealMs = gameOverRevealMs;
    this.hostHandoverMs = hostHandoverMs;
  }

  get(code) {
    return this.rooms.get(code);
  }

  createRoom(socketId, { name, settings, avatar } = {}) {
    const player = newPlayer(socketId, normalizeName(name), avatar);
    const room = {
      code: this.newCode(),
      hostId: player.id,
      settings: normalizeSettings(settings),
      status: 'lobby',
      players: [player],
      game: null,
      lastResult: null,
      turnTimer: null,
      timerTurn: null,
      turnDeadline: null,
      chat: [],
      lastActivity: Date.now(),
      emptySince: null,
    };
    this.rooms.set(room.code, room);
    this.touch(room);
    return { room, player };
  }

  joinRoom(socketId, { code, name, token, avatar }) {
    const room = this.rooms.get(String(code ?? '').trim().toUpperCase());
    if (!room) throw new UnoError('No room with that code');

    // Reconnect: the same player comes back with their token, even mid-game.
    if (token) {
      const existing = room.players.find((p) => p.token === token);
      if (existing) {
        existing.socketId = socketId;
        existing.connected = true;
        // A new connection means new video links; the page rejoins the call if it was in it.
        existing.media = NO_MEDIA;
        this.touch(room);
        return { room, player: existing };
      }
    }

    if (room.status !== 'lobby') throw new UnoError('This game has already started');
    if (room.players.length >= room.settings.maxPlayers) throw new UnoError('This room is full');

    const player = newPlayer(socketId, this.uniqueName(room, normalizeName(name)), avatar);
    room.players.push(player);
    this.touch(room);
    return { room, player };
  }

  /** A player joins or leaves the video call, or turns their mic or camera on or off. */
  setMedia(room, playerId, media) {
    const player = this.playerOf(room, playerId);
    player.media = normalizeMedia(media);
    this.touch(room);
  }

  /**
   * The host mutes everyone else in the video call. Their microphones are switched off here and on
   * their pages (returned socket ids); each player can unmute again. Returns the sockets to tell.
   */
  muteAll(room, hostId) {
    this.requireHost(room, hostId);
    const muted = room.players.filter((p) => p.id !== hostId && p.media.joined && p.socketId);
    if (!muted.length) throw new UnoError('Nobody else is in the video call');
    for (const player of muted) player.media = { ...player.media, mic: false };
    this.touch(room);
    return muted.map((p) => p.socketId);
  }

  /**
   * Checks that a video signalling message may go from one player to another:
   * both in this room, connected, and in the call. Returns the target's socket id.
   */
  signalTarget(room, fromId, toId) {
    const from = this.playerOf(room, fromId);
    const to = room.players.find((p) => p.id === toId);
    if (!from.media.joined) throw new UnoError('Join the video call first');
    if (!to || !to.connected || !to.socketId || !to.media.joined) throw new UnoError('That player is not in the video call');
    return to.socketId;
  }

  /** A player picks a new avatar. Allowed any time, including mid-game. */
  setAvatar(room, playerId, avatar) {
    const player = this.playerOf(room, playerId);
    player.avatar = normalizeAvatar(avatar);
    this.touch(room);
  }

  setSettings(room, playerId, input) {
    this.requireHost(room, playerId);
    if (room.status !== 'lobby') throw new UnoError('Settings can only change in the lobby');
    const settings = normalizeSettings({ ...room.settings, ...input });
    if (settings.maxPlayers < room.players.length) {
      throw new UnoError(`The room already has ${room.players.length} players`);
    }
    room.settings = settings;
    this.touch(room);
  }

  /** From the scorecard after a game: the host starts the next game with everyone. */
  playAgain(room, playerId) {
    this.requireHost(room, playerId);
    if (room.status !== 'lobby') throw new UnoError('A game is already running');
    if (!room.lastResult) throw new UnoError('There is no finished game to replay');
    this.startGame(room, playerId);
  }

  /** The host starts the game whenever at least 2 players are in the room. */
  startGame(room, playerId) {
    this.requireHost(room, playerId);
    if (room.status !== 'lobby') throw new UnoError('A game is already running');
    if (room.players.length < MIN_PLAYERS) throw new UnoError('At least 2 players are needed to start');

    room.game = new UnoGame({
      players: room.players.map((p) => ({ id: p.id, name: p.name })),
      stacking: room.settings.stacking,
      mode: room.settings.mode,
    });
    room.status = 'playing';
    room.lastResult = null;
    room.game.start();
    room.drawnSeen = room.game.cardsDrawnTotal ?? 0;
    // Hold the clock while the opening hands are dealt.
    this.startTurnTimer(room, drawAnimationMs(7));
    this.touch(room);
  }

  playCard(room, playerId, cardId, color) {
    this.act(room, playerId, (game) => game.play(playerId, cardId, color));
  }

  drawCard(room, playerId) {
    this.act(room, playerId, (game) => game.draw(playerId));
  }

  passTurn(room, playerId) {
    this.act(room, playerId, (game) => game.pass(playerId));
  }

  challenge(room, playerId) {
    this.act(room, playerId, (game) => game.challenge(playerId));
  }

  callUno(room, playerId) {
    this.act(room, playerId, (game) => game.callUno(playerId));
  }

  catchUno(room, playerId, targetId) {
    this.act(room, playerId, (game) => game.catchUno(playerId, targetId));
  }

  kickPlayer(room, hostId, targetId) {
    this.requireHost(room, hostId);
    if (room.status !== 'lobby') throw new UnoError('Players can only be removed in the lobby');
    if (targetId === hostId) throw new UnoError('You cannot kick yourself');
    const target = this.playerOf(room, targetId);
    this.onKick(target.socketId);
    this.removePlayer(room, target);
  }

  /**
   * The host sets the seating order before a game: in the lobby, or on the scorecard between games.
   * playerIds must list everyone in the room exactly once. Play goes round in this order and the
   * first player starts. The order is fixed once a game is running.
   */
  reorderPlayers(room, hostId, playerIds) {
    this.requireHost(room, hostId);
    if (room.status !== 'lobby') throw new UnoError('The order can only change before the game starts');
    const ids = Array.isArray(playerIds) ? playerIds.map(String) : [];
    const current = room.players.map((p) => p.id);
    const sameEveryone = ids.length === current.length
      && new Set(ids).size === ids.length
      && ids.every((id) => current.includes(id));
    if (!sameEveryone) throw new UnoError('The player list changed. Please try again.');
    room.players = ids.map((id) => room.players.find((p) => p.id === id));
    this.touch(room);
  }

  transferHost(room, hostId, targetId) {
    this.requireHost(room, hostId);
    if (targetId === hostId) throw new UnoError('You are already the host');
    this.playerOf(room, targetId);
    room.hostId = targetId;
    this.touch(room);
  }

  /** Explicit leave. In the lobby the seat is freed. Mid-game the seat stays and the turn timer plays for them. */
  leaveRoom(room, playerId) {
    const player = this.playerOf(room, playerId);
    if (room.status === 'lobby') {
      this.removePlayer(room, player);
    } else {
      player.connected = false;
      player.socketId = null;
      player.media = NO_MEDIA;
      // Mid-game the seat stays, but someone still here takes over as host.
      if (room.hostId === player.id) this.handOverHost(room);
      this.touch(room);
    }
  }

  /**
   * One player throws something at another during a game. Returns the sockets of everyone in the
   * room to show it on, with what to show.
   */
  throwItem(room, fromId, toId, item) {
    if (room.status !== 'playing') throw new UnoError('You can only throw things during a game');
    if (!THROWABLES.includes(item)) throw new UnoError('You cannot throw that');
    this.playerOf(room, fromId);
    if (fromId === toId) throw new UnoError('You cannot throw at yourself');
    if (!room.players.some((p) => p.id === toId)) throw new UnoError('That player is not here');
    return {
      sockets: room.players.map((p) => p.socketId).filter(Boolean),
      thrown: { from: fromId, to: toId, item },
    };
  }

  postChat(room, playerId, text) {
    const message = String(text ?? '').trim().slice(0, MAX_CHAT_LENGTH);
    if (!message) throw new UnoError('Message is empty');
    const player = this.playerOf(room, playerId);
    room.chat.push({ from: player.name, text: message, at: Date.now() });
    if (room.chat.length > CHAT_HISTORY) room.chat.shift();
    this.touch(room);
  }

  handleDisconnect(socketId) {
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.socketId === socketId);
      if (!player) continue;
      player.connected = false;
      player.socketId = null;
      player.media = NO_MEDIA;
      if (room.status === 'lobby') {
        const timer = setTimeout(() => {
          if (!player.connected && room.players.includes(player) && this.rooms.get(room.code) === room) {
            this.removePlayer(room, player);
          }
        }, LOBBY_DISCONNECT_MS);
        timer.unref();
      }
      if (room.hostId === player.id) {
        const handover = setTimeout(() => {
          if (player.connected || room.hostId !== player.id || this.rooms.get(room.code) !== room) return;
          if (this.handOverHost(room)) this.touch(room);
        }, this.hostHandoverMs);
        handover.unref();
      }
      this.touch(room);
      return;
    }
  }

  /**
   * Makes the next connected player, going round the table from the host's seat, the new host.
   * Does nothing if the host is still connected or nobody else is. Returns whether the host changed.
   */
  handOverHost(room) {
    const host = room.players.find((p) => p.id === room.hostId);
    if (host?.connected) return false;
    const seat = Math.max(0, room.players.indexOf(host));
    const roundTheTable = [...room.players.slice(seat + 1), ...room.players.slice(0, seat + 1)];
    const next = roundTheTable.find((p) => p.connected && p !== host);
    if (!next) return false;
    room.hostId = next.id;
    return true;
  }

  /** Called periodically. Closes rooms that have been empty or idle for too long. */
  sweep(now = Date.now()) {
    for (const room of [...this.rooms.values()]) {
      if (room.players.some((p) => p.connected)) {
        room.emptySince = null;
      } else {
        room.emptySince ??= now;
        if (now - room.emptySince > EMPTY_ROOM_MS) this.closeRoom(room, 'empty');
        continue;
      }
      if (room.status === 'lobby' && now - room.lastActivity > LOBBY_IDLE_MS) this.closeRoom(room, 'idle');
    }
  }

  /** What one player is allowed to see of a room. */
  viewFor(room, playerId) {
    return {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      youId: playerId,
      settings: room.settings,
      players: room.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, connected: p.connected, media: p.media })),
      game: room.game ? room.game.viewFor(playerId) : null,
      lastResult: room.lastResult,
      // Time left rather than a clock time, so a player whose device clock is off still sees a full 10s.
      turnRemainingMs: room.turnDeadline ? Math.max(0, room.turnDeadline - Date.now()) : null,
      chat: room.chat.slice(-50),
    };
  }

  /** Runs a game action, then updates the timer and the room status. */
  act(room, playerId, action) {
    if (room.status !== 'playing' || !room.game) throw new UnoError('No game in progress');
    this.playerOf(room, playerId);
    action(room.game);
    this.afterGameStep(room);
    this.touch(room);
  }

  afterGameStep(room) {
    const { game } = room;
    if (game.gameOver) {
      // Keep the finished table up for a moment so everyone sees the revealed hands, then go to the lobby.
      this.stopTurnTimer(room);
      if (!room.revealTimer) {
        room.revealTimer = setTimeout(() => {
          room.revealTimer = null;
          if (this.rooms.get(room.code) !== room || !room.game) return;
          this.finishGame(room);
          this.touch(room);
        }, this.gameOverRevealMs);
        room.revealTimer.unref();
      }
      return;
    }
    if (!game.roundActive) {
      this.stopTurnTimer(room);
      return;
    }
    // Cards flying from the deck to a hand take a moment on screen; the clock waits for them.
    const drawn = (game.cardsDrawnTotal ?? 0) - (room.drawnSeen ?? 0);
    room.drawnSeen = game.cardsDrawnTotal ?? 0;
    const hold = drawAnimationMs(drawn);
    if (game.turnNumber !== room.timerTurn) this.startTurnTimer(room, hold);
    else if (hold) this.extendTurnTimer(room, hold);
  }

  finishGame(room) {
    const { results, mode } = room.game;
    room.lastResult = {
      mode,
      endedAt: Date.now(),
      winnerName: results[0].name,
      ranking: results.map(({ id, name, place, score, cardsLeft, handPoints, hand }) => ({ id, name, place, score, cardsLeft, handPoints, hand })),
    };
    room.status = 'lobby';
    room.game = null;
    this.stopTurnTimer(room);
  }

  /** Pushes the current turn's deadline back (cards are still flying to a hand). */
  extendTurnTimer(room, extraMs) {
    if (!room.turnDeadline) return;
    const ms = room.turnDeadline - Date.now() + extraMs;
    clearTimeout(room.turnTimer);
    room.turnDeadline = Date.now() + ms;
    room.turnTimer = setTimeout(() => this.onTurnTimeout(room), ms);
    room.turnTimer.unref();
  }

  startTurnTimer(room, holdMs = 0) {
    this.stopTurnTimer(room);
    const ms = room.settings.turnSeconds * 1000 + holdMs;
    room.timerTurn = room.game.turnNumber;
    room.turnDeadline = Date.now() + ms;
    room.turnTimer = setTimeout(() => this.onTurnTimeout(room), ms);
    room.turnTimer.unref(); // the HTTP server keeps the process alive, not the timer
  }

  stopTurnTimer(room) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnDeadline = null;
    room.timerTurn = null;
  }

  onTurnTimeout(room) {
    room.turnTimer = null;
    if (room.status !== 'playing' || !room.game || !room.game.roundActive) return;
    room.game.autoTurn();
    this.afterGameStep(room);
    this.touch(room);
  }

  removePlayer(room, player) {
    const seat = room.players.indexOf(player);
    room.players = room.players.filter((p) => p !== player);
    if (room.players.length === 0) {
      this.closeRoom(room, 'empty');
      return;
    }
    if (room.hostId === player.id) {
      // The next connected player round the table from the old host's seat; anyone at all if nobody is connected.
      const roundTheTable = [...room.players.slice(seat), ...room.players.slice(0, seat)];
      room.hostId = (roundTheTable.find((p) => p.connected) ?? roundTheTable[0]).id;
    }
    this.touch(room);
  }

  closeRoom(room, reason) {
    this.stopTurnTimer(room);
    clearTimeout(room.revealTimer);
    this.rooms.delete(room.code);
    this.onClose(room, reason);
  }

  requireHost(room, playerId) {
    this.playerOf(room, playerId);
    if (room.hostId !== playerId) throw new UnoError('Only the host can do that');
  }

  playerOf(room, playerId) {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new UnoError('You are not in this room');
    return player;
  }

  uniqueName(room, base) {
    const taken = new Set(room.players.map((p) => p.name));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base} (${i})`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  newCode() {
    let code;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  touch(room) {
    room.lastActivity = Date.now();
    this.onChange(room);
  }
}

module.exports = { RoomManager, MIN_PLAYERS, MAX_PLAYERS, TURN_SECONDS, AVATAR_IMAGES, THROWABLES };
