# Piano Practice

Practise piano in the browser. Pick a piece from the library (or import your
own), watch it as falling notes or as one long unrolled line of sheet music,
listen to it on a sampled grand piano, then play along on a MIDI keyboard or the
on-screen keys while the app waits for the right notes.

It is a static web app: no account, no server, no tracking. Everything runs
locally in your browser.

<!-- TODO: add a screenshot (e.g. docs/screenshot.png) and reference it here. -->

_Screenshot coming soon._

## Features

- **Two views**: falling notes (a "piano roll" highway) or the full score
  rendered as a single unrolled system that scrolls with the music.
- **Listen** with a sampled grand piano (Salamander Grand Piano), with adjustable
  tempo and sustain pedal.
- **Practise** with a MIDI keyboard (Web MIDI) or the on-screen keyboard: the
  player waits for each note or chord before moving on.
- **Section looping**: choose a range of measures and loop it; your section
  and tempo are remembered per song.
- **Song library** of public-domain and openly licensed pieces, plus your own
  private songs.
- **Import** your own MusicXML (`.musicxml`, `.xml`, `.mxl`) or MEI files; they
  are stored only in your browser.

Web MIDI works in Chromium-based browsers (Chrome, Edge, Brave, Opera).
`localhost` counts as a secure context, so MIDI works in development.

## Quick start

Requires Node.js 20 or newer (CI uses Node 22).

```sh
npm install
npm run dev      # http://localhost:5173 with hot reload
```

Other scripts:

| Script            | What it does                                                |
| ----------------- | ----------------------------------------------------------- |
| `npm run build`   | Production build into `dist/` (static files, host anywhere) |
| `npm run preview` | Serve the built `dist/` locally                             |
| `npm test`        | Run the unit tests (Vitest)                                 |
| `npm run e2e`     | Build, serve with `vite preview`, run `tests/e2e` in headless Chrome |
| `npm run lint`    | Lint with ESLint                                            |
| `npm run format`  | Format with Prettier                                        |
| `npm run songs`   | Compile every `songs/*.notes` to `public/songs/*.musicxml`  |

## iPad on the music stand

The piano's USB cable goes to the Mac; the iPad shows the app. iPad Safari has no Web MIDI,
so the Mac relays the keyboard over Wi-Fi (`bridge.html`, `midi-relay/plugin.js`).

1. On the Mac: `npm run dev:ipad` (the dev server, reachable on the local network).
2. On the Mac, in Chrome: open `http://localhost:5173/bridge.html`, press **Connect piano** and
   allow MIDI. Keep the tab open. It lists the address for the iPad and the relay latency
   to every open app page (round trip; under 30 ms feels instant).
3. On the iPad, in Safari: open the address shown (e.g. `http://192.168.1.20:5173/`).
4. Home-screen app: tap **Share → Add to Home Screen → Add**. It opens full screen with
   the ivory quaver icon ("Practice"), on the paper background, without Safari's bars.

The relay looks after itself: the bridge sends a heartbeat every 3 s, the iPad tells
*connected* from *no signal* and *reconnecting…* (`relay:status` events, `src/midi-relay.js`),
and when the dev server restarts or the Wi-Fi drops, Vite reloads both pages once the Mac is
reachable again and the bridge reconnects the piano by itself (MIDI permission is remembered).

The screen stays awake while the player is listening or practising (and for 3 minutes after
the last note), and in the note-reading drill (`src/pwa/wakelock.js`). Over the dev server's
plain `http://` address Safari has no Wake Lock API, so a tiny muted inline video keeps
the iPad awake instead.

### Offline cache

A production build (`npm run build`, then any static host or `npm run preview`) registers a
service worker (`src/pwa/sw.js`, written to `dist/sw.js` by `src/pwa/plugin.js`) that caches the
app, the Verovio engine, the piano samples and the bundled songs on first visit, so the app
opens and plays without a network. Each build gets a new cache version; old ones are removed.
Service workers need `https://` or `localhost`, so the iPad on `http://<mac-ip>:5173` does not
get one. On the dev server it is off by default (it would get in the way of hot reload): open
`http://localhost:5173/?sw=1` to turn on a network-first dev worker, `?sw=0` to remove it.

### Backup

**Progress → Settings → Export my data** downloads one JSON file with your progress, journal,
teacher letters and profile, imported scores and settings (`backup/plugin.js` for the Mac's
`.data/` and `.teacher/`, `src/pwa/backup.js` for the browser). **Import backup** shows what
the file contains and asks before replacing anything; the previous state is kept in
`.data/backups/`.

## Adding songs

See [`songs/README.md`](songs/README.md) for the full guide. In short:

