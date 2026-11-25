// Notes left with the annotate overlay, and a CLI for whoever acts on them:
//   node annotate/notes.js list [--open]
//   node annotate/notes.js status <id> <queued|working|done|question|dismissed> [reply]
// A reply left in the overlay joins its note's thread and reopens the note.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STATES = ["queued", "working", "done", "question", "dismissed"];
const CLOSED = ["done", "dismissed"];
export const NOTES_DIR = process.env.ANNOTATE_NOTES_DIR || resolve(dirname(fileURLToPath(import.meta.url)), "..", ".notes");

function lines(dir) {
  let text = "";
  try {
    text = readFileSync(join(dir, "notes.jsonl"), "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    try {
      const note = JSON.parse(line);
      return note && typeof note === "object" && note.id ? [note] : [];
    } catch {
      return [];
    }
  });
}

function statuses(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
  } catch {
    return {};
  }
}

function replies(dir) {
  let text = "";
  try {
    text = readFileSync(join(dir, "replies.jsonl"), "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    try {
      const reply = JSON.parse(line);
      return reply && typeof reply === "object" && reply.id ? [reply] : [];
    } catch {
      return [];
    }
  });
}

export function readNotes(dir) {
  const status = statuses(dir);
  const said = replies(dir);
  return lines(dir).map((note) => ({
    ...note,
    state: "queued",
    reply: "",
    ...status[note.id],
    thread: said.filter((one) => one.id === note.id).map(({ text, at }) => ({ text, at })),
  }));
}

export function addNote(dir, fields) {
  const { id: _id, state: _state, reply: _reply, ...rest } = fields;
  const last = Math.max(0, ...lines(dir).map((n) => Number(n.id) || 0));
  const note = { id: String(last + 1), ...rest };
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "notes.jsonl"), JSON.stringify(note) + "\n");
  return note;
}

export function setStatus(dir, id, state, reply = "") {
  if (!STATES.includes(state)) throw new Error(`state must be one of ${STATES.join(", ")}, not ${state}`);
  if (!lines(dir).some((n) => n.id === id)) throw new Error(`no note ${id}`);
  const status = { ...statuses(dir), [id]: { state, reply } };
  const tmp = join(dir, "status.json.tmp");
  writeFileSync(tmp, JSON.stringify(status, null, 1) + "\n");
  renameSync(tmp, join(dir, "status.json"));
}

export function addReply(dir, id, text) {
  const said = String(text ?? "").trim();
  if (!said) throw new Error("a reply needs text");
  const note = readNotes(dir).find((n) => n.id === id);
  if (!note) throw new Error(`no note ${id}`);
  appendFileSync(join(dir, "replies.jsonl"), JSON.stringify({ id, text: said, at: new Date().toISOString() }) + "\n");
  setStatus(dir, id, "queued", note.reply);
}

export function dismiss(dir, id) {
  const note = readNotes(dir).find((n) => n.id === id);
  if (!note) throw new Error(`no note ${id}`);
  setStatus(dir, id, "dismissed", note.reply);
}

function format(n) {
  const head = [`#${n.id}`, n.state, n.url, n.selector].filter(Boolean).join(" ");
  return [head, `  ${n.note}`, ...(n.reply ? [`  -> ${n.reply}`] : []), ...(n.thread ?? []).map((r) => `  <- ${r.text}`)].join("\n");
}

const USAGE = "usage: notes.js list [--open]\n       notes.js status <id> <queued|working|done|question|dismissed> [reply]";

function main([command, ...args]) {
  if (command === "list") {
    const notes = readNotes(NOTES_DIR).filter((n) => !args.includes("--open") || !CLOSED.includes(n.state));
    if (notes.length) console.log(notes.map(format).join("\n\n"));
    return 0;
  }
  if (command === "status" && args.length >= 2) {
    const [id, state, ...reply] = args;
    try {
      setStatus(NOTES_DIR, id, state, reply.join(" "));
    } catch (e) {
      console.error(e.message);
      return 1;
    }
    return 0;
  }
  console.error(USAGE);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
