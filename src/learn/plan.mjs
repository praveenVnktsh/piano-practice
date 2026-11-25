// "Learn this piece" (docs/ROADMAP.md, Phase 12): a step-by-step plan built from the
// piece's phrases (detectPhrases in src/practice-core.mjs). Pure logic, no DOM.
//
// Each phrase walks these steps, in order:
//   listen  – hear the phrase at the target tempo
//   right   – right hand alone (Wait mode)           } only when the phrase has
//   left    – left hand alone (Wait mode)            } notes in both hands
//   slow    – hands together, play along at ~60 % of the target tempo
//   tempo   – hands together, play along, the slow-practice ladder up to the target tempo
//   join    – this phrase joined to the one before it, at tempo (not for the first phrase)
// Phrases that only replay a repeat (every bar a second visit) are skipped; a piece of two
// phrases or more ends with
//   whole   – the whole piece, hands together, at tempo.
//
// A step is done by a practice:result that covers its bars with its hands, mode and
// (for play-along steps) at least its tempo, with accuracy ≥ PASS; `listen` by
// listening to the end of a passage that covers its bars.
// Step keys ("<first>-<last>:<kind>") name the bars, so a done step stays done
// for as long as the phrase it belongs to is detected the same way.

export const PASS = 90;              // accuracy (%) that completes a step
export const SLOW = .6;              // "slowly": this share of the target tempo
export const KINDS = ['listen', 'right', 'left', 'slow', 'tempo', 'join', 'whole'];

// What to do, shown in the prompt when a step is set up.
const HINTS = {
  listen: 'Hear how it goes', right: 'The app plays the left hand and waits for you', left: 'The app plays the right hand and waits for you',
  slow: 'Play along, slowly and in time', tempo: 'A little faster after each clean pass', join: 'Play the two phrases as one',
  whole: 'From the first bar to the last',
};
const HANDS_TEXT = {right: 'right hand', left: 'left hand', both: 'hands together'};

/** "Bars 5–8" / "Bar 3" / "Pickup – bar 4" from 0-based measure indices. */
export function barsLabel(measures, a, b = a) {
  const label = i => measures?.[i]?.label ?? String(i + 1);
  const pickup = !!measures?.[a]?.pickup;
  if (a === b) return pickup ? 'The pickup' : `Bar ${label(a)}`;
  return pickup ? `Pickup – bar ${label(b)}` : `Bars ${label(a)}–${label(b)}`;
}

/**
 * The plan for a piece → [step]. step = {key, kind, phrase (index), phrases (count),
 * section: [first, last], hands, mode: 'wait'|'timed', intent: 'listen'|'practice',
 * tempo, goal?, hint (what to do) (tempo to reach, `tempo` steps), strategy: 'off'|'ladder', label, detail}.
 * `phrases` from detectPhrases; `events` (with `hand`) decide whether the hands are
 * practised separately; `target` is the piece's tempo (quarter-note BPM).
 */
export function buildPlan({phrases = [], measures = [], events = []} = {}, {target = 100, slow = SLOW} = {}) {
  target = Math.max(20, Math.round(target) || 100);
  const slowTempo = Math.max(20, Math.min(target, Math.round(target * slow)));
  // A repeat played again (every bar a second visit) is learnt the first time round.
  const fresh = phrases.map((p, i) => ({p, i})).filter(({p}) => {
    for (let k = p.first; k <= p.last; k++) if (!(measures[k]?.visit > 1)) return true;
    return !measures.length;
  });
  const total = fresh.length;
  const steps = [];
  const inBars = (p, h) => {
    if (!measures.length) return true;
    const start = measures[p.first]?.start ?? -Infinity, end = measures[p.last]?.end ?? Infinity;
    return events.some(e => e.hand === h && e.t >= start && e.t < end);
  };
  fresh.forEach(({p, i: orig}, i) => {
    const section = [p.first, p.last];
    const bars = barsLabel(measures, p.first, p.last);
    const where = total > 1 ? `Phrase ${i + 1} of ${total}` : 'The piece';
    const add = (kind, opts) => steps.push({
      key: `${section[0]}-${section[1]}:${kind}`, kind, phrase: i, phrases: total, section,
      hands: 'both', mode: 'timed', intent: 'practice', tempo: target, strategy: 'off', hint: HINTS[kind], ...opts,
      detail: `${where} · ${bars}`,
    });
    add('listen', {intent: 'listen', label: 'Listen'});
    if (inBars(p, 'r') && inBars(p, 'l')) {
      add('right', {hands: 'right', mode: 'wait', tempo: slowTempo, label: 'Right hand alone'});
      add('left', {hands: 'left', mode: 'wait', tempo: slowTempo, label: 'Left hand alone'});
    }
    add('slow', {tempo: slowTempo, label: `Hands together, slowly (♩ = ${slowTempo})`});
    if (slowTempo < target) add('tempo', {tempo: slowTempo, goal: target, strategy: 'ladder', label: `Up to tempo (♩ = ${target})`});
    // Joined to whatever comes just before it in the score (a repeat included).
    if (orig > 0) {
      const prev = phrases[orig - 1];
      steps.push({
        key: `${prev.first}-${p.last}:join`, kind: 'join', phrase: i, phrases: total, section: [prev.first, p.last],
        hands: 'both', mode: 'timed', intent: 'practice', tempo: target, strategy: 'off', hint: HINTS.join,
        label: 'Join to the phrase before', detail: `${where} · ${barsLabel(measures, prev.first, p.last)}`,
      });
    }
  });
  if (phrases.length > 1 && total) {
    const last = phrases.at(-1).last, first = phrases[0].first;
    steps.push({
      key: `${first}-${last}:whole`, kind: 'whole', phrase: total - 1, phrases: total, section: [first, last],
      hands: 'both', mode: 'timed', intent: 'practice', tempo: target, strategy: 'off', hint: HINTS.whole,
      label: 'The whole piece', detail: `${barsLabel(measures, first, last)} · ♩ = ${target}`,
    });
  }
  return steps;
}

