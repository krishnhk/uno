'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');
const { UnoError } = require('./errors');

const PORT = Number(process.env.PORT) || 5121;
const CHAT_COOLDOWN_MS = 500;
// Throwing can be rapid-fire; this only stops a flood (about 8 a second).
const THROW_COOLDOWN_MS = 120;
const MAX_SIGNAL_BYTES = 64 * 1024;
// Video calls connect browsers directly. STUN finds a direct route; a TURN relay (optional, from the
// environment) covers networks where that fails, such as strict office firewalls.
const ICE_SERVERS = [
  { urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',') },
  ...(process.env.TURN_URL
    ? [{ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL }]
    : []),
];
// The Angular client (client/, built with `npm run client:build`) is served when it has been built;
// otherwise the original plain-JS client in public/ is. Set UNO_CLIENT=legacy to force the old one.
const ANGULAR_DIR = process.env.UNO_CLIENT_DIR
  ? path.resolve(process.env.UNO_CLIENT_DIR)
  : path.join(__dirname, '..', 'client', 'dist', 'uno', 'browser');
const LEGACY_DIR = path.join(__dirname, '..', 'public');
const PUBLIC_DIR = process.env.UNO_CLIENT !== 'legacy' && fs.existsSync(path.join(ANGULAR_DIR, 'index.html')) ? ANGULAR_DIR : LEGACY_DIR;
// Changes on every restart, so open pages know to reload and pick up new client code.
const SERVER_VERSION = String(Date.now());

const app = express();
app.use(express.static(PUBLIC_DIR));

const server = http.createServer(app);
const io = new Server(server);

const socketFor = (socketId) => (socketId ? io.sockets.sockets.get(socketId) : undefined);

const rooms = new RoomManager({
  onChange: (room) => {
    for (const player of room.players) {
      socketFor(player.socketId)?.emit('state', rooms.viewFor(room, player.id));
    }
  },
  onClose: (room, reason) => {
    for (const player of room.players) {
      const socket = socketFor(player.socketId);
      if (socket) {
        socket.data.roomCode = null;
        socket.data.playerId = null;
        socket.emit('room_closed', { reason });
      }
    }
  },
  onKick: (socketId) => {
    const socket = socketFor(socketId);
    if (socket) {
      socket.data.roomCode = null;
      socket.data.playerId = null;
      socket.emit('kicked');
    }
  },
});

