// The repair loop: when the student is stuck on a chord (src/practice/stuck.mjs), the player
// offers to loop that bar slowly. Clean passes bring the tempo back up; a few clean passes at
// the original tempo end the loop, and the player puts the section, loop and tempo back as they
// were and carries on from the bar after. Pure: the player owns the music, this owns the counting.
//
//   const [first, last] = repairSection(measures, mi, t);            // the bar (and the next one)
//   let s = startRepair({first, last, mode, tempo, section, loop});   // s.tempo: the slow tempo
//   ({state: s, tempo, clean, done} = repairStep(s, accuracy));       // after each pass
//   repairStatus(s, label) → "Repair loop · Bar 7 · clean 2 of 3 · ♩ = 84"
import {beatInfo} from '../score-core.mjs';

export const REPAIR_CLEAN = 95;      // accuracy (%) that counts as a clean pass
export const REPAIR_PASSES = 3;      // clean passes at the original tempo (or in Wait) to finish
export const REPAIR_SLOW = .7;       // the loop starts at this share of the tempo (Play along)
export const REPAIR_MIN_TEMPO = 40;  // ...but no slower than this
export const REPAIR_STEP = .1;       // each clean pass raises the tempo by about this share
const EPS = 1e-6;

/**
 * The bars to repair for a chord at score time `t` in measure `mi`: that bar, plus the next one
 * when the chord falls on the bar's last beat (the trouble is usually getting over the barline).
 */
export function repairSection(measures, mi, t) {
  const m = measures?.[mi];
  if (!m) return null;
  const last = t >= m.end - beatInfo(m.meter).len - EPS && mi + 1 < measures.length ? mi + 1 : mi;
  return [mi, last];
}

/** The slow tempo the loop starts at: 70 % of `tempo`, not below 40, never above `tempo`. */
export const slowTempo = tempo => Math.min(tempo, Math.max(REPAIR_MIN_TEMPO, Math.round(tempo * REPAIR_SLOW)));

/**
 * A new repair loop over bars [first, last]. `section`, `loop` and `tempo` are what to put back
 * afterwards; `mode` is 'wait' (tempo untouched: the music waits anyway) or 'timed'.
 */
export function startRepair({first, last = first, mode = 'wait', tempo, section, loop = false}) {
  const timed = mode === 'timed';
  return {
    first, last, mode: timed ? 'timed' : 'wait',
    tempo: timed ? slowTempo(tempo) : tempo,
    clean: 0,
    original: {section: [...section], loop: !!loop, tempo},
  };
}

/**
 * One pass of the repair loop finished with `accuracy` (%). A clean pass below the original
 * tempo raises it ~10 % (at least 1 BPM, at most to the original); a clean pass at the original
 * tempo (any clean pass in Wait) counts toward the finish. A slip starts the count again.
 * → {state, tempo (for the next pass), clean (count so far), raised, done}
 */
export function repairStep(state, accuracy) {
  const goal = state.original.tempo;
  const ok = accuracy >= REPAIR_CLEAN;
  let {tempo, clean} = state, raised = false;
  if (!ok) clean = 0;
  else if (state.mode === 'timed' && tempo < goal) {
    tempo = Math.min(goal, Math.max(tempo + 1, Math.round(tempo * (1 + REPAIR_STEP))));
    raised = true;
  } else clean++;
  const next = {...state, tempo, clean};
  return {state: next, tempo, clean, raised, done: clean >= REPAIR_PASSES};
}

/** The status line: "Repair loop · Bar 7 · clean 2 of 3 · ♩ = 63 → 90" (no tempo in Wait). */
export function repairStatus(state, label) {
  const goal = state.original.tempo;
  const tempo = state.mode === 'timed' ? ` · ♩ = ${state.tempo}${state.tempo < goal ? ` → ${goal}` : ''}` : '';
  return `Repair loop · ${label} · clean ${state.clean} of ${REPAIR_PASSES}${tempo}`;
}

/**
 * What to put back when the loop ends: the original section, loop setting and tempo, and the
 * bar to carry on from (the one after the repaired bars, or null when that is past the section).
 */
export function repairRestore(state) {
  const {section, loop, tempo} = state.original;
  const after = state.last + 1;
  return {section: [...section], loop, tempo, resumeAt: after <= section[1] ? Math.max(after, section[0]) : null};
}