- **Bundled songs** live in `public/songs/` and are listed in
  `public/songs/catalog.json` (format in
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)).
- **Hand transcriptions** are written in the compact `.notes` format in
  `songs/` and compiled with `npm run songs`.
- **Mutopia Project scores** (LilyPond) can be converted with
  `node tools/ly2musicxml.mjs input.ly > public/songs/name.musicxml`.
- **Your own private songs** go in `public/songs/local/` with their own
  `public/songs/local/catalog.json`. That folder is gitignored.
- Or just use **Import** in the app: imported scores stay in your browser.

### Licence rule for songs

> Bundled songs must be **public domain or openly licensed**, with `license`,
> `source` and `sourceUrl` filled in in the catalog. The licence must cover the
> _file_ (the edition or transcription), not just the composition.
> Copyrighted pieces go in `public/songs/local/` (gitignored) and are never
> committed.

## Project structure

```
index.html                 app shell markup (sidebar + player)
src/main.js                boot: create shell, player, router
src/app/                   shell: router, library sidebar, catalog, imports
src/player.js              createPlayer(root) – listen / practice / MIDI / settings
src/song.js                loadSong(source) – parse a score into a Song
src/highway.js             falling-notes renderer
src/piano.js               instruments: layered grand, harpsichord, room, resonance, limiter, metronome
src/audio/                 velocity layers, pitch detection (mic), reverb, metronome sounds, sound settings
src/score-core.mjs         buildScore / passage / FollowNotes (pure logic)
src/verovio.js             shared Verovio WASM module
src/vendor/                unmodified third-party modules (Verovio)
src/styles/                app.css (player), shell.css (layout + sidebar)
public/songs/              bundled songs + catalog.json (open licences only)
public/songs/local/        your private songs (gitignored) + catalog.json
public/samples/grand/      Salamander Grand Piano V3: 5 velocity layers + release noises (src/audio/build-samples.mjs)
public/samples/harpsichord/ VCSL French harpsichord (CC0)
public/samples/piano/      single-layer Salamander set (fallback)
songs/*.notes              hand transcriptions (compiled by tools/notes2musicxml.mjs)
tools/                     ly2musicxml.mjs (Mutopia LilyPond → MusicXML), notes2musicxml.mjs
annotate/                  dev-only in-page notes overlay (see below)
tests/                     unit tests (Vitest)
```

Scores are rendered and timed by [Verovio](https://www.verovio.org)
(WebAssembly). [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) describes the
module contracts (catalog entries, `loadSong`, `createPlayer`, routes).

## Annotate workflow (development)

The dev server can show an overlay for leaving notes on the running app, which
is handy for reviewing UI changes or handing feedback to someone else (or a
coding agent).

```sh
ANNOTATE=1 npm run dev
```

- Press **Alt+A** in the page to annotate; save a note with Cmd/Ctrl+Enter.
- Notes are stored in `.notes/` (gitignored) as `notes.jsonl` plus status files.
- Work through them from the terminal:

  ```sh
  node annotate/notes.js list            # all notes
  node annotate/notes.js list --open     # only notes still open
  node annotate/notes.js status 3 done "Fixed in the sidebar"
  ```

  States: `queued`, `working`, `done`, `question`, `dismissed`. A reply left in
  the overlay joins the note's thread and reopens it.

The overlay is only added to the dev server when `ANNOTATE` is set; it is never
part of a production build.

## Optional: PDF recognition

Importing a PDF needs a separate local Audiveris (optical music recognition)
helper; see `local-converter/README.md`. It is optional, not bundled, and the
results are drafts that need checking against the original.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence and credits

The application code is released under the [MIT License](LICENSE).

Third-party components and content keep their own licences; see
[`public/THIRD-PARTY-NOTICES.txt`](public/THIRD-PARTY-NOTICES.txt) (also served
with the app). In particular:

- [Verovio](https://github.com/rism-digital/verovio) — LGPL-3.0-or-later
- Salamander Grand Piano V3 samples by Alexander Holm — CC BY 3.0 (five velocity
  layers and the release noises, folded to mono and re-encoded as MP3)
- Harpsichord samples from the [Versilian Community Sample Library](https://github.com/sgossner/VCSL)
  ("Harpsichord, French", Versilian Studios) — CC0 1.0
- The room's impulse response and the metronome sounds are generated in code (no recordings)
- Scores from the [Mutopia Project](https://www.mutopiaproject.org): Für Elise
  (Public Domain, typeset by Stelios Samelis) and the Moonlight Sonata, 1st
  movement (CC BY-SA 2.5, typeset by Stewart Holmes; the converted file remains
  CC BY-SA 2.5)
