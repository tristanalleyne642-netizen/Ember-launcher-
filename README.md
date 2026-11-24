<p align="center">
  <img src="renderer/fox.svg" width="160" alt="Ember Launcher fox logo">
</p>

<h1 align="center">Ember Launcher</h1>

<p align="center">Your games, in one place.</p>

A game launcher for **Linux**, built with Electron. The library starts
**empty** — you add your own games. The launcher never downloads games;
it only starts programs already on your computer.

The fox logo is a hand-drawn geometric SVG (`renderer/fox.svg`).

## Run it

```sh
npm install   # first time only
npm start
```

Or run the packaged AppImage from `dist/` (see "Package" below).

If you run it as root, the `--no-sandbox` flag in `npm start` is needed
— it is already in the start script.

## The library

The Games tab is a Steam Deck / Epic style library: a dark blue-grey
page with portrait cover cards in a grid, filter tabs with live counts
(**ALL GAMES / INSTALLED / FAVORITES / COLLECTIONS**), a search box,
a sort control (Name / Recently added) and a status filter
(All / Running / Not running). A Steam Deck style hint bar
(MENU · SORT BY · OPTIONS · SELECT · BACK) runs along the bottom —
those hints are visual only.

- **Covers:** a game shows its own cover art when its `games.json`
  entry has a `cover` (a path to a portrait image). Games with no art
  get a styled placeholder card — dark ember card with the fox mark
  and the game's title in bold, never another game's art. Nova
  Fortress gets its own original cover
  (`renderer/covers/nova-fortress.svg`) when added from the Engines tab.
- **Favorites:** tap the ★ on a card to favorite it; the FAVORITES tab
  lists them.
- **Collections:** give a game a collection name in the Add form (or
  in `games.json`); the COLLECTIONS tab groups games under their
  collection headings.
- **INSTALLED** counts games whose executable file is actually on
  disk; a card whose file is missing says "Missing file — check the
  path" instead of a collection name.

## How to add a game

**From the launcher (easiest):**

1. Type the game's **name** in the "Add a game" section.
2. Type (or paste) the full path to the game's **executable file**,
   e.g. `/home/tristan/games/mygame/mygame.x86_64`.
3. Optionally give it a **collection** name to group it with other games.
4. Click **Add Game**. The game appears in the Library and is saved to
   `games.json` automatically.

**By editing the config file:**

Add an entry to `games.json`:

```json
{
  "games": [
    { "name": "My Game", "path": "/home/tristan/games/mygame/mygame.x86_64" }
  ]
}
```

Optional fields per entry: `"cover"` (path to a portrait cover image),
`"collection"` (a name to group the game) and `"favorite": true`.
Restart the launcher and the game shows up. Remove an entry from the
file (or click **✕** on the card in the launcher) to take a game out.

## How to play

- Click a game's **cover** (or its **▶ Play** button). The game starts
  as its own process, so it keeps running even if you close the
  launcher.
- While a game is running, its card shows a green **● Running** badge
  and a **■ Stop** button appears (Stop closes that game).
- If a game fails to start (bad path, missing file, no permission), the
  launcher shows the error in the window instead of crashing.

## Engines tab

Like the Epic Games Launcher offers Unreal Engine, the **Engines** tab
lists game engines you can get from the launcher:

- **NovaSource** (v0.2.0) — Tristan's own C++ game engine, Linux-only,
  now with real TF2 gameplay inside (Scout / Soldier / Heavy classes,
  TF2 movement, Scattergun + Rocket Launcher). Click **⬇ Download** to
  install it from the bundled release tarball
  (`engines-release/novasource-linux-0.2.0.tar.gz`, packed into the
  AppImage, so no internet is needed) into
  `~/.local/share/ember-launcher/engines/novasource-0.2.0/`. The button
  shows its progress (Installing… → Extracting… → Installed), then the
  card flips to **Installed** with the version badge. Once installed,
  the card offers **＋ Add Nova Fortress to library** — one click adds
  the installed engine binary (which *is* the playable Nova Fortress
  demo) to the Games tab, from where ▶ Play launches it. Installing the
  engine never adds anything to the library by itself — the library
  still starts empty.

The download/install step lives in `lib/engines.js` (`installEngine()`).
It also accepts a tarball from the NovaSource project's `releases/`
folder, or `EMBER_NOVASOURCE_TARBALL` pointing at one anywhere
(`EMBER_ENGINES_DIR` overrides the install root). The engine needs
`libsdl2-2.0-0` and `libsdl2-ttf-2.0-0` on the machine (see the
NovaSource README).

## Config file location

The launcher looks for `games.json` in this order:

1. `games.json` in the folder you start it from (the project folder
   when running from source)
2. `games.json` in the app's user-data folder (when running packaged)

If neither exists, it creates one when you add your first game.

## Tests

```sh
npm test
```

Headless tests for the game store, the process runner (launch / running
status / stop / launch failure / running indices shifting when a game
is removed) and the engines catalogue. No Electron needed.

## Package

```sh
npm run dist
```

Builds a Linux AppImage into `dist/` with electron-builder. Run it with
`./dist/Ember Launcher-0.1.0.AppImage` (or just double-click it).

## Project layout

```
main.js            Electron main process (window, IPC)
preload.js         Safe bridge between the page and the main process
renderer/          UI: index.html, styles.css, renderer.js, fox.svg,
                 covers/nova-fortress.svg (original Nova Fortress art)
lib/store.js       games.json load/save + validation
lib/launcher.js    Spawning games detached + running status
lib/engines.js     Engines catalogue (NovaSource) + install from the
                 bundled release tarball
engines-release/   NovaSource release tarball bundled with the launcher
                 (packed into the AppImage — no internet needed)
games.json         The library — starts empty on purpose
test/              Headless tests (npm test)
rust-prototype/    The earlier Rust/egui version, kept for reference
```

## Notes / caveats

- The library ships empty by design. Nothing is pre-loaded.
- The launcher only launches local executables and never downloads
  games from the internet. The one exception is the Engines tab,
  which installs NovaSource from a release tarball bundled with the
  launcher itself — also with no internet.
- Games that need their own launcher (e.g. Steam games) should be added
  by pointing at their launcher executable.
- If a game needs to run from its own folder (some games look for files
  next to the executable), launching by path still works in most cases
  because the path points straight at the real executable.
