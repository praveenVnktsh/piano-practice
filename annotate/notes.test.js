import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

import { addNote, addReply, dismiss, readNotes, setStatus } from "./notes.js";

const fresh = () => mkdtempSync(join(tmpdir(), "annotate-notes-"));
const CLI = resolve(__dirname, "notes.js");
const run = (dir, ...args) => {
  try {
    return { code: 0, out: execFileSync("node", [CLI, ...args], { env: { ...process.env, ANNOTATE_NOTES_DIR: dir }, encoding: "utf8", stdio: "pipe" }) };
  } catch (e) {
    return { code: e.status, out: e.stdout + e.stderr };
  }
};

describe("the notes store", () => {
  test("gives each note the next id and starts it queued", () => {
    const dir = fresh();
    expect(addNote(dir, { note: "first" }).id).toBe("1");
    expect(addNote(dir, { note: "second" }).id).toBe("2");

    expect(readNotes(dir).map(({ id, note, state, reply }) => [id, note, state, reply])).toEqual([
      ["1", "first", "queued", ""],
      ["2", "second", "queued", ""],
    ]);
  });

  test("keeps ids stable when a line is unreadable", () => {
    const dir = fresh();
    addNote(dir, { note: "first" });
    writeFileSync(join(dir, "notes.jsonl"), readFileSync(join(dir, "notes.jsonl"), "utf8") + "{broken\n");
    addNote(dir, { note: "third" });

    expect(readNotes(dir).map((n) => n.id)).toEqual(["1", "2"]);
    setStatus(dir, "2", "done");
    expect(readNotes(dir).find((n) => n.note === "third").state).toBe("done");
  });

  test("a client cannot pick its own id or state", () => {
    const dir = fresh();
    addNote(dir, { note: "first" });
    expect(addNote(dir, { note: "x", id: "1", state: "done", reply: "hi" })).toMatchObject({ id: "2" });
    expect(readNotes(dir)[1]).toMatchObject({ id: "2", state: "queued", reply: "" });
  });

  test("merges a status onto its note", () => {
    const dir = fresh();
    addNote(dir, { note: "first" });
    setStatus(dir, "1", "question", "Which card?");

    expect(readNotes(dir)[0]).toMatchObject({ id: "1", state: "question", reply: "Which card?" });
    expect(JSON.parse(readFileSync(join(dir, "status.json"), "utf8"))).toEqual({ 1: { state: "question", reply: "Which card?" } });
  });

  test("refuses an unknown state or id", () => {
    const dir = fresh();
    addNote(dir, { note: "first" });
    expect(() => setStatus(dir, "1", "finished")).toThrow(/state/);
    expect(() => setStatus(dir, "9", "done")).toThrow(/no note 9/);
  });

  test("reads nothing from a directory that does not exist yet", () => {
    expect(readNotes(join(fresh(), "missing"))).toEqual([]);
  });
});

describe("the CLI", () => {
  test("status writes the state and reply", () => {
    const dir = fresh();
    addNote(dir, { note: "first" });

    expect(run(dir, "status", "1", "working", "On it").code).toBe(0);
    expect(readNotes(dir)[0]).toMatchObject({ state: "working", reply: "On it" });
  });

  test("status refuses a bad state and leaves the file alone", () => {
    const dir = fresh();
    addNote(dir, { note: "first" });

    const { code, out } = run(dir, "status", "1", "finished");
    expect(code).toBe(1);
    expect(out).toMatch(/queued, working, done, question/);
    expect(readNotes(dir)[0].state).toBe("queued");
  });

  test("list --open leaves out done notes", () => {
    const dir = fresh();
    addNote(dir, { note: "fix the gap", url: "/home", selector: "main > div.card" });
    addNote(dir, { note: "already fine", url: "/home" });
    setStatus(dir, "2", "done", "Done");

    expect(run(dir, "list").out).toMatch(/already fine/);
    const open = run(dir, "list", "--open").out;
    expect(open).toMatch(/#1 queued \/home main > div.card\n {2}fix the gap/);
    expect(open).not.toMatch(/already fine/);
  });

  test("a reply joins its note's thread and reopens it, keeping the answer it replies to", () => {
    const dir = fresh();
    addNote(dir, { note: "which one?" });
    setStatus(dir, "1", "question", "This or that?");

    addReply(dir, "1", "  that one ");

    const [note] = readNotes(dir);
    expect(note.state).toBe("queued");
    expect(note.reply).toBe("This or that?");
    expect(note.thread.map((one) => one.text)).toEqual(["that one"]);
  });

  test("a reply needs a note and some text", () => {
    const dir = fresh();
    addNote(dir, { note: "one" });
    expect(() => addReply(dir, "9", "hi")).toThrow(/no note 9/);
    expect(() => addReply(dir, "1", "  ")).toThrow(/text/);
  });

  test("dismissing resolves a note, keeping its reply", () => {
    const dir = fresh();
    addNote(dir, { note: "never mind" });
    setStatus(dir, "1", "working", "On it");

    dismiss(dir, "1");

    expect(readNotes(dir)[0]).toMatchObject({ state: "dismissed", reply: "On it" });
  });

  test("list --open leaves out dismissed notes too, and shows replies", () => {
    const dir = fresh();
    addNote(dir, { note: "gone" });
    addNote(dir, { note: "still here" });
    dismiss(dir, "1");
    addReply(dir, "2", "any news?");

    const open = run(dir, "list", "--open").out;
    expect(open).not.toMatch(/gone/);
    expect(open).toMatch(/still here\n {2}<- any news\?/);
  });

  test("an unknown command prints usage", () => {
    const { code, out } = run(fresh(), "frobnicate");
    expect(code).toBe(1);
    expect(out).toMatch(/usage/i);
  });
});