io.on('connection', (socket) => {
  socket.emit('server_version', SERVER_VERSION);
  const bind = (room, player) => {
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
  };
  const unbind = () => {
    socket.data.roomCode = null;
    socket.data.playerId = null;
  };
  const current = () => {
    const room = socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined;
    if (!room || !socket.data.playerId) throw new UnoError('You are not in a room');
    return { room, playerId: socket.data.playerId };
  };

  // Every event replies through an ack: { ok: true, ... } or { ok: false, error }.
  const handle = (event, fn) => {
    socket.on(event, (payload, ack) => {
      try {
        const result = fn(payload ?? {});
        ack?.({ ok: true, ...result });
      } catch (err) {
        if (!(err instanceof UnoError)) console.error(`[${event}]`, err);
        ack?.({ ok: false, error: err instanceof UnoError ? err.message : 'Something went wrong' });
      }
    });
  };

  handle('create_room', ({ name, settings, avatar }) => {
    if (socket.data.roomCode) throw new UnoError('Leave your current room first');
    const { room, player } = rooms.createRoom(socket.id, { name, settings, avatar });
    bind(room, player);
    return { code: room.code, token: player.token };
  });

  handle('join_room', ({ code, name, token, avatar }) => {
    if (socket.data.roomCode && socket.data.roomCode !== String(code).toUpperCase()) {
      throw new UnoError('Leave your current room first');
    }
    const { room, player } = rooms.joinRoom(socket.id, { code, name, token, avatar });
    bind(room, player);
    return { code: room.code, token: player.token };
  });

  handle('leave_room', () => {
    const { room, playerId } = current();
    rooms.leaveRoom(room, playerId);
    unbind();
    return {};
  });

  handle('update_settings', ({ settings }) => {
    const { room, playerId } = current();
    rooms.setSettings(room, playerId, settings);
    return {};
  });

  // ---------- video call ----------

  handle('rtc_config', () => ({ iceServers: ICE_SERVERS }));

  handle('set_media', ({ media }) => {
    const { room, playerId } = current();
    rooms.setMedia(room, playerId, media);
    return {};
  });

  handle('mute_all', () => {
    const { room, playerId } = current();
    const host = room.players.find((p) => p.id === playerId);
    for (const socketId of rooms.muteAll(room, playerId)) socketFor(socketId)?.emit('force_mute', { by: host.name });
    return {};
  });

  // Offers, answers and network candidates between two players' browsers. The video itself never comes here.
  handle('rtc_signal', ({ to, data }) => {
    const { room, playerId } = current();
    if (!data || typeof data !== 'object' || JSON.stringify(data).length > MAX_SIGNAL_BYTES) {
      throw new UnoError('Bad video message');
    }
    const target = rooms.signalTarget(room, playerId, to);
    socketFor(target)?.emit('rtc_signal', { from: playerId, data });
    return {};
  });

  handle('set_avatar', ({ avatar }) => {
    const { room, playerId } = current();
    rooms.setAvatar(room, playerId, avatar);
    return {};
  });

  handle('start_game', () => {
    const { room, playerId } = current();
    rooms.startGame(room, playerId);
    return {};
  });

  handle('play_again', () => {
    const { room, playerId } = current();
    rooms.playAgain(room, playerId);
    return {};
  });

  handle('kick_player', ({ playerId: targetId }) => {
    const { room, playerId } = current();
    rooms.kickPlayer(room, playerId, targetId);
    return {};
  });

  handle('transfer_host', ({ playerId: targetId }) => {
    const { room, playerId } = current();
    rooms.transferHost(room, playerId, targetId);
    return {};
  });

  handle('reorder_players', ({ playerIds }) => {
    const { room, playerId } = current();
    rooms.reorderPlayers(room, playerId, playerIds);
    return {};
  });

  handle('play_card', ({ cardId, color }) => {
    const { room, playerId } = current();
    rooms.playCard(room, playerId, cardId, color);
    return {};
  });

  handle('draw_card', () => {
    const { room, playerId } = current();
    rooms.drawCard(room, playerId);
    return {};
  });

  handle('pass_turn', () => {
    const { room, playerId } = current();
    rooms.passTurn(room, playerId);
    return {};
  });

  handle('challenge', () => {
    const { room, playerId } = current();
    rooms.challenge(room, playerId);
    return {};
  });

  handle('call_uno', () => {
    const { room, playerId } = current();
    rooms.callUno(room, playerId);
    return {};
  });

  handle('catch_uno', ({ targetId }) => {
    const { room, playerId } = current();
    rooms.catchUno(room, playerId, targetId);
    return {};
  });

  // A tomato, pumpkin or egg thrown at another player; everyone in the room sees it fly and splat.
  handle('throw_item', ({ targetId, item }) => {
    const now = Date.now();
    if (socket.data.lastThrow && now - socket.data.lastThrow < THROW_COOLDOWN_MS) {
      throw new UnoError('Easy there, reload first');
    }
    const { room, playerId } = current();
    const { sockets, thrown } = rooms.throwItem(room, playerId, targetId, item);
    socket.data.lastThrow = now;
    for (const id of sockets) socketFor(id)?.emit('thrown', thrown);
    return {};
  });

  handle('chat', ({ text }) => {
    const now = Date.now();
    if (socket.data.lastChat && now - socket.data.lastChat < CHAT_COOLDOWN_MS) {
      throw new UnoError('Slow down a little');
    }
    socket.data.lastChat = now;
    const { room, playerId } = current();
    rooms.postChat(room, playerId, text);
    return {};
  });

  socket.on('disconnect', () => rooms.handleDisconnect(socket.id));
});

setInterval(() => rooms.sweep(), 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Online Uno running at http://localhost:${PORT} (${PUBLIC_DIR === LEGACY_DIR ? 'plain-JS client' : 'Angular client'})`);
});
