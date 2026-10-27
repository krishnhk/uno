# Online Uno

Multiplayer Uno in the browser. Players create a room, share the 6-character code, and play with 2 to 6 people. The server is Node.js with Socket.IO, and the front end is an Angular app with a glass-style 3D table, character avatars, optional video chat and throwable tomatoes, eggs and hearts.

Requirements are in [Online-Uno-Requirements.md](Online-Uno-Requirements.md).

## Run locally

Requires Node.js 20 or newer (the Angular build needs a recent Node).

```bash
npm install
npm run build      # installs client/ dependencies and builds the Angular app
npm start
```

Open http://localhost:5121 in two or more browser windows. Create a room in one, and join with the code in the others.

To use another port, set `PORT`, for example `PORT=4000 npm start`.

### Angular client

The front end lives in `client/` (Angular, standalone components and signals). `npm run build` writes it to `client/dist/uno/browser`, and the server serves that folder.

- Development: run `npm start` and, in another terminal, `npm run client:dev`. The dev server proxies Socket.IO to the game server.
- `UNO_CLIENT_DIR=<folder>` serves a different build.
- Without a build, or with `UNO_CLIENT=legacy`, the server serves the original plain-JS client in `public/`.

## Test

```bash
npm test
```

The tests cover the rules engine (`test/game.test.js`), the room rules, including the 2 to 6 player limit (`test/rooms.test.js`), and how game-log entries become animation moments (`test/moments.test.js`).

## Project layout

| Path | Purpose |
|---|---|
| `src/game.js` | Uno rules engine. Pure logic, no networking. |
| `src/rooms.js` | Rooms, lobby, host controls, reconnects, turn timers. |
| `src/server.js` | Express static files and Socket.IO event handlers. |
| `src/errors.js` | Error type for messages shown to players. |
| `client/` | Angular browser client (`src/app/`: core services, lobby, stage, call, throw, fx, dialogs). |
| `public/` | Original plain-JS client (fallback). |
| `test/` | Automated tests. |

## Rules implemented

- 108-card deck. Start card re-flipped until a number card (2022 rule).
- Match by color, number or symbol. No playable card? One is drawn for you. If it fits, play it or keep it; the turn then moves on.
- Skip, Reverse (acts as Skip with two players), Draw Two, Wild, Wild Draw Four.
- Wild Draw Four can be challenged. Success: offender draws 4 and the challenger keeps the turn. Failure: challenger draws 6 and loses the turn.
- Optional stacking house rule (Draw Two on Draw Two, Draw Four on Draw Four).
- Every move has 10 seconds. When time runs out, the game plays a suitable card for the player (a Wild picks the colour they hold most), or draws one (or takes the cards they owe) when nothing fits, and passes the turn.
- UNO call, before the next player moves. Being caught without it costs 2 cards. Missing it altogether means you can't call it later or go out with that card: on your turn you have to draw.
- Two game modes:
  - **Play till the end** (default): players finish one by one as they empty their hand, and play goes on until one player is left holding cards (the loser). Each player who goes out scores the cards still held by the others.
  - **First out wins**: the first player out wins and the game ends. The rest are ranked by the points left in their hand, fewest first.
- Card points: numbers count their value, Skip, Reverse and Draw Two are 20, Wilds are 50.

## Video call

Players can turn on their camera and microphone with **📹 Join video**, in the room bar or the game's top bar. Each player's live video replaces their avatar around the table; the microphone and camera buttons turn red with a slash when off, and the red hang-up button leaves the call. The host also gets **Mute all**, which mutes everyone else in the call (each player can unmute themselves). A player with no camera (or who blocks it) joins with the microphone only, or just watches and listens.

- Video goes directly between browsers (WebRTC). The server only passes the short setup messages along; it never carries video.
- Everyone in the call links to everyone else (up to 5 links each), sized small (320×240, 15 fps) to keep this light.
- Browsers allow the camera only on `https://` addresses or `localhost`. To play with friends on other computers, serve the game over HTTPS (a hosting service, or a tunnel such as ngrok or Cloudflare Tunnel).
- Some networks (strict office firewalls, some mobile carriers) block direct links. Add a TURN relay for those:

  ```bash
  TURN_URL=turn:turn.example.com:3478 TURN_USERNAME=user TURN_CREDENTIAL=secret npm start
  ```

  `STUN_URLS` (comma-separated) overrides the default Google STUN servers.

## Known limits (version 1.0)

- Rooms are private by code. There is no public room list.
- No accounts. Names only, duplicate names get a number suffix.
- Rooms and games live in server memory. A server restart ends them.
- A player who leaves mid-game keeps their seat. The turn timer plays their turns, so the game keeps moving, but they cannot be removed until the game ends.
- A Wild Draw Four that goes out as the last card cannot be challenged. The next player takes the cards.
- Seven-O and Jump-In are not implemented.
