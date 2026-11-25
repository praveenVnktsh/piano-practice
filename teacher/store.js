// The teacher's conversation on disk (dev server + CLI). Kept in .teacher/ at the repo root:
//   messages.jsonl  student messages  {id, at, text, context}      (id: increasing integer)
//   replies.jsonl   teacher replies   {id, replyTo, at, text, actions?}
//   status.json     {thinking: <message id> | null, at}            ("Teacher is thinking…")
//   student.md      the teacher's notes about the student (goals, level, recurring issues)
//   assignments.json {assignments: [{id, at, task, action?, due?, done, doneAt?}]}  homework on Today
//   letters.json     {letters: [{id, at, text, readAt?}]}                          weekly review letters
//   comments.json    {comments: [{id, at, songId, first, last, text, readAt?, dismissedAt?}]}
//                    bar comments pinned to a bar range of a piece (first/last: 0-based measure indices)
import {appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {actionError, validateActions} from './actions.js';

export const TEACHER_DIR =
  process.env.TEACHER_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..', '.teacher');
export const MAX_TEXT = 4000;
export const MAX_REPLY = 20000;
export const MAX_CONTEXT_BYTES = 64 * 1024;
export const MAX_TASK = 300;
export const MAX_LETTER = 20000;
export const MAX_OPEN_ASSIGNMENTS = 30;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function jsonl(dir, file) {
  let text;
  try {
    text = readFileSync(join(dir, file), 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').flatMap(line => {
    if (!line.trim()) return [];
    try {
      const row = JSON.parse(line);
      return isObj(row) && Number.isInteger(row.id) ? [row] : [];
    } catch {
      return [];
    }
  });
}

export const readMessages = dir => jsonl(dir, 'messages.jsonl');
export const readReplies = dir => jsonl(dir, 'replies.jsonl');

export function readStatus(dir) {
  try {
    const s = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8'));
    return isObj(s) && Number.isInteger(s.thinking)
      ? {thinking: s.thinking, at: s.at ?? null}
      : {thinking: null, at: null};
  } catch {
    return {thinking: null, at: null};
  }
}

/** Everything the app shows: {messages, replies, status, assignments, letters}. Message contexts are left out (they're big). */
export function readThread(dir) {
  return {
    messages: readMessages(dir).map(({context: _context, ...m}) => m),
    replies: readReplies(dir),
    status: readStatus(dir),
    assignments: readAssignments(dir),
    letters: readLetters(dir),
    comments: readComments(dir),
  };
}

function readList(dir, file, key) {
  try {
    const json = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const list = Array.isArray(json?.[key]) ? json[key] : [];
    return list.filter(r => isObj(r) && Number.isInteger(r.id));
  } catch {
    return [];
  }
}

export const readAssignments = dir => readList(dir, 'assignments.json', 'assignments');
export const readLetters = dir => readList(dir, 'letters.json', 'letters');
export const readComments = dir => readList(dir, 'comments.json', 'comments');

export const MAX_COMMENT = 500;
export const MAX_COMMENTS_PER_SONG = 60;
const SONG_ID = /^[^\s]{1,200}$/;

/**
 * Pins a comment to a bar range of a piece: {songId, first, last, text} with first/last as
 * 0-based measure indices → the stored comment. Throws on bad input.
 */
export function addComment(dir, {songId, first, last = first, text} = {}) {
  const id = typeof songId === 'string' ? songId.trim() : '';
  if (!SONG_ID.test(id)) throw new Error('a comment needs a song id (no spaces)');
  if (!Number.isInteger(first) || first < 0) throw new Error('the first bar must be a whole number ≥ 1');
  if (!Number.isInteger(last) || last < first) throw new Error('the last bar must be a whole number, not before the first');
  if (last - first > 400) throw new Error('a comment covers at most 400 bars');
  const said = typeof text === 'string' ? text.trim() : '';
  if (!said) throw new Error('a comment needs text');
  if (said.length > MAX_COMMENT) throw new Error(`a comment is at most ${MAX_COMMENT} characters`);
  const list = readComments(dir);
  if (list.filter(c => c.songId === id && !c.dismissedAt).length >= MAX_COMMENTS_PER_SONG)
    throw new Error(`${id} already has ${MAX_COMMENTS_PER_SONG} comments; remove some first`);
  const comment = {id: Math.max(nextId(list), lastCommentId(dir) + 1), at: new Date().toISOString(), songId: id, first, last, text: said};
  writeComments(dir, [...list, comment]);
  return comment;
}

// Ids are never reused (a removed comment's id stays retired): the file keeps the last id given.
function lastCommentId(dir) {
  try {
    const n = JSON.parse(readFileSync(join(dir, 'comments.json'), 'utf8'))?.lastId;
    return Number.isInteger(n) ? n : 0;
  } catch {
    return 0;
  }
}
function writeComments(dir, list) {
  const lastId = Math.max(lastCommentId(dir), 0, ...list.map(c => c.id));
  writeAtomic(dir, 'comments.json', JSON.stringify({lastId, comments: list}, null, 1) + '\n');
}

function updateComment(dir, id, change) {
  const n = Number(id);
  const list = readComments(dir);
  const c = list.find(x => x.id === n);
  if (!c) throw new Error(`no comment ${id}`);
  if (change(c) !== false) writeComments(dir, list);
  return c;
}

/** The student opened a comment → the comment (readAt set once). */
export const markCommentRead = (dir, id) =>
  updateComment(dir, id, c => {
    if (c.readAt) return false;
    c.readAt = new Date().toISOString();
  });

/** The student dismissed a comment (it leaves the score; the teacher still sees it) → the comment. */
export const dismissComment = (dir, id) =>
  updateComment(dir, id, c => {
    if (c.dismissedAt) return false;
    c.dismissedAt = new Date().toISOString();
    c.readAt ||= c.dismissedAt;
  });

/** Removes a comment for good (the teacher's CLI) → the removed comment. */
export function removeComment(dir, id) {
  const n = Number(id);
  const list = readComments(dir);
  const c = list.find(x => x.id === n);
  if (!c) throw new Error(`no comment ${id}`);
  writeComments(dir, list.filter(x => x !== c));
  return c;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day 'YYYY-MM-DD'. */
export function isDay(v) {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Adds homework: {task, action?, due?: 'YYYY-MM-DD'} → the stored assignment. Throws on bad input. */
export function addAssignment(dir, {task, action, due} = {}) {
  const said = typeof task === 'string' ? task.trim() : '';
  if (!said) throw new Error('an assignment needs a task');
  if (said.length > MAX_TASK) throw new Error(`a task is at most ${MAX_TASK} characters`);
  if (due !== undefined && due !== null && !isDay(due)) throw new Error('--due must be a date like 2026-12-01');
  if (action !== undefined && action !== null) {
    const err = actionError(action);
    if (err) throw new Error(`action: ${err}`);
  }
  const list = readAssignments(dir);
  if (list.filter(a => !a.done).length >= MAX_OPEN_ASSIGNMENTS)
    throw new Error(`there are already ${MAX_OPEN_ASSIGNMENTS} open assignments; mark some done first`);
  const assignment = {
    id: nextId(list),
    at: new Date().toISOString(),
    task: said,
    ...(action ? {action} : {}),
    ...(due ? {due} : {}),
    done: false,
  };
  writeAtomic(dir, 'assignments.json', JSON.stringify({assignments: [...list, assignment]}, null, 1) + '\n');
  return assignment;
}

/** Marks an assignment done (or not done again) → the updated assignment. */
export function setAssignmentDone(dir, id, done = true) {
  const n = Number(id);
  const list = readAssignments(dir);
  const a = list.find(x => x.id === n);
  if (!a) throw new Error(`no assignment ${id}`);
  a.done = !!done;
  if (a.done) a.doneAt = new Date().toISOString();
  else delete a.doneAt;
  writeAtomic(dir, 'assignments.json', JSON.stringify({assignments: list}, null, 1) + '\n');
  return a;
}

/** Adds a review letter (Markdown) → the stored letter. */
export function addLetter(dir, text) {
  const said = typeof text === 'string' ? text.trim() : '';
  if (!said) throw new Error('a letter needs text');
  if (said.length > MAX_LETTER) throw new Error(`a letter is at most ${MAX_LETTER} characters`);
  const list = readLetters(dir);
  const letter = {id: nextId(list), at: new Date().toISOString(), text: said};
  writeAtomic(dir, 'letters.json', JSON.stringify({letters: [...list, letter]}, null, 1) + '\n');
  return letter;
}

/** Marks a letter read (the student opened it) → the letter. */
export function markLetterRead(dir, id) {
  const n = Number(id);
  const list = readLetters(dir);
  const l = list.find(x => x.id === n);
  if (!l) throw new Error(`no letter ${id}`);
  if (!l.readAt) {
    l.readAt = new Date().toISOString();
    writeAtomic(dir, 'letters.json', JSON.stringify({letters: list}, null, 1) + '\n');
  }
  return l;
}

/** Messages without any reply yet. */
export function openMessages(dir) {
  const answered = new Set(readReplies(dir).map(r => r.replyTo));
  return readMessages(dir).filter(m => !answered.has(m.id));
}

const nextId = rows => Math.max(0, ...rows.map(r => r.id)) + 1;

function writeAtomic(dir, file, text) {
  mkdirSync(dir, {recursive: true});
  const tmp = join(dir, `${file}.${process.pid}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, join(dir, file));
}


/** Validates and appends a student message → the stored message. Throws on bad input. */
export function addMessage(dir, fields) {
  if (!isObj(fields)) throw new Error('send a JSON object');
  const text = typeof fields.text === 'string' ? fields.text.trim() : '';
  if (!text) throw new Error('a message needs text');
  if (text.length > MAX_TEXT) throw new Error(`a message is at most ${MAX_TEXT} characters`);
  const context = fields.context ?? null;
  if (context !== null && !isObj(context)) throw new Error('context must be an object');
  if (context && Buffer.byteLength(JSON.stringify(context)) > MAX_CONTEXT_BYTES)
    throw new Error('context is too large');
  const message = {id: nextId(readMessages(dir)), at: new Date().toISOString(), text, context};
  mkdirSync(dir, {recursive: true});
  appendFileSync(join(dir, 'messages.jsonl'), JSON.stringify(message) + '\n');
  return message;
}

/** Validates and appends a teacher reply to message `replyTo` → the stored reply. Clears "thinking". */
export function addReply(dir, replyTo, text, actions) {
  const id = Number(replyTo);
  if (!Number.isInteger(id) || !readMessages(dir).some(m => m.id === id)) throw new Error(`no message ${replyTo}`);
  const said = typeof text === 'string' ? text.trim() : '';
  if (!said) throw new Error('a reply needs text');
  if (said.length > MAX_REPLY) throw new Error(`a reply is at most ${MAX_REPLY} characters`);
  const checked = validateActions(actions);
  const reply = {
    id: nextId(readReplies(dir)),
    replyTo: id,
    at: new Date().toISOString(),
    text: said,
    ...(checked.length ? {actions: checked} : {}),
  };
  mkdirSync(dir, {recursive: true});
  appendFileSync(join(dir, 'replies.jsonl'), JSON.stringify(reply) + '\n');
  if (readStatus(dir).thinking === id) setThinking(dir, null);
  return reply;
}

/** Shows (message id) or clears (null) "Teacher is thinking…" in the app. */
export function setThinking(dir, messageId) {
  if (messageId !== null) {
    const id = Number(messageId);
    if (!Number.isInteger(id) || !readMessages(dir).some(m => m.id === id)) throw new Error(`no message ${messageId}`);
    messageId = id;
  }
  const status = {thinking: messageId, at: new Date().toISOString()};
  writeAtomic(dir, 'status.json', JSON.stringify(status) + '\n');
  return status;
}

export const PROFILE_TEMPLATE = `# Student profile

<!-- Maintained by the teacher. Keep it short and current. -->

## Goals
- (ask on first meeting)

## Level
- (unknown)

## Pieces and exercises in progress

## Recurring issues

## Notes from lessons
`;

/** The teacher's notes about the student (student.md), or null when there are none yet. */
export function readProfile(dir) {
  try {
    return readFileSync(join(dir, 'student.md'), 'utf8');
  } catch {
    return null;
  }
}
