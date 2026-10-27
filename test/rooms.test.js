'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomManager, AVATAR_IMAGES } = require('../src/rooms');

function setup() {
  return new RoomManager();
}

function fillRoom(manager, room, count) {
  const players = [];
  for (let i = 0; i < count; i++) {
    players.push(manager.joinRoom(`s${i}`, { code: room.code, name: `Player${i}` }).player);
  }
  return players;
}

test('a room can be created with 1 player and 2 to 6 seats', () => {
  const manager = setup();
  const { room } = manager.createRoom('host-socket', { name: 'Ann', settings: { maxPlayers: 2 } });
  assert.equal(room.players.length, 1);
  assert.equal(room.settings.maxPlayers, 2);
  assert.match(room.code, /^[A-Z2-9]{6}$/);
  assert.throws(() => manager.createRoom('x', { name: 'B', settings: { maxPlayers: 1 } }), /2 to 6/);
  assert.throws(() => manager.createRoom('x', { name: 'B', settings: { maxPlayers: 7 } }), /2 to 6/);
});

test('a room holds up to 6 players and rejects the 7th', () => {
  const manager = setup();
  const { room } = manager.createRoom('host', { name: 'Host' });
  fillRoom(manager, room, 5); // host + 5 = 6
  assert.equal(room.players.length, 6);
  assert.throws(() => manager.joinRoom('late', { code: room.code, name: 'Seventh' }), /full/);
});

test('a room with a smaller limit is full earlier', () => {
  const manager = setup();
  const { room } = manager.createRoom('host', { name: 'Host', settings: { maxPlayers: 3 } });
  fillRoom(manager, room, 2);
  assert.throws(() => manager.joinRoom('late', { code: room.code, name: 'Late' }), /full/);
});

test('joining with an unknown code fails', () => {
  const manager = setup();
  assert.throws(() => manager.joinRoom('s', { code: 'ZZZZZZ', name: 'A' }), /No room/);
});

test('duplicate names get a suffix', () => {
  const manager = setup();
  const { room } = manager.createRoom('host', { name: 'Sam' });
  const second = manager.joinRoom('s', { code: room.code, name: 'Sam' }).player;
  assert.equal(second.name, 'Sam (2)');
});

test('the host can start as soon as there are at least 2 players', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host' });
  assert.throws(() => manager.startGame(room, host.id), /At least 2/);

  const [guest] = fillRoom(manager, room, 1);
  assert.throws(() => manager.startGame(room, guest.id), /Only the host/);
  manager.startGame(room, host.id);
  assert.equal(room.status, 'playing');
  assert.equal(room.game.players.length, 2);
  manager.leaveRoom(room, guest.id);
});

test('only the host can start, kick, change settings or transfer host', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host' });
  const [guest] = fillRoom(manager, room, 1);
  assert.throws(() => manager.kickPlayer(room, guest.id, host.id), /Only the host/);
  assert.throws(() => manager.setSettings(room, guest.id, { stacking: true }), /Only the host/);
  assert.throws(() => manager.transferHost(room, guest.id, host.id), /Only the host/);
});

test('the host can kick a player in the lobby and the seat is freed', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host' });
  const [guest] = fillRoom(manager, room, 1);
  manager.kickPlayer(room, host.id, guest.id);
  assert.equal(room.players.length, 1);
});

test('leaving the lobby as host hands host to another player', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host' });
  const [guest] = fillRoom(manager, room, 1);
  manager.leaveRoom(room, host.id);
  assert.equal(room.hostId, guest.id);
});

test('a host who leaves mid-game is replaced straight away by the next player still here', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host' });
  const [ben, cal] = fillRoom(manager, room, 2);
  manager.startGame(room, host.id);
  try {
    manager.handleDisconnect('s0'); // Ben is offline, so he is skipped
    manager.leaveRoom(room, host.id);
    assert.equal(room.hostId, cal.id);
  } finally {
    manager.stopTurnTimer(room);
  }
});

test('a host who drops offline is replaced after the grace period, unless they come back', async () => {
  const manager = new RoomManager({ hostHandoverMs: 20 });
  const { room, player: host } = manager.createRoom('host-socket', { name: 'Host' });
  const [guest] = fillRoom(manager, room, 1);

  // A quick refresh: back within the grace period, still host.
  manager.handleDisconnect('host-socket');
  manager.joinRoom('host-socket-2', { code: room.code, token: host.token });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(room.hostId, host.id);

  // Gone for good: the guest takes over.
  manager.handleDisconnect('host-socket-2');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(room.hostId, guest.id);
});

