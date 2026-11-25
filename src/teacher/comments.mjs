// Bar comments and "Ask about these bars" (docs/ROADMAP.md, Phase 14): pure helpers shared by
// the player's markers (./bar-notes.js) and the Teacher panel. No DOM.
//
// A comment, as teacher/store.js keeps it:
//   {id, at, songId, first, last, text, readAt?, dismissedAt?}   first/last: 0-based measure indices

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A comment the app can show: well formed, not dismissed. */
export const isLiveComment = c =>
  isObj(c) && Number.isInteger(c.id) && typeof c.songId === 'string' && Number.isInteger(c.first) &&
  Number.isInteger(c.last) && c.first >= 0 && c.last >= c.first && typeof c.text === 'string' && !c.dismissedAt;

/**
 * The comments to draw on a piece with `measureCount` bars, clamped to the piece (a comment
 * starting past its end is left out), in bar order → [{...comment, first, last}].
 * `hidden`: ids the student dismissed in this tab (the server may not have heard yet).
 */
export function commentsFor(comments, songId, measureCount, hidden = new Set()) {
  if (!Array.isArray(comments) || songId == null || !(measureCount > 0)) return [];
  return comments
    .filter(c => isLiveComment(c) && c.songId === songId && !hidden.has(c.id) && c.first < measureCount)
    .map(c => ({...c, last: Math.min(c.last, measureCount - 1)}))
    .sort((a, b) => a.first - b.first || a.last - b.last || a.id - b.id);
}

/** Comments overlapping bars [first, last]. */
export const commentsOver = (list, first, last) => list.filter(c => c.first <= last && c.last >= first);

/** Unread comments in a list. */
export const unreadCount = list => list.filter(c => !c.readAt).length;

/**
 * The most relevant last practice pass over bars [first, last] of a song, from results newest
 * first: the same section if there is one, else a pass that covers those bars, else one that
 * overlaps them. → the result or null.
 */
export function lastResultFor(results, songId, [first, last]) {
  const mine = (Array.isArray(results) ? results : []).filter(
    r => isObj(r) && r.songId === songId && Array.isArray(r.section) && r.section.length === 2,
  );
  return (
    mine.find(r => r.section[0] === first && r.section[1] === last) ??
    mine.find(r => r.section[0] <= first && r.section[1] >= last) ??
    mine.find(r => r.section[0] <= last && r.section[1] >= first) ??
    null
  );
}

/** A practice:result trimmed for a message: the fields the teacher reads, misses in those bars first. */
export function compactResult(r, {maxMisses = 30} = {}) {
  if (!isObj(r)) return null;
  const keep = ['songId', 'section', 'mode', 'hands', 'tempo', 'right', 'wrong', 'accuracy', 'timing', 'durationMs', 'at', 'strategy'];
  const out = Object.fromEntries(keep.filter(k => r[k] !== undefined).map(k => [k, r[k]]));
  if (Array.isArray(r.misses)) out.misses = r.misses.slice(0, maxMisses);
  const remarks = [...(r.dynamics?.remarks || []), ...(r.articulation?.remarks || [])].filter(x => typeof x === 'string');
  if (remarks.length) out.remarks = remarks.slice(0, 4);
  return out;
}

/** "bars 5–8" / "bar 5" for 0-based indices, or with labels when given (`label(i)` → '5'). */
export function barsLabel(first, last, label = i => String(i + 1)) {
  const a = label(first), b = label(last);
  return first === last || a === b ? `bar ${a}` : `bars ${a}–${b}`;
}

/**
 * The attachment an "Ask about these bars" message carries (context.ask; teacher/cli.js prints it):
 * {songId, title, section: [first, last], bars, tempo?, hands?, lastResult, comments?}.
 */
export function askAttachment({songId, title, section, bars, tempo, hands, results = [], comments = []}) {
  const [first, last] = section;
  const lastResult = compactResult(lastResultFor(results, songId, section));
  return {
    songId,
    title: title || songId,
    section: [first, last],
    bars: bars || barsLabel(first, last),
    ...(tempo ? {tempo: Math.round(tempo)} : {}),
    ...(hands ? {hands} : {}),
    lastResult,
    ...(comments.length ? {comments: comments.slice(0, 5).map(({id, first: a, last: b, text}) => ({id, first: a, last: b, text}))} : {}),
  };
}
