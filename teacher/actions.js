// Teacher reply actions: structured suggestions the app shows as buttons the student
// taps to apply (never run automatically). Pure — shared by the CLI/store (Node)
// and the in-app panel (browser), so both validate exactly the same way.
//
//   {type: 'open_song', id}                    a library id (bundled, local or import:…)
//   {type: 'set_section', first, last}         0-based measure indices, like pianoPlayer.getState().section
//   {type: 'set_tempo', bpm}                   20–300
//   {type: 'set_hands', hands}                 both | right | left
//   {type: 'set_mode', mode}                   wait | timed
//   {type: 'set_loop', on}                     true | false
//   {type: 'open_exercise', id}                an ex: id, e.g. ex:scale:C:major:both:2:up-down
//   {type: 'open_note_reading', level?}        a reading-trainer level id, e.g. treble
//   {type: 'plan', items: [{label, minutes?, action?}]}   a practice-plan checklist
// Every action may carry `label` (≤ 80 chars) to override its button text.

export const HANDS = ['both', 'right', 'left'];
export const MODES = ['wait', 'timed'];
export const MAX_ACTIONS = 10;
export const MAX_PLAN_ITEMS = 12;
export const EXERCISE_ID = /^ex:[a-z][a-z-]*:[A-G](?:s|b)?(?::[A-Za-z0-9-]+)*$/;
const LEVEL_ID = /^[a-z][a-z0-9-]{0,40}$/;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

// type → {required keys: check, optional keys: check}
const SPECS = {
  open_song: {req: {id: v => text(v, 200) || 'id must be a song id'}},
  set_section: {
    req: {
      first: v => (Number.isInteger(v) && v >= 0) || 'first must be a 0-based measure index (integer ≥ 0)',
      last: v => (Number.isInteger(v) && v >= 0) || 'last must be a 0-based measure index (integer ≥ 0)',
    },
  },
  set_tempo: {req: {bpm: v => (typeof v === 'number' && Number.isFinite(v) && v >= 20 && v <= 300) || 'bpm must be a number from 20 to 300'}},
  set_hands: {req: {hands: v => HANDS.includes(v) || `hands must be one of ${HANDS.join(', ')}`}},
  set_mode: {req: {mode: v => MODES.includes(v) || `mode must be one of ${MODES.join(', ')}`}},
  set_loop: {req: {on: v => typeof v === 'boolean' || 'on must be true or false'}},
  open_exercise: {req: {id: v => (typeof v === 'string' && v.length <= 120 && EXERCISE_ID.test(v)) || 'id must be an exercise id like ex:scale:C:major:both:2:up-down'}},
  open_note_reading: {opt: {level: v => (typeof v === 'string' && LEVEL_ID.test(v)) || 'level must be a level id like treble'}},
  plan: {req: {items: v => checkItems(v)}},
};
export const ACTION_TYPES = Object.keys(SPECS);

function checkItems(items) {
  if (!Array.isArray(items) || !items.length) return 'items must be a non-empty array';
  if (items.length > MAX_PLAN_ITEMS) return `a plan has at most ${MAX_PLAN_ITEMS} items`;
  for (const [i, item] of items.entries()) {
    const where = `items[${i}]`;
    if (!isObj(item)) return `${where} must be an object`;
    for (const key of Object.keys(item)) if (!['label', 'minutes', 'action'].includes(key)) return `${where}: unknown field ${key}`;
    if (!text(item.label, 200)) return `${where}.label must be text (≤ 200 chars)`;
    if ('minutes' in item && !(typeof item.minutes === 'number' && item.minutes > 0 && item.minutes <= 180)) return `${where}.minutes must be a number from 1 to 180`;
    if ('action' in item) {
      if (isObj(item.action) && item.action.type === 'plan') return `${where}.action can't be another plan`;
      const err = actionError(item.action);
      if (err) return `${where}.action: ${err}`;
    }
  }
  return true;
}

/** The first problem with one action, or '' when it's valid. */
export function actionError(action) {
  if (!isObj(action)) return 'an action must be an object';
  const spec = SPECS[action.type];
  if (!spec) return `type must be one of ${ACTION_TYPES.join(', ')}`;
  const req = spec.req || {}, opt = spec.opt || {};
  for (const key of Object.keys(action)) {
    if (key !== 'type' && key !== 'label' && !(key in req) && !(key in opt)) return `${action.type}: unknown field ${key}`;
  }
  if ('label' in action && !text(action.label, 80)) return `${action.type}: label must be text (≤ 80 chars)`;
  for (const [key, check] of Object.entries(req)) {
    if (!(key in action)) return `${action.type}: missing ${key}`;
    const ok = check(action[key]);
    if (ok !== true) return `${action.type}: ${ok}`;
  }
  for (const [key, check] of Object.entries(opt)) {
    if (!(key in action)) continue;
    const ok = check(action[key]);
    if (ok !== true) return `${action.type}: ${ok}`;
  }
  if (action.type === 'set_section' && action.last < action.first) return 'set_section: last must be ≥ first';
  return '';
}

/** Validates a whole actions list; throws an Error naming the first problem. */
export function validateActions(actions) {
  if (actions === undefined) return [];
  if (!Array.isArray(actions)) throw new Error('actions must be a JSON array');
  if (actions.length > MAX_ACTIONS) throw new Error(`at most ${MAX_ACTIONS} actions per reply`);
  actions.forEach((a, i) => {
    const err = actionError(a);
    if (err) throw new Error(`actions[${i}]: ${err}`);
  });
  return actions;
}

const bars = (first, last) => (first === last ? `bar ${first + 1}` : `bars ${first + 1}–${last + 1}`);

/** Default button text for an action (its `label` wins). `titleOf(id)` may name songs. */
export function describeAction(a, titleOf = () => '') {
  if (a.label) return a.label;
  switch (a.type) {
    case 'open_song': return `Open ${titleOf(a.id) || a.id}`;
    case 'set_section': return `Practise ${bars(a.first, a.last)}`;
    case 'set_tempo': return `Tempo ${a.bpm} BPM`;
    case 'set_hands': return a.hands === 'both' ? 'Both hands' : a.hands === 'right' ? 'Right hand only' : 'Left hand only';
    case 'set_mode': return a.mode === 'wait' ? 'Wait mode' : 'Timed mode';
    case 'set_loop': return a.on ? 'Loop on' : 'Loop off';
    case 'open_exercise': return `Open ${exerciseName(a.id)}`;
    case 'open_note_reading': return a.level ? `Note reading: ${a.level}` : 'Note reading';
    case 'plan': return 'Practice plan';
    default: return a.type;
  }
}

/** "ex:scale:Fs:minor:both:2" → "F♯ minor scale". */
export function exerciseName(id) {
  const [, kind = '', key = '', quality = ''] = String(id).split(':');
  const k = key.replace(/s$/, '♯').replace(/^([A-G])b$/, '$1♭');
  return [k, quality, kind.replace(/-/g, ' ')].filter(Boolean).join(' ');
}
