// Performance run (Bars ▾ → Performance run): the whole piece once, in play-along time, no stops.
// Its results card scores three things, each 0–100, and an overall figure:
//
//   accuracy  right notes / (right + missed + stray), as for any play-along pass
//   timing    how close the notes you found were to the beat: on time counts fully, early or
//             late (outside ±120 ms, inside ±250 ms) half
//   evenness  steadiness of the pulse: the spread of your onsets around a straight line fitted
//             through them (so a steady tempo, faster or slower than marked, costs nothing),
//             from practice-core's evenness(); with a MIDI keyboard it also weighs how even the
//             touch was. null when fewer than six notes were linked to the score.
//   score     0.5 accuracy + 0.3 timing + 0.2 evenness (0.6 / 0.4 without evenness)
//
// performanceScore({counts: {perfect, early, late, miss, wrong}, evenness: {score} | null})
//   → {accuracy, timing, evenness, score, verdict}
// Pure; no DOM.

const clamp = v => Math.max(0, Math.min(100, Math.round(v)));
const VERDICTS = [[95, 'A clean performance.'], [85, 'Well performed.'], [70, 'A good run.'], [50, 'Taking shape.'], [0, 'Keep at it.']];

export function performanceScore({counts = {}, evenness = null} = {}) {
  const perfect = counts.perfect || 0, early = counts.early || 0, late = counts.late || 0, miss = counts.miss || 0, wrong = counts.wrong || 0;
  const hits = perfect + early + late;
  const accuracy = hits + miss + wrong ? clamp(100 * hits / (hits + miss + wrong)) : 0;
  const timing = hits ? clamp(100 * (perfect + 0.5 * (early + late)) / hits) : 0;
  const even = evenness && Number.isFinite(evenness.score) ? clamp(evenness.score) : null;
  const score = clamp(even == null ? 0.6 * accuracy + 0.4 * timing : 0.5 * accuracy + 0.3 * timing + 0.2 * even);
  return {accuracy, timing, evenness: even, score, verdict: VERDICTS.find(([min]) => score >= min)[1]};
}
