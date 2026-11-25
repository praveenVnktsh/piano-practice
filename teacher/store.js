// The teacher's conversation on disk (dev server + CLI). Kept in .teacher/ at the repo root:
//   messages.jsonl  student messages  {id, at, text, context}      (id: increasing integer)
//   replies.jsonl   teacher replies   {id, replyTo, at, text, actions?}
//   status.json     {thinking: <message id> | null, at}            ("Teacher is thinking…")
//   student.md      the teacher's notes about the student (goals, level, recurring issues)
import {appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateActions} from './actions.js';

export const TEACHER_DIR =
  process.env.TEACHER_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..', '.teacher');
export const MAX_TEXT = 4000;
export const MAX_REPLY = 20000;
export const MAX_CONTEXT_BYTES = 64 * 1024;

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

/** Everything the panel shows: {messages, replies, status}. Message contexts are left out (they're big). */
export function readThread(dir) {
  return {
    messages: readMessages(dir).map(({context: _context, ...m}) => m),
    replies: readReplies(dir),
    status: readStatus(dir),
  };
}

/** Messages without any reply yet. */
export function openMessages(dir) {
  const answered = new Set(readReplies(dir).map(r => r.replyTo));
  return readMessages(dir).filter(m => !answered.has(m.id));
}

function writeAtomic(dir, file, text) {
  mkdirSync(dir, {recursive: true});
  const tmp = join(dir, `${file}.${process.pid}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, join(dir, file));
}

const nextId = rows => Math.max(0, ...rows.map(r => r.id)) + 1;

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
