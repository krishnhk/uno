# Online Uno Game: Requirements Document

**Version:** 1.0
**Date:** 2026-10-23
**Status:** Draft

---

## 1. Overview

This document defines the requirements for an online, multiplayer version of the Uno card game. Players create or join a **room**, and each room holds **2 to 6 players**. The game follows the standard Uno rules described in Section 2, with the room, lobby, and online-play features described in Sections 3 to 5.

### 1.1 Goals
- Let friends play Uno online in private rooms with 2 to 6 players.
- Follow the standard Uno rules faithfully, so players who know the physical game can play without learning new rules.
- Keep rounds fast and fair, with no hidden information leaking to other players.

### 1.2 Definitions
| Term | Meaning |
|---|---|
| Room | A private game session identified by a code, holding 2 to 6 players. |
| Host | The player who created the room. Has administrative controls. |
| Hand | One round of play, ending when a player empties their hand. |
| Game | One hand, played in one of the two game modes in Section 2.12a. |
| Discard pile | The face-up pile that play matches against. |
| Draw pile | The face-down deck that cards are drawn from. |

---

## 2. Uno Game Rules (Reference)

*Sources: Wikipedia, "Uno (card game)", which cites Mattel's rule sheets; secondary guides for stacking and call-penalty variants. Mattel's current official rules PDF should be checked before release, since the 2022 rulebook changed some details.*

### 2.1 Deck
- Standard deck: **108 cards**.
- Four colors (red, yellow, green, blue), each with 25 cards:
  - One **0**.
  - Two each of **1 through 9**.
  - Two each of **Skip**, **Draw Two**, and **Reverse**.
- Four **Wild** cards.
- Four **Wild Draw Four** cards.
- Newer sets (about 112 cards) add Wild Swap Hands or Wild Shuffle Hands, plus blank Customizable Wilds. The game may support these later, but they are not required for version 1.0.

### 2.2 Setup
1. Shuffle the deck.
2. Deal **7 cards** to each player.
3. Turn the top card of the remaining deck face up to start the discard pile.
4. The first player is chosen randomly (see Section 2.3 for the older dealer method).

**Starting card rule (2022 rules):** If the first face-up card is an Action or Wild card, set it aside, turn over another card, and repeat until a number card is showing.

**Older rule (still common in house play):** Action and Wild cards on the first discard take effect (see Section 2.6, "As first discard").

### 2.3 Turn order
- Play goes clockwise, starting with the player to the dealer's left.
- A Reverse card changes the direction.
- The dealer is chosen by each player drawing one card; the highest number deals. The 2022 rules dropped this method, so the online game can choose a random first player instead.

### 2.4 Taking a turn
On their turn a player must do one of the following:
1. **Play** one card that matches the top discard by **color**, **number**, or **symbol**.
2. **Play a Wild** or **Wild Draw Four** (subject to the restriction in 2.6).
3. **Draw** one card from the draw pile.
   - If the drawn card is playable, the player may play it immediately. Otherwise it stays in the hand.

**Drawing rule:** A player who draws may only play the card they just drew. Cards already in the hand cannot be played that turn.

Trading cards with other players is not allowed.

### 2.5 Choosing a color
- When a Wild or Wild Draw Four is played, the player names the new color before the turn ends.
- The current color may be restated.

### 2.6 Action cards

| Card | Effect when played | Effect as first discard |
|---|---|---|
| **Skip** | The next player misses their turn. | The player to the dealer's left misses a turn. |
| **Reverse** | Reverses the direction of play. | The dealer plays first, and play goes counterclockwise. |
| **Draw Two** | The next player draws 2 cards and misses their turn. | The player to the dealer's left draws 2 and misses a turn. |
| **Wild** | The player chooses the next color. | The player to the dealer's left chooses the color and plays first. |
| **Wild Draw Four** | The player chooses the next color. The next player draws 4 and misses their turn. | The card goes back into the deck and a new card is turned over. |

**Two-player game:** Reverse acts as Skip. The other player misses their turn.

**Wild Draw Four restriction:** It may only be played when the player holds **no card matching the current color**. Matching the number or symbol does not matter.

### 2.7 Wild Draw Four challenge
- The next player may **challenge** a Wild Draw Four.
- The player who played it must show their hand to the challenger.
- **Challenge succeeds** (the player had a matching color): the offender draws 4 cards, and the challenger takes the next turn.
- **Challenge fails:** the challenger draws 6 cards (the 4 owed plus 2 more) and loses their turn.
- The chosen color stays in effect either way.
- An illegal Wild Draw Four carries no penalty unless it is challenged.

