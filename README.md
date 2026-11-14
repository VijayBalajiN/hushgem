# Hushgem

A free, unofficial fan-made practice tool for sealed-bid gem auctions, based on MegaGem, a game from Jane Street. Play against bots or with friends.

Hushgem is not affiliated with or endorsed by Jane Street. It uses none of the official art or text (the rules shown in the page are written in our own words), and it has no ads, tracking or payments. If Jane Street asks, it comes down.

- 3 to 5 players, sealed-bid auctions for gems, the value chart, missions, and a hidden hand.
- Bots: dumEinstein, aniket, tweakinn and reeshabh fill any empty seat.
- A coach panel shows the expected value of each lot from what has been revealed so far.

## Play

Open the page and press **New game** to play alone against bots.

To play with friends, press **Play with friends**, type a name, and **Create table**. Share the 4-character code. Friends open the same page, choose **Play with friends**, and enter the code. Pick the seats and chart, then **Start game**. Empty seats are filled by bots. Any player can rematch after the final scores.

## How live tables work

There is no game server. Every player's browser runs the same seeded game. Each player publishes only their own sealed bids and reveals, and every browser replays the game from everyone's published choices, so all screens agree. Players, a bot taking over an absent player, and rematches are all handled the same way.

Those published choices travel through free public MQTT brokers (`broker.emqx.io` and `broker.hivemq.com`) over secure WebSockets, as one small retained message per player under `hushgem/v1/<table code>/<player>`. Nothing is kept except that message, which is cleared when the player leaves or disconnects.

Things to know:

- The page asks search engines not to list it (`noindex`), but anyone with the link can open it.
- It is built for friendly practice. Every browser holds the whole game, so anyone who opens developer tools could look at hidden hands, and anyone who guesses a table code could watch that table.
- The brokers are free public services with no guarantee. If one is down, the other carries the table. To use your own broker, set `window.HUSHGEM_RELAYS = ['wss://your-broker/mqtt']` in a script before the game script.
- A background browser tab may be throttled. If a player is away for about 50 seconds the others can let a bot take their seat.

## Files

| File | What it is |
| --- | --- |
| `docs/index.html` | The built, self-contained page that GitHub Pages serves. |
| `index.html` | Source of the page (also what runs as a Claude artifact, where live tables use its built-in rooms). |
| `engine.js` | Game rules, scoring, bots, the value model, and the deterministic table replay. No DOM, so it also runs in Node. |
| `relay.js` | Gives the page its room interface on top of MQTT when it is not running inside claude.ai. |
| `vendor/mqtt.min.js` | [MQTT.js](https://github.com/mqttjs/MQTT.js) 5.10.4 browser bundle (MIT, see `vendor/mqtt-LICENSE.md`). |
| `build-site.py` | Inlines the engine, MQTT.js and the relay into `docs/index.html`. |

Rebuild after changing any source file:

```bash
python3 build-site.py
```

## Publishing on GitHub Pages

In the repository settings, open **Pages**, choose the `main` branch and the `/docs` folder, and save. The page appears at `https://<your-user>.github.io/<repository>/`.
