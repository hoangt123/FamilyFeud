# 📋 Family Feud Party

A self-hosted **Family Feud** party game for two teams: face-offs, strikes, steals,
three rounds and a **Fast Money** finale. Run it on a laptop, put the board on a TV,
and drive the game from the laptop or from your phone.

No accounts, no cloud, no app install. One Node process serves everything over your
local Wi-Fi.

---

## ✨ Features

- **Two teams.** Name them in the lobby and optionally list the players.
- **Type a response, and the board decides.** If it's on the board, the tile flips with
  a ding. If not, a giant ✗ slams onto the screen with the buzzer. Matching handles
  typos, plurals and common aliases ("tv" → *Watch TV*).
- **Face-off to start every round.** Each team gives one response to the new board. The
  #1 answer wins outright; otherwise the higher answer wins. If neither is on the board,
  the face-off goes again. The winner chooses to **play or pass**.
- **Three strikes, then the steal.** The other team gets one answer to take the whole bank.
- **Three rounds**, like the show: single, **double** and **triple** points. A tie after
  round 3 goes to a sudden-death face-off.
- **Fast Money finale**, taken from [Quiz Clash](https://github.com/hoangt123/Jeopardy).
  The leading team sends two finalists who get 25 and 30 seconds, with a buzzer at zero.
  Finalist 2 can't repeat finalist 1's answers, and 200 points wins.
- **Host safety nets:** ↶ Undo, click a tile to award an answer the text didn't match,
  face-off override buttons, double-click a score to fix it, and ⇄ to swap a question
  before anything is revealed.
- **40 surveys + 4 Fast Money sets** included, in simple JSON packs you can add to.

---

## 🚀 Quick start

Requires **Node.js 20+**.

```bash
npm install
npm start
```

```
  FAMILY FEUD PARTY  — survey says!
  ─────────────────────────────────────────────
  Game screen + controls:  http://localhost:8080/
  TV / projector (board):  http://192.168.1.50:8080/display
  Host controller (answers): http://192.168.1.50:8080/host
```

Open **http://localhost:8080/**, name the teams, and press **Start the Feud**.

### 📺 Screens

| URL        | What it is | Shows hidden answers? |
| ---------- | ---------- | --------------------- |
| `/`        | The board **plus** host controls, for running everything on one laptop. | No |
| `/display` | The board only, for a TV or projector. | No |
| `/host`    | Host controls on a phone or second window. Hidden answers appear faintly on the tiles so you can judge close calls. | **Yes** |

All screens stay in sync. The lobby shows QR codes for `/display` and `/host`.
Phones and TVs must be on the same Wi-Fi as the laptop.

---

## 🎮 How to play

The host types what the teams say. That's the whole job; the board does the rest.

1. **Face-off.** One player from each team buzzes in. Type each team's response in its
   box, in the order they buzzed. The #1 answer wins immediately; otherwise the higher
   of the two wins. ✗ next to a box means no answer or out of time.
2. **Play or pass.** The face-off winner decides who plays the board.
3. **Play.** Type each response. On the board, the tile flips and its points go into
   the bank. Not on the board (or already showing), it's a strike.
4. **Steal.** After three strikes, the other team confers and gives **one** answer. If
   it's on the board, they steal the bank. If not, the playing team keeps it.
5. **Round end.** The bank × the round multiplier goes to the winning team. Reveal the
   rest of the board for fun (no points), then start the next round.
6. **Fast Money.** After round 3 the leading team picks two finalists. Read each
   question aloud, press **Start timer**, and type the answers. Then hand over to
   finalist 2, whose repeats get the "eh-eh" buzzer. Reveal the answers one by one.
   Reaching 200 points wins the grand prize. 🏆

### 🛟 When the typed answer doesn't match

The matcher is forgiving, but people get creative:

- **Click the tile** they meant. It counts as a correct answer for the team answering now.
- **↶ Undo** takes back the last action, such as a strike, a reveal or a steal.
- During a face-off, use the **override** buttons to declare the winner.
- **Double-click** a team's score to set it to any number.

---

## 🧩 Custom surveys

Everything lives in [`packs/`](packs/) as JSON. Add a file, restart the server, and it
appears as a pack you can toggle in the lobby. See [`packs/README.md`](packs/README.md).

```jsonc
{
  "id": "my-pack",
  "title": "My Pack",
  "surveys": [
    {
      "prompt": "Name something people bring to a picnic.",
      "answers": [
        { "text": "Sandwiches", "points": 40, "accept": ["sandwich"] },
        { "text": "Blanket", "points": 25 },
        { "text": "Drinks", "points": 15, "accept": ["soda", "lemonade"] }
      ]
    }
  ]
}
```

Played surveys are remembered in `data/used-surveys.json`, so the next game draws
fresh ones until the pool runs out. Delete the file to start over.

---

## ⚙️ Configuration

Copy `.env.example` to `.env` to change the port, bind address or enable HTTPS
(`npm run gen-cert` makes a self-signed certificate).

## 🧪 Tests

```bash
npm test
```

Covers matching, face-offs, play/pass, strikes, steals, undo, round multipliers, sudden
death, Fast Money (including duplicate rejection) and what each screen is allowed to see.

## License

MIT
