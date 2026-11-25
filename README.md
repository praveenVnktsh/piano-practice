# Piano Practice

Current working app, checkpointed before moving away from Sites hosting.

## Run the web interface locally

```sh
python3 -m http.server 8879 --directory dist
```

Open http://localhost:8879 in a browser supporting Web MIDI, such as Chrome.
The interface is a static web app with no build step. Its current editable
JavaScript lives in `dist/library.mjs`, `dist/score-core.mjs`, and
`dist/practice.js`; the original guided lesson is in `dist/index.html`.
Content-hashed module copies are the currently published entry points.

## Current capabilities

- Guided Una Mattina measures 36–40 with original-score notehead highlights.
- MIDI note-following practice and one-pass synthesized piano playback.
- PDF viewing, local PDF recognition, MusicXML/MXL/MEI import, passage selection,
  browser-local score storage, and pitch corrections.
- A full-score OMR draft, explicitly requiring review outside the checked passage.

PDF recognition needs the separate local Audiveris helper. See
`local-converter/README.md` for the existing installation and its limitations.
It is not a cloud-hosted conversion service. The helper and downloaded engine
remain in the ignored `work/` folder on this machine.

## Deployment checkpoint

`.openai/hosting.json` records the existing Sites project identity. The current
published app remains at https://una-mattina-measure-37.spiffybuffalo6.chatgpt.site.
This checkpoint does not change hosting or application behavior.

Third-party attribution is in `dist/THIRD-PARTY-NOTICES.txt`.
