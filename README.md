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
| `npm run lint`    | Lint with ESLint                                            |
| `npm run format`  | Format with Prettier                                        |
| `npm run songs`   | Compile every `songs/*.notes` to `public/songs/*.musicxml`  |

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
src/piano.js               sampled grand piano
src/score-core.mjs         buildScore / passage / FollowNotes (pure logic)
src/verovio.js             shared Verovio WASM module
src/vendor/                unmodified third-party modules (Verovio)
src/styles/                app.css (player), shell.css (layout + sidebar)
public/songs/              bundled songs + catalog.json (open licences only)
public/songs/local/        your private songs (gitignored) + catalog.json
public/samples/piano/      Salamander Grand Piano samples
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
- Salamander Grand Piano samples by Alexander Holm — CC BY 3.0
- Scores from the [Mutopia Project](https://www.mutopiaproject.org): Für Elise
  (Public Domain, typeset by Stelios Samelis) and the Moonlight Sonata, 1st
  movement (CC BY-SA 2.5, typeset by Stewart Holmes; the converted file remains
  CC BY-SA 2.5)