### 2.8 Calling "Uno"
- A player who plays their second-to-last card must call **"Uno"**.
- **Penalty:** If the player does not call Uno and another player catches them before the next player's turn starts, the player draws **2 cards**.
- No penalty applies if no one catches the player in time, or if the player calls Uno before being caught.
- Catching happens when another player, before the next turn begins, points out the missed call (by playing, drawing, or otherwise acting on the discard pile).

### 2.9 Draw pile empty
- When the draw pile runs out, shuffle the discard pile (keeping the top card) to form a new draw pile.

### 2.10 Ending a hand and scoring
- A hand ends when a player plays their last card. That player wins the hand.
- If the last card played is a Draw Two or Wild Draw Four, the next player draws the required cards before scoring.
- Points for the winner, from the cards left in the other players' hands:
  - Number cards: face value.
  - Skip, Reverse, Draw Two: 20 points each.
  - Wild, Wild Draw Four: 50 points each.
  - Newer wild types: 40 points each.
- **Traditional game:** The first player to reach **500 points** wins. The online game does not use this format. It plays one hand in one of the game modes below.

### 2.12a Online game modes
- **Play till the end (default):** when a player empties their hand they finish 1st, and play continues with the rest. Players finish 2nd, 3rd and so on. The last player still holding cards is the loser. Each player who goes out scores the cards still held by the remaining players at that moment. Finished players are skipped in the turn order.
- **First out wins:** the first player to empty their hand wins and the game ends. The winner scores the cards in all other hands. The other players are ranked by the points left in their hand, fewest first. Equal points share a place.
- In both modes, a Draw Two or Wild Draw Four played as the last card makes the next player draw and lose their turn. It cannot be challenged.

### 2.11 Stacking (house rule, optional)
- Stacking is not part of standard rules. Mattel has said so, though some sources and house groups allow it.
- If enabled, a player may answer a Draw Two with another Draw Two (or a Wild Draw Four with another Wild Draw Four). The draws add up, and the next player must take the full total or stack again.
- Mixing +2 and +4 on each other is not allowed.

### 2.12 Other house rules (optional, not in the core game)
- **Seven-O (not in version 1.0):** Playing a 7 swaps hands with a chosen player. Playing a 0 passes every hand to the next player in the current direction.
- **Jump-In (not in version 1.0):** A player holding a card identical in color and number to the top discard may play it out of turn.
- Other variants (Elimination, Speed, Pirate Uno) are out of scope for version 1.0.

---

## 3. Room Management Requirements

Rooms are the core of the online experience. A room holds **minimum 2** and **maximum 6** players.

### 3.1 Creating a room
- **FR-R1:** A signed-in or guest player can create a room.
- **FR-R2:** On creation, the system generates a unique, short **room code** (for example, 6 characters, letters and digits, no ambiguous characters such as 0/O or 1/I).
- **FR-R3:** The creator becomes the **host**.
- **FR-R4:** The host sets room options:
  - Room name (optional).
  - Room size is fixed at 6 seats. The host does not choose it. A game can start with any 2 to 6 players.
  - Game mode: "Play till the end" (default) or "First out wins" (Section 2.12a). It is chosen in the lobby before the game starts, not when creating the room.
  - House rules toggle: stacking (off by default). Seven-O and Jump-In are not in version 1.0.
  - Public or private (default private).
- **FR-R5:** A room with fewer than 2 players cannot start.

### 3.2 Joining a room
- **FR-R6:** Players join by entering the room code, or from a public room list if the room is public.
- **FR-R7:** Players may also join with an invite link that includes the room code.
- **FR-R8:** The system rejects a join when the room is full (6 players) and shows a clear message.
- **FR-R9:** The system rejects a join when the game has already started, unless the room allows spectators. (Spectating is out of scope for version 1.0.)
- **FR-R10:** Each player chooses a display name. Names must be unique within the room; duplicates get a suffix such as "(2)".

