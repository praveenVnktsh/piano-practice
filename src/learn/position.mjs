// Hand-position preview (docs/ROADMAP.md, Phase 12): the keys each hand starts on, ghosted
// on the keyboard while the player waits at the start of a section. Pure logic, no DOM.

/**
 * The first `perHand` distinct pitches each hand plays in a passage (passage() from
 * src/score-core.mjs; held-over `carried` notes don't count), for the hands being practised.
 * → Map(midi → 'r' | 'l'), sorted by pitch.
 */
export function startingKeys(events = [], {hands = 'both', perHand = 5} = {}) {
  const out = new Map();
  for (const h of ['r', 'l']) {
    if (hands === 'right' && h === 'l') continue;
    if (hands === 'left' && h === 'r') continue;
    const seen = new Set();
    const mine = events.filter(e => !e.carried && (e.hand === 'l' ? 'l' : 'r') === h).sort((a, b) => a.t - b.t || a.n - b.n);
    for (const e of mine) {
      if (seen.size >= perHand) break;
      seen.add(e.n);
    }
    for (const n of seen) if (!out.has(n)) out.set(n, h);
  }
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}