const covers = (section, step) => Array.isArray(section) && section[0] <= step.section[0] && section[1] >= step.section[1];

/**
 * Does a practice:result detail ({section, hands, mode, tempo, accuracy}) complete `step`?
 * Hands-separate steps take any tempo in either mode; play-along steps need at least the
 * step's goal tempo (the target for `tempo`, which starts slow and climbs) less 1 BPM.
 */
export function resultMeets(step, r) {
  if (!step || !r || step.intent !== 'practice') return false;
  if (!covers(r.section, step) || !(r.accuracy >= PASS)) return false;
  if (step.hands !== 'both') return r.hands === step.hands;
  if (r.hands !== 'both' || r.mode !== 'timed') return false;
  return r.tempo >= goalTempo(step) - 1;
}
/** A finished listen of `section` ([first, last]) completes a listen step that it covers. */
export const listenMeets = (step, section) => !!step && step.intent === 'listen' && covers(section, step);

/** The tempo a step must reach: the target for `tempo` steps (whose own tempo is the ladder's start). */
export const goalTempo = step => step?.goal ?? step?.tempo;

/** The first step not yet done (keys in `done`), or null when the plan is complete. */
export function currentStep(steps, done) {
  const set = done instanceof Set ? done : new Set(done || []);
  return steps.find(s => !set.has(s.key)) ?? null;
}

/** {done, total, index (0-based of the current step, = total when complete)}. */
export function planProgress(steps, done) {
  const set = done instanceof Set ? done : new Set(done || []);
  const n = steps.filter(s => set.has(s.key)).length;
  const cur = currentStep(steps, set);
  return {done: n, total: steps.length, index: cur ? steps.indexOf(cur) : steps.length};
}

/** One line for Today and the player: "Phrase 2 of 5 · Bars 5–8 — Left hand alone". */
export const stepText = step => (step ? `${step.label} · ${step.detail}` : '');

/**
 * Does the player's state ({section, hands, mode, tempo, strategy}) already match a step's
 * set-up? Then "Next step" starts it rather than setting it up again.
 */
export function isSetUp(step, state) {
  if (!step || !state?.section) return false;
  if (state.section[0] !== step.section[0] || state.section[1] !== step.section[1]) return false;
  if (step.intent === 'listen') return true;
  return state.hands === step.hands && state.mode === step.mode;
}

/**
 * The bars a short first listen covers: from `first`, whole bars until about `seconds`
 * at `tempo` (quarter notes per minute), at least one bar. → [first, last]
 */
export function listenSpan(measures, tempo, {first = 0, seconds = 30} = {}) {
  if (!measures?.length) return [0, 0];
  const qms = 60000 / Math.max(1, tempo || 60);
  const start = measures[first]?.start ?? 0;
  let last = first;
  for (let i = first; i < measures.length; i++) {
    if ((measures[i].end - start) * qms / 1000 > seconds + .5) break;
    last = i;
  }
  return [first, last];
}

/** Text for a step's hands ("right hand"). */
export const handsText = h => HANDS_TEXT[h] || HANDS_TEXT.both;
