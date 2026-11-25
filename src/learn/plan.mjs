// "Learn this piece" (docs/ROADMAP.md, Phase 12): a step-by-step plan built from the
// piece's phrases (detectPhrases in src/practice-core.mjs). Pure logic, no DOM.
//
// Phrases are grouped into passages of about 4–8 bars (groupPassages): short phrases are
// merged up to a phrase boundary; a phrase is split only when it is longer than 8 bars.
// Each passage walks these steps, in order:
//   listen  – hear the passage at the target tempo
//   right   – right hand alone (Wait mode)           } only when the passage has
//   left    – left hand alone (Wait mode)            } notes in both hands
//   slow    – hands together, play along at ~60 % of the target tempo
//   tempo   – hands together, play along, the slow-practice ladder up to the target tempo
//   join    – this passage joined to the one before it, at tempo (not for the first)
// A passage with the same notes as an earlier one (a repeat, a returning theme) is
// "same as passage N" and gets one quick step instead:
//   through – play it through, hands together, at tempo
// and a piece of two passages or more ends with
//   whole   – the whole piece, hands together, at tempo.
//
// A step is done by a practice:result that covers its bars with its hands, mode and
// (for play-along steps) at least its tempo, with accuracy ≥ PASS; `listen` by
// listening to the end of a section that covers its bars.
// Step keys ("<first>-<last>:<kind>") name the bars, so a done step stays done
// for as long as its passage is found the same way.

export const PASS = 90;              // accuracy (%) that completes a step
export const SLOW = .6;              // "slowly": this share of the target tempo
export const KINDS = ['listen', 'right', 'left', 'slow', 'tempo', 'join', 'through', 'whole'];
export const PASSAGE_MIN = 4, PASSAGE_MAX = 8;

