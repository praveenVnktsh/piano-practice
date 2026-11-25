# Contributing to Piano Practice

Thanks for helping! Bug reports, new songs, and code changes are all welcome.

## Setup

```sh
git clone <your fork>
cd <repo>
npm install
npm run dev        # http://localhost:5173
```

You need Node.js 20 or newer (CI runs Node 22). Use a Chromium-based browser
to test MIDI input.

## Scripts

| Script                 | What it does                                                     |
| ---------------------- | ---------------------------------------------------------------- |
| `npm run dev`          | Dev server with hot reload (`ANNOTATE=1` adds the notes overlay) |
| `npm run build`        | Production build into `dist/`                                    |
| `npm run preview`      | Serve the production build                                       |
| `npm test`             | Unit tests (Vitest), once                                        |
| `npm run test:watch`   | Unit tests in watch mode                                         |
| `npm run lint`         | ESLint                                                           |
| `npm run format`       | Prettier (write)                                                 |
| `npm run format:check` | Prettier (check only)                                            |
| `npm run songs`        | Compile `songs/*.notes` into `public/songs/*.musicxml`           |

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run lint`, `npm test` and
`npm run build` on every push and pull request.

## Code style

- Plain ES modules, no framework, no TypeScript. The app ships as static files.
- **No new runtime dependencies** without discussing it in an issue first.
  Dev dependencies (tooling) are fine when they earn their keep.
- Formatting: Prettier (`.prettierrc.json`) and `.editorconfig`. Please format
  the files you touch (`npx prettier --write <files>`) rather than reformatting
  unrelated code in the same PR.
- Lint must pass without errors (`npm run lint`); try not to add warnings.
- Keep pure logic (score timing, note following, converters) free of DOM
  access so it can be unit-tested; put tests in `tests/`.
- Don't edit files in `src/vendor/` — they are unmodified third-party builds.
- Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing module
  boundaries; it documents the contracts between the shell, player and songs.

## Adding a song

The detailed guide is [`songs/README.md`](songs/README.md). The options are:

1. **Hand transcription**: write `songs/<id>.notes`, run `npm run songs`.
2. **Mutopia Project LilyPond**: `node tools/ly2musicxml.mjs piece.ly --title "…" --composer "…" --rights "…" --source "<url>" > public/songs/<id>.musicxml`.
3. **Existing MusicXML/MEI** with an open licence: copy it into `public/songs/`.

Then add an entry to `public/songs/catalog.json` with `id`, `title`,
`composer`, `difficulty`, `file`, `license`, `source` and `sourceUrl`, open
it in the app, and play through it (listen + practice) to check it.

### Licence rules for songs

- Bundled songs must be **public domain or openly licensed** (e.g. CC0, CC BY,
  CC BY-SA). The licence must apply to the **file** — the edition,
  engraving or transcription — not only to the composition. A public-domain
  composition in a copyrighted edition is not OK.
- Fill in `license`, `source` and `sourceUrl` in the catalog entry, and add an
  entry to `public/THIRD-PARTY-NOTICES.txt` for anything that requires
  attribution.
- Share-alike sources stay share-alike: a file converted from a CC BY-SA score
  is a derivative and keeps the same licence and attribution.
- Copyrighted pieces you want to practise privately go in
  `public/songs/local/` (gitignored, with its own `catalog.json`), or use
  **Import** in the app. Never commit them.

## Pull request checklist

- [ ] `npm run lint` passes with no errors
- [ ] `npm test` passes; new logic has tests where practical
- [ ] `npm run build` succeeds
- [ ] Tried the change in the browser (`npm run dev`), including MIDI or the
      on-screen keys if you touched practice mode
- [ ] No new runtime dependencies (or discussed first)
- [ ] New songs: open licence, catalog fields filled in, notices updated
- [ ] Docs updated (`README.md`, `docs/ARCHITECTURE.md`, `songs/README.md`)
      if behaviour or contracts changed

By contributing you agree that your contributions are licensed under the
project's [MIT License](LICENSE) (song files under the licence stated in
their catalog entry).