test('the host can change the seating order in the lobby, and seat 1 starts the game', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host' });
  const [ben, cal] = fillRoom(manager, room, 2);

  manager.reorderPlayers(room, host.id, [cal.id, host.id, ben.id]);
  assert.deepEqual(room.players.map((p) => p.id), [cal.id, host.id, ben.id]);

  assert.throws(() => manager.reorderPlayers(room, ben.id, [ben.id, cal.id, host.id]), /Only the host/);
  assert.throws(() => manager.reorderPlayers(room, host.id, [cal.id, host.id]), /player list changed/);
  assert.throws(() => manager.reorderPlayers(room, host.id, [cal.id, cal.id, ben.id]), /player list changed/);

  manager.startGame(room, host.id);
  try {
    assert.deepEqual(room.game.players.map((p) => p.id), [cal.id, host.id, ben.id]);
    assert.equal(room.game.currentPlayer.id, cal.id);
  } finally {
    manager.stopTurnTimer(room);
  }
});

test('the order is fixed once a game is running', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host' });
  const [ben, cal] = fillRoom(manager, room, 2);
  manager.startGame(room, host.id);
  try {
    assert.throws(() => manager.reorderPlayers(room, host.id, [ben.id, cal.id, host.id]), /before the game starts/);
    assert.deepEqual(room.game.players.map((p) => p.id), [host.id, ben.id, cal.id]);
  } finally {
    manager.stopTurnTimer(room);
  }
});

test('settings cannot shrink below the current player count', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host' });
  fillRoom(manager, room, 3);
  assert.throws(() => manager.setSettings(room, host.id, { maxPlayers: 3 }), /already has 4 players/);
  manager.setSettings(room, host.id, { maxPlayers: 4 });
  assert.equal(room.settings.maxPlayers, 4);
});

test('a dropped player can rejoin with their token mid-game', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host' });
  const [guest] = fillRoom(manager, room, 1);
  manager.startGame(room, host.id);

  manager.handleDisconnect('s0');
  assert.equal(guest.connected, false);
  const back = manager.joinRoom('new-socket', { code: room.code, name: 'ignored', token: guest.token });
  assert.equal(back.player.id, guest.id);
  assert.equal(back.player.connected, true);
});

test('new players cannot join once the game has started', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host' });
  const [guest] = fillRoom(manager, room, 1);
  manager.startGame(room, host.id);
  assert.throws(() => manager.joinRoom('late', { code: room.code, name: 'Late' }), /already started/);
});

test('viewFor hides other players hands', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host' });
  const [guest] = fillRoom(manager, room, 1);
  manager.startGame(room, host.id);

  const view = manager.viewFor(room, host.id);
  assert.equal(view.game.hand.length, 7);
  const guestCount = view.game.players.find((p) => p.id === guest.id);
  assert.equal(guestCount.cardCount, 7);
  assert.equal(guestCount.hand, undefined);
});

test('each turn gives 10 seconds, reported as time left rather than a clock time', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host' });
  const [guest] = fillRoom(manager, room, 1);
  manager.startGame(room, host.id);
  try {
    const view = manager.viewFor(room, guest.id);
    // 10 seconds, plus a pause while the opening hands are dealt on screen.
    assert.ok(view.turnRemainingMs > 10000 && view.turnRemainingMs <= 13000, `got ${view.turnRemainingMs}`);
    assert.equal(view.turnDeadline, undefined);
  } finally {
    manager.stopTurnTimer(room);
  }
});

test('turn timer timeouts make progress without the player acting', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host', settings: { turnSeconds: 90 } });
  assert.equal(room.settings.turnSeconds, 10); // fixed, whatever the client sends
  const [guest] = fillRoom(manager, room, 1);
  manager.startGame(room, host.id);
  try {
    const firstTurn = room.game.turnNumber;
    manager.onTurnTimeout(room);
    assert.ok(room.game.turnNumber > firstTurn);
  } finally {
    manager.stopTurnTimer(room);
  }
});

test('a finished game shows everyone\'s cards, then returns to the lobby with the ranking', async () => {
  const manager = new RoomManager({ gameOverRevealMs: 20 });
  const { room, player: host } = manager.createRoom('host', { name: 'Host', settings: { mode: 'first' } });
  const [guest] = fillRoom(manager, room, 1);
  manager.startGame(room, host.id);

  const game = room.game;
  game.currentIndex = 0;
  game.discardPile = [{ id: 'top', color: 'red', value: '2' }];
  game.currentColor = 'red';
  game.players[0].hand = [{ id: 'last', color: 'red', value: '4' }];
  game.players[0].calledUno = true;
  manager.playCard(room, game.players[0].id, 'last');

  // First the finished table stays up, with the loser's hand visible to the winner.
  assert.equal(room.status, 'playing');
  const seenByWinner = manager.viewFor(room, game.players[0].id).game.players.find((p) => p.id === game.players[1].id);
  assert.equal(seenByWinner.revealedHand.length, game.players[1].hand.length);
  assert.ok(seenByWinner.revealedHand.length > 0);

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(room.status, 'lobby');
  assert.equal(room.game, null);
  assert.equal(room.lastResult.mode, 'first');
  assert.equal(room.lastResult.winnerName, game.players[0].name);
  assert.deepEqual(room.lastResult.ranking.map((r) => r.place), [1, 2]);
  assert.equal(room.lastResult.ranking[1].hand.length, room.lastResult.ranking[1].cardsLeft);
});

