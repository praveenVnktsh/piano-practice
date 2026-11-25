// Beginner score aids (docs/ROADMAP.md, Phase 13): while a student is still on the Beginner level
// of the graded path, Beginner (Grade 0) pieces open with note names inside the noteheads. Hand
// colours are already on by default (Settings → Colour notes by hand). The student can still turn
// the names off; the player then remembers that (setting `beginnerAids: false`). Pure.
//
//   isBeginnerPiece(entry)              → a Grade 0 / beginner catalog entry (not an exercise)
//   studentIsBeginner(doc, library, curriculum) → the path's current level is Beginner (no progress
//                                         yet counts); `curriculum` is ./levels.js curriculum(), passed in
//                                         so the shell can load the path lazily
//   aidsFor(entry, {beginner})          → {names: true} | null — the `aids` hint the shell gives the player

export function isBeginnerPiece(entry) {
  if (!entry || typeof entry.id !== 'string' || /^(ex|sr|mutopia):/.test(entry.id)) return false;
  return entry.grade === 0 || (entry.grade == null && entry.difficulty === 'beginner');
}

export function studentIsBeginner(doc, library, curriculum) {
  try { return curriculum(doc, {library}).current.level.id === 'beginner'; } catch { return true; }
}

export const aidsFor = (entry, {beginner = true} = {}) => (beginner && isBeginnerPiece(entry) ? {names: true} : null);