// What to do, shown in the prompt when a step is set up.
const HINTS = {
  listen: 'Hear how it goes', right: 'The app plays the left hand and waits for you', left: 'The app plays the right hand and waits for you',
  slow: 'Play along, slowly and in time', tempo: 'A little faster after each clean pass', join: 'Play the two passages as one',
  through: 'You know this one already: play it through', whole: 'From the first bar to the last',
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
 * Phrases ({first, last}) → passages of about `min`–`max` bars, cut only at phrase ends.
 * A passage shorter than `min` takes in the next phrase while the two fit in `max`; a phrase
 * longer than `max` is cut into near-equal parts; a short last passage joins the one before
 * when they fit. A pickup bar doesn't count as a bar.
 */
export function groupPassages(phrases = [], measures = [], {min = PASSAGE_MIN, max = PASSAGE_MAX} = {}) {
  const len = (a, b) => b - a + 1 - (measures[a]?.pickup ? 1 : 0);
  const parts = [];
  for (const p of phrases) {
    const n = len(p.first, p.last);
    if (n <= max) { parts.push({first: p.first, last: p.last}); continue; }
    const k = Math.ceil(n / max), size = (p.last - p.first + 1) / k;
    for (let j = 0; j < k; j++) {
      parts.push({first: p.first + Math.round(j * size), last: j === k - 1 ? p.last : p.first + Math.round((j + 1) * size) - 1});
    }
  }
  const out = [];
  for (const p of parts) {
    const cur = out.at(-1);
    if (cur && len(cur.first, cur.last) < min && len(cur.first, p.last) <= max) cur.last = p.last;
    else out.push({...p});
  }
  if (out.length > 1) {
    const a = out.at(-2), b = out.at(-1);
    if (len(b.first, b.last) < min && len(a.first, b.last) <= max) { a.last = b.last; out.pop(); }
  }
  return out;
}

/**
 * The notes of a passage relative to its start, as a comparable string ('' without notes):
 * two passages with the same string are the same music.
 */
export function passagePrint(measures, events, {first, last}) {
  const start = measures[first]?.start, end = measures[last]?.end;
  if (start == null || end == null) return '';
  const r = x => Math.round(x * 96);
  return events.filter(e => e.t >= start && e.t < end)
    .map(e => `${r(e.t - start)}:${e.n}:${r(e.d || 0)}:${e.hand === 'l' ? 'l' : 'r'}`).sort().join(',');
}

/**
 * Literal repeats: runs of at least `min` bars whose notes match, bar for bar, an earlier run
 * (a repeat written out or unfolded, a returning theme). → [{first, last, from}] where bars
 * first…last are the same as from…from + (last − first). Bars without notes never match.
 */
export function repeatRuns(measures = [], events = [], {min = PASSAGE_MIN} = {}) {
  const prints = measures.map((m, i) => passagePrint(measures, events, {first: i, last: i}));
  const out = [];
  for (let i = 0; i < prints.length;) {
    let best = 0, from = -1;
    if (prints[i]) {
      for (let j = 0; j < i; j++) {
        let k = 0;
        while (i + k < prints.length && j + k < i && prints[j + k] && prints[j + k] === prints[i + k]) k++;
        if (k > best) { best = k; from = j; }
      }
    }
    if (best >= min) { out.push({first: i, last: i + best - 1, from}); i += best; } else i++;
  }
  return out;
}

/**
 * The passages of a plan, in score order: new music grouped from the phrases (groupPassages,
 * phrases clipped at repeats), and each literal repeat as one passage with `from` (its source bar).
 * → [{first, last, from?}]
 */
export function planPassages(phrases = [], measures = [], events = [], {min = PASSAGE_MIN, max = PASSAGE_MAX} = {}) {
  const runs = measures.length ? repeatRuns(measures, events, {min}) : [];
  if (!runs.length) return groupPassages(phrases, measures, {min, max});
  const out = [];
  let at = phrases[0]?.first ?? 0;
  const end = phrases.at(-1)?.last ?? -1;
  const fresh = (a, b) => {
    if (a > b) return;
    const clipped = phrases.filter(p => p.last >= a && p.first <= b).map(p => ({first: Math.max(a, p.first), last: Math.min(b, p.last)}));
    out.push(...groupPassages(clipped, measures, {min, max}));
  };
  for (const r of runs) {
    fresh(at, r.first - 1);
    out.push({first: r.first, last: r.last, from: r.from});
    at = r.last + 1;
  }
  fresh(at, end);
  return out;
}

/**
 * The plan for a piece → [step]. step = {key, kind, passage (index), passages (count),
 * section: [first, last], hands, mode: 'wait'|'timed', intent: 'listen'|'practice',
 * tempo, goal? (tempo to reach, `tempo` steps), same? (number of the passage it repeats, 0-based),
 * strategy: 'off'|'ladder', label, hint (what to do), detail ("Passage 2 of 6 · Bars 5–12")}.
 * `phrases` from detectPhrases; `events` (with `hand`) decide whether the hands are
 * practised separately and which passages repeat; `target` is the piece's tempo (♩ BPM).
 */
export function buildPlan({phrases = [], measures = [], events = []} = {}, {target = 100, slow = SLOW, min = PASSAGE_MIN, max = PASSAGE_MAX} = {}) {
  target = Math.max(20, Math.round(target) || 100);
  const slowTempo = Math.max(20, Math.min(target, Math.round(target * slow)));
  const passages = planPassages(phrases, measures, events, {min, max});
  const steps = [];
  const inBars = (p, h) => {
    if (!measures.length) return true;
    const start = measures[p.first]?.start ?? -Infinity, end = measures[p.last]?.end ?? Infinity;
    return events.some(e => e.hand === h && e.t >= start && e.t < end);
  };
  // Passages are numbered among the new music only: a repeat is "same as passage N".
  const number = [];
  let fresh = 0;
  passages.forEach((p, i) => {
    if (p.from == null) { number[i] = fresh++; return; }
    const src = passages.findIndex(q => q.from == null && q.first <= p.from && p.from <= q.last);
    number[i] = src >= 0 ? number[src] : 0;
  });
  const total = fresh;
  passages.forEach((p, i) => {
    const section = [p.first, p.last];
    const same = p.from != null ? number[i] : -1;
    const where = total > 1 ? `Passage ${number[i] + 1} of ${total}` : 'The piece';
    const base = {passage: number[i], passages: total, section, hands: 'both', mode: 'timed', intent: 'practice', tempo: target, strategy: 'off'};
    const add = (kind, opts) => steps.push({
      ...base, key: `${section[0]}-${section[1]}:${kind}`, kind, hint: HINTS[kind], ...opts,
      detail: same >= 0 ? `${barsLabel(measures, p.first, p.last)} · same as passage ${same + 1}` : `${where} · ${barsLabel(measures, p.first, p.last)}`,
    });
    if (same >= 0) { add('through', {label: 'Play it through', same}); return; }
    add('listen', {intent: 'listen', label: 'Listen'});
    if (inBars(p, 'r') && inBars(p, 'l')) {
      add('right', {hands: 'right', mode: 'wait', tempo: slowTempo, label: 'Right hand'});
      add('left', {hands: 'left', mode: 'wait', tempo: slowTempo, label: 'Left hand'});
    }
    add('slow', {tempo: slowTempo, label: `Hands together, slowly (♩ = ${slowTempo})`});
    if (slowTempo < target) add('tempo', {tempo: slowTempo, goal: target, strategy: 'ladder', label: `Up to tempo (♩ = ${target})`});
    if (i > 0) {
      const from = Math.max(passages[i - 1].first, p.first - max); // a long repeat before: its last bars
      steps.push({
        ...base, key: `${from}-${p.last}:join`, kind: 'join', section: [from, p.last], hint: HINTS.join,
        label: 'Join to the bars before', detail: `${where} · ${barsLabel(measures, from, p.last)}`,
      });
    }
  });
  if (passages.length > 1) {
    const first = passages[0].first, last = passages.at(-1).last;
    steps.push({
      key: `${first}-${last}:whole`, kind: 'whole', passage: Math.max(0, total - 1), passages: total, section: [first, last],
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

/** The button's words: "Passage 2 of 6 · Left hand" (just the label for a one-passage piece or the last step). */
export const stepTitle = step => (!step ? '' : step.kind === 'through' ? `Same as passage ${step.same + 1} · ${step.label}`
  : step.passages > 1 && step.kind !== 'whole' ? `Passage ${step.passage + 1} of ${step.passages} · ${step.label}` : step.label);

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