test('after a game, only the host can start the next one', async () => {
  const manager = new RoomManager({ gameOverRevealMs: 5 });
  const { room, player: host } = manager.createRoom('host', { name: 'Host', settings: { mode: 'first' } });
  const [guest] = fillRoom(manager, room, 1);
  assert.throws(() => manager.playAgain(room, host.id), /no finished game/);
  manager.startGame(room, host.id);

  const game = room.game;
  game.currentIndex = 0;
  game.discardPile = [{ id: 'top', color: 'red', value: '2' }];
  game.currentColor = 'red';
  game.players[0].hand = [{ id: 'last', color: 'red', value: '4' }];
  game.players[0].calledUno = true;
  manager.playCard(room, game.players[0].id, 'last');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(room.status, 'lobby');

  assert.throws(() => manager.playAgain(room, guest.id), /Only the host/);
  manager.playAgain(room, host.id);
  try {
    assert.equal(room.status, 'playing');
    assert.equal(room.game.players.length, 2);
  } finally {
    manager.stopTurnTimer(room);
  }
});

test('hands stay hidden from other players while the game is running', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host' });
  const [guest] = fillRoom(manager, room, 1);
  manager.startGame(room, host.id);
  try {
    const players = manager.viewFor(room, host.id).game.players;
    assert.ok(players.every((p) => p.revealedHand === null));
  } finally {
    manager.stopTurnTimer(room);
  }
});

test('avatars are stored, shown to everyone, and validated', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host', avatar: { image: 'luffy' } });
  const [guest] = fillRoom(manager, room, 1);
  assert.deepEqual(host.avatar, { image: 'luffy' });
  assert.deepEqual(guest.avatar, { image: null }); // no choice: initials

  manager.setAvatar(room, guest.id, { image: 'naruto' });
  assert.deepEqual(guest.avatar, { image: 'naruto' });
  manager.setAvatar(room, guest.id, { image: '../server.js' }); // only known pictures
  assert.deepEqual(guest.avatar, { image: null });
  manager.setAvatar(room, guest.id, { emoji: '👩🏻', color: '#e5484d' }); // retired emoji faces and colours
  assert.deepEqual(guest.avatar, { image: null });
  assert.ok(AVATAR_IMAGES.length >= 20);

  const seen = manager.viewFor(room, guest.id).players.find((p) => p.id === host.id);
  assert.deepEqual(seen.avatar, { image: 'luffy' });
});

test('the game mode setting is validated', () => {
  const manager = setup();
  assert.equal(manager.createRoom('a', { name: 'A' }).room.settings.mode, 'last');
  assert.throws(() => manager.createRoom('b', { name: 'B', settings: { mode: 'nope' } }), /valid game mode/);
});

test('a room with nobody connected is closed by the sweeper', () => {
  let closedReason = null;
  const manager = new RoomManager({ onClose: (_room, reason) => { closedReason = reason; } });
  const { room } = manager.createRoom('host', { name: 'Host' });
  manager.handleDisconnect('host');
  manager.sweep(); // first sweep records when the room went empty
  manager.sweep(Date.now() + 6 * 60 * 1000);
  assert.equal(manager.get(room.code), undefined);
  assert.equal(closedReason, 'empty');
});

test('players can join the video call and turn their mic and camera on and off', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('s-host', { name: 'Ann' });
  const [guest] = fillRoom(manager, room, 1);
  assert.deepEqual(manager.viewFor(room, guest.id).players[0].media, { joined: false, mic: false, cam: false, session: null });

  manager.setMedia(room, host.id, { joined: true, mic: true, cam: false, session: 'a1' });
  assert.deepEqual(manager.viewFor(room, guest.id).players[0].media, { joined: true, mic: true, cam: false, session: 'a1' });

  // Joining without a session id, or leaving, resets everything.
  manager.setMedia(room, host.id, { joined: true, mic: true, cam: true });
  assert.equal(host.media.joined, false);
});

