# Local PDF recognition helper

The hosted static app calls `http://127.0.0.1:8937`. PDFs stay on the user's machine.
Only the exact production origin and the local development origin are allowed.
The helper binds loopback only and runs one Audiveris job at a time.

This installation's working helper is:
`/Users/praveenvnktsh/Documents/Codex/2026-11-23/una-mattina-practice/work/score_converter.py`

Start it with the executable launcher in this chat's `outputs/start-score-converter.command`.
It is currently a foreground helper process, not a login daemon. Restart it when needed.

For a fresh installation, use Java 25, build official Audiveris tag 5.11.0 with
`./gradlew :app:installDist`, place that checkout at `audiveris-src/` beside the helper,
and place official Tesseract `eng.traineddata` in adjacent `tessdata/`.
Source: https://github.com/Audiveris/audiveris/tree/5.11.0
OCR data: https://github.com/tesseract-ocr/tessdata_fast

The engine accepts PDFs and exports MusicXML. Recognition errors are expected.
Partial recognition is explicitly flagged. The library requires passage review before MIDI practice.
Some scans, short systems, voices, ties, repeats, and complex layouts require manual editing.
Corrections of rhythm/missing notes/ties should be made in Audiveris or a notation editor,
then re-imported as MusicXML/MEI. This app can correct individual pitches directly.
The original imported PDF and recognized notation persist in browser IndexedDB.