### 3.3 Lobby
- **FR-R11:** The lobby lists all players in the room with name, ready status, and host marker.
- **FR-R12:** Players may toggle "ready". The host may start the game once at least 2 players are in the room and all are ready.
- **FR-R13:** The host can kick a player from the lobby or during a game (a kicked player's seat is removed).
- **FR-R14:** The host can transfer host to another player.
- **FR-R15:** If the host leaves, host passes automatically to the next player in join order.
- **FR-R16:** The host can change room settings in the lobby only, before the game starts.
- **FR-R17:** A player can leave a room at any time.

### 3.4 Room lifecycle
- **FR-R18:** A room with no players is closed and its code is released after a timeout (suggested: 5 minutes).
- **FR-R19:** A room that stays idle in the lobby longer than a set time (suggested: 30 minutes) is closed.
- **FR-R20:** The room code is not reused for at least 24 hours after closure.

---

## 4. Gameplay Requirements

### 4.1 Starting a game
- **FR-G1:** On start, the system shuffles the deck, deals 7 cards to each player, and sets the starting discard according to the rule in Section 2.2.
- **FR-G2:** The first player is chosen at random and shown to all players.
- **FR-G3:** Turn order and direction are displayed on screen.

### 4.2 Playing cards
- **FR-G4:** The system only lets the active player play a legal card. Illegal moves are rejected with a message.
- **FR-G5:** Playable cards in the active player's hand are highlighted, and the player can always play a card by clicking or tapping it.
- **FR-G6:** A player with no playable card draws one automatically (there is no Pass button). If the drawn card can be played, the player chooses to play it or keep it; either way the turn moves on. If it cannot be played, it is kept and the turn moves on.
- **FR-G7:** Wild and Wild Draw Four require the player to choose a color before the play is accepted.
- **FR-G8:** A Wild Draw Four may be played even when the player holds a matching color, as in the real game. The next player can challenge it (FR-G9). The challenge decides any illegal play.

### 4.3 Challenges and penalties
- **FR-G9:** After a Wild Draw Four, the next player may choose to challenge. The system shows the offender's hand privately to the challenger, then applies the outcome in Section 2.7.
- **FR-G10:** The system tracks the "Uno" state of each player.
- **FR-G11:** A player with 2 cards who plays a card but has not called Uno gets a catch window. The Uno button is available to that player until the next turn begins.
- **FR-G12:** Any other player may catch an uncalled Uno before the next turn begins. The penalty (2 cards) is applied automatically when the catch happens.
- **FR-G13:** The Uno button must be pressed by the player; the system does not call it automatically.
- **FR-G13a (house rule):** A player who plays their last card without having called Uno does not go out. The card is played and its effect applies, but the player draws 2 penalty cards and keeps playing. Drawing any card cancels an earlier Uno call.
- **FR-G13b (house rule):** Uno must be called before the next player moves. A player still holding one card without having called it by then has missed it: they can no longer call Uno or play that last card, and on their turn they must draw (the game draws for them). Their own extra turn (for example after a Skip with two players) does not count as the next player moving.

### 4.4 Turn timer
- **FR-G14:** Each move has a fixed time limit of 10 seconds. The host cannot change it, so a slow or disconnected player never stalls the game.
- **FR-G15:** On timeout, the system plays or draws for the player (draw one card, then pass if the drawn card is not playable).
- **FR-G16:** A player who times out repeatedly is marked as away. The game continues without waiting for them.

### 4.5 Ending hands and games
- **FR-G17:** When a player plays their last card, the system records their place and score (Section 2.12a). In "Play till the end" the game continues with the remaining players.
- **FR-G18:** Card points are counted per Section 2.10.
- **FR-G19:** When the game ends, every player sees a results screen with each place, score and the cards left in hand, and the room returns to the lobby.
- **FR-G20:** After a game ends, the host may start a new game in the same room with the same players, or close the room.

### 4.6 Disconnection and reconnection
- **FR-G21:** If a player disconnects, the game pauses the player's turn timer and marks them as disconnected.
- **FR-G22:** A disconnected player can rejoin the room within a grace period (suggested: 2 minutes) and resume their hand.
- **FR-G23:** If the grace period expires, the player's hand is played automatically (draw, then pass) for the rest of the hand, or the player is removed, based on a host setting. Default: auto-play until the player returns or leaves.
- **FR-G24:** If too few connected players remain (fewer than 2), the game pauses until another player joins or the room closes.

### 4.7 Game state and information rules
- **FR-G25:** Each player only sees their own hand. Other players' hands are shown as card counts only.
- **FR-G26:** The discard pile and the number of cards in the draw pile are visible to all.
- **FR-G27:** The game log shows the last actions (play, draw, color chosen, Uno, penalty, skip, reverse) without revealing hidden cards.

---

## 5. Communication and Player Experience

- **FR-C1:** The room includes an in-game text chat visible to all players in the room.
- **FR-C2:** Quick-emote reactions are optional for version 1.0.
- **FR-C3:** Sound effects and visual feedback for key events: play, draw, Uno, catch, reverse, skip, and win. A mute option is required.
- **FR-C4:** Players can see the scoreboard at any time.
- **FR-C5 (video call):** Players in a room can join an optional video call from the lobby or the game. Camera and microphone stay off until the player chooses to join. A player's live video replaces their avatar at the table; each player can mute their microphone, turn off their camera, or leave the call at any time, and others see a muted sign. The host can mute everyone else in the call at once; each muted player is told and can unmute themselves. Video goes directly between browsers (WebRTC, one link per pair of players); the server only relays setup messages between players in the same room who are both in the call. A TURN relay can be configured for networks that block direct links. The call needs HTTPS (or localhost).

---

## 6. Non-Functional Requirements

### 6.1 Performance
- **NFR-P1:** A card play from one client is shown to all other clients within 500 ms under normal network conditions.
- **NFR-P2:** A room of 6 players must run smoothly. Server load per room must stay within a fixed budget, to be set during design.

### 6.2 Reliability and consistency
- **NFR-R1:** The server is authoritative. Clients send intentions, and the server validates every move. Clients cannot see or change other players' cards.
- **NFR-R2:** Each game uses a random seed that is not exposed to clients, so the deck order cannot be predicted.
- **NFR-R3:** Game state is saved so that a server restart does not wipe active rooms, or the limitation is documented if not supported in version 1.0.

### 6.3 Security and privacy
- **NFR-S1:** Room codes must be hard to guess. The system limits join attempts per IP to prevent brute-force guessing.
- **NFR-S2:** Hands are only sent to their owner.
- **NFR-S3:** Player names are sanitized to prevent script injection in chat and the UI.
- **NFR-S4:** Chat is rate-limited to reduce spam.
- **NFR-S5:** Players can report or block abusive players. Reporting flows are to be defined.

### 6.4 Usability and accessibility
- **NFR-U1:** The game works on desktop browsers and on mobile (phone and tablet) browsers.
- **NFR-U2:** Cards are distinguishable without color alone (symbols and numbers are always shown).
- **NFR-U3:** The game meets WCAG 2.1 AA for contrast and keyboard access where practical.
- **NFR-U4:** Animations can be reduced or turned off.

### 6.5 Compatibility
- **NFR-C1:** Support the latest two versions of Chrome, Edge, Firefox, and Safari.
- **NFR-C2:** Works with stable connections down to roughly 1 Mbps.

### 6.6 Maintainability
- **NFR-M1:** The rules engine is separate from the network and UI layers, so it can be unit-tested without a network.
- **NFR-M2:** Rules, such as deck composition and scoring, are configurable, so variants can be added without rewriting core logic.

---

## 7. Out of Scope (Version 1.0)

- Matchmaking with strangers and ranked ladders.
- Spectators.
- Accounts with friends lists (guests and simple names only; accounts can come later).
- Paid features, cosmetics, and ads.
- Native mobile apps (browser only).
- Elimination, Speed, Pirate Uno, and other variants beyond the optional house rules listed in Section 2.12.
- Monetization and card skins.

---

## 8. Assumptions

- Players have a modern browser and an internet connection.
- Players will mostly play with friends who have the room code.
- Version 1.0 uses the standard 108-card deck.
- "Play till the end" is the default game mode.

---

## 9. Open Questions

1. Guest play only, or sign-up and login in version 1.0?
2. Should the online rules follow the 2022 Mattel rulebook or the older version? (This document uses 2022 rules where they differ, and notes older rules where relevant.)
3. Should stacking be on or off by default?
4. What is the default behavior when a player disconnects: auto-play, or remove the player?
5. Is a public room list needed in version 1.0, or private codes only?
6. Are there hosting or budget limits that should shape the real-time architecture?
7. What is the supported language set?

---

## 10. Source Notes

- Wikipedia, "Uno (card game)": https://en.wikipedia.org/wiki/Uno_(card_game)
- Gamerules, Uno rules: https://gamerules.com/rules/uno-rules/
- BlueStacks, Uno stacking rules guide: https://www.bluestacks.com/blog/game-guides/uno/uno-stacking-rules-guide-en.html

The stacking and call-penalty details came from lower-quality sources, so check them against Mattel's official rulebook before publication.