test('video signalling only goes between players who are both in the call', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('s-host', { name: 'Ann' });
  const [guest] = fillRoom(manager, room, 1);
  assert.throws(() => manager.signalTarget(room, host.id, guest.id), /Join the video call first/);
  manager.setMedia(room, host.id, { joined: true, session: 'a1' });
  assert.throws(() => manager.signalTarget(room, host.id, guest.id), /not in the video call/);
  manager.setMedia(room, guest.id, { joined: true, session: 'b1' });
  assert.equal(manager.signalTarget(room, host.id, guest.id), 's0');
  assert.throws(() => manager.signalTarget(room, host.id, 'nobody'), /not in the video call/);
});

test('dropping or rejoining the connection takes a player out of the video call', () => {
  const manager = setup();
  const { room } = manager.createRoom('s-host', { name: 'Ann' });
  const [guest] = fillRoom(manager, room, 1);
  manager.setMedia(room, guest.id, { joined: true, cam: true, session: 'b1' });
  manager.handleDisconnect('s0');
  assert.equal(guest.media.joined, false);
  manager.setMedia(room, guest.id, { joined: true, cam: true, session: 'b2' });
  manager.joinRoom('s0-again', { code: room.code, token: guest.token });
  assert.equal(guest.media.joined, false);
});

test('the host can mute everyone else in the video call', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('s-host', { name: 'Ann' });
  const [sam, ana, ravi] = fillRoom(manager, room, 3);
  manager.setMedia(room, host.id, { joined: true, mic: true, session: 'h' });
  manager.setMedia(room, sam.id, { joined: true, mic: true, cam: true, session: 's' });
  manager.setMedia(room, ana.id, { joined: true, mic: true, session: 'a' });
  // Ravi is not in the call.

  assert.throws(() => manager.muteAll(room, sam.id), /Only the host/);
  assert.deepEqual(manager.muteAll(room, host.id).sort(), ['s0', 's1']);
  assert.equal(sam.media.mic, false);
  assert.equal(sam.media.cam, true); // cameras are left alone
  assert.equal(ana.media.mic, false);
  assert.equal(host.media.mic, true);
  assert.equal(ravi.media.joined, false);

  // A muted player can unmute again.
  manager.setMedia(room, sam.id, { joined: true, mic: true, cam: true, session: 's' });
  assert.equal(sam.media.mic, true);
});

test('mute all needs someone else in the call', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('s-host', { name: 'Ann' });
  fillRoom(manager, room, 1);
  manager.setMedia(room, host.id, { joined: true, mic: true, session: 'h' });
  assert.throws(() => manager.muteAll(room, host.id), /Nobody else/);
});

test('players can throw a tomato, pumpkin or egg at someone else during a game', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('s-host', { name: 'Ann' });
  const [sam] = fillRoom(manager, room, 1);
  assert.throws(() => manager.throwItem(room, host.id, sam.id, 'tomato'), /during a game/);
  manager.startGame(room, host.id);

  assert.equal(manager.throwItem(room, sam.id, host.id, 'heart').thrown.item, 'heart');
  const { sockets, thrown } = manager.throwItem(room, host.id, sam.id, 'egg');
  assert.deepEqual(thrown, { from: host.id, to: sam.id, item: 'egg' });
  assert.deepEqual(sockets.sort(), ['s-host', 's0']);

  assert.throws(() => manager.throwItem(room, host.id, host.id, 'tomato'), /yourself/);
  assert.throws(() => manager.throwItem(room, host.id, sam.id, 'brick'), /cannot throw that/);
  assert.throws(() => manager.throwItem(room, host.id, 'nobody', 'egg'), /not here/);
  assert.throws(() => manager.throwItem(room, host.id, sam.id, 'pumpkin'), /cannot throw that/); // retired
  manager.stopTurnTimer(room);
});

test('the turn clock waits while drawn cards fly to a hand', () => {
  const manager = setup();
  const { room, player: host } = manager.createRoom('host', { name: 'Host' });
  fillRoom(manager, room, 1);
  manager.startGame(room, host.id);
  try {
    const game = room.game;
    const current = game.currentPlayer;
    // Nothing in hand can be played, and the card drawn can: the turn stays, and its clock is pushed back.
    game.discardPile = [{ id: 'top', color: 'red', value: '5' }];
    game.currentColor = 'red';
    current.hand = [{ id: 'h1', color: 'blue', value: '1' }];
    game.drawPile = [{ id: 'd1', color: 'red', value: '9' }];
    manager.stopTurnTimer(room);
    manager.startTurnTimer(room);
    const before = room.turnDeadline;
    manager.drawCard(room, current.id);
    assert.equal(game.currentPlayer.id, current.id);
    assert.ok(room.turnDeadline - before >= 1500, `pushed back ${room.turnDeadline - before}ms`);
  } finally {
    manager.stopTurnTimer(room);
  }
});
