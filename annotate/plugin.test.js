import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "vite";
import { afterEach, describe, expect, test } from "vitest";

import { setStatus } from "./notes.js";
import { addNote } from "./notes.js";
import { annotate, dismissHandler, notesHandler, repliesHandler } from "./plugin.js";

let server;
afterEach(() => server?.close());

async function serve(dir, handler = notesHandler) {
  const handle = handler(dir);
  server = createServer((req, res) => handle(req, res, () => res.end("next")));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${server.address().port}`;
}

const post = (base, body) => fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body });

describe("the notes endpoint", () => {
  test("POST appends the note with an id it assigns", async () => {
    const dir = mkdtempSync(join(tmpdir(), "annotate-notes-"));
    const base = await serve(dir);

    const res = await post(base, JSON.stringify({ note: "too tight", url: "/home", id: "99" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "1", note: "too tight" });
    expect(readFileSync(join(dir, "notes.jsonl"), "utf8")).toBe('{"id":"1","note":"too tight","url":"/home"}\n');
  });

  test("GET returns the notes with their status merged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "annotate-notes-"));
    const base = await serve(dir);
    await post(base, JSON.stringify({ note: "one" }));
    await post(base, JSON.stringify({ note: "two" }));
    setStatus(dir, "2", "done", "Fixed");

    const res = await fetch(base);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual([
      { id: "1", note: "one", state: "queued", reply: "", thread: [] },
      { id: "2", note: "two", state: "done", reply: "Fixed", thread: [] },
    ]);
  });

  test.each([["{not json"], ["[1,2]"], ['"text"'], ['{"note":""}'], ['{"url":"/home"}']])("refuses %s with 400", async (body) => {
    const dir = mkdtempSync(join(tmpdir(), "annotate-notes-"));
    const base = await serve(dir);

    expect((await post(base, body)).status).toBe(400);
    expect(await (await fetch(base)).json()).toEqual([]);
  });

  test("passes other methods on", async () => {
    const base = await serve(mkdtempSync(join(tmpdir(), "annotate-notes-")));
    expect(await (await fetch(base, { method: "DELETE" })).text()).toBe("next");
  });
});

describe("the reply and dismiss endpoints", () => {
  test("a reply is kept on its note", async () => {
    const dir = mkdtempSync(join(tmpdir(), "annotate-notes-"));
    addNote(dir, { note: "one" });
    const base = await serve(dir, repliesHandler);

    expect((await post(base, JSON.stringify({ id: "1", text: "that one" }))).status).toBe(201);
    expect(readFileSync(join(dir, "replies.jsonl"), "utf8")).toMatch(/"text":"that one"/);
  });

  test.each([["{not json"], ['{"id":"1"}'], ['{"id":"9","text":"hi"}']])("a reply %s is refused with 400", async (body) => {
    const dir = mkdtempSync(join(tmpdir(), "annotate-notes-"));
    addNote(dir, { note: "one" });
    const base = await serve(dir, repliesHandler);

    expect((await post(base, body)).status).toBe(400);
  });

  test("dismissing a note resolves it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "annotate-notes-"));
    addNote(dir, { note: "one" });
    const base = await serve(dir, dismissHandler);

    expect((await post(base, JSON.stringify({ id: "1" }))).status).toBe(200);
    expect(readFileSync(join(dir, "status.json"), "utf8")).toMatch(/"dismissed"/);
    expect((await post(base, JSON.stringify({ id: "9" }))).status).toBe(400);
  });
});

describe("the plugin", () => {
  const named = (config) => config.plugins.some((p) => p.name === "annotate");
  const root = () => mkdtempSync(join(tmpdir(), "annotate-root-"));

  test("is in the dev server and not in a build", async () => {
    expect(annotate().apply).toBe("serve");
    expect(named(await resolveConfig({ configFile: false, root: root(), plugins: [annotate()] }, "serve"))).toBe(true);
    expect(named(await resolveConfig({ configFile: false, root: root(), plugins: [annotate()] }, "build"))).toBe(false);
  });

  test("loads the overlay into the page", () => {
    const [tag] = annotate().transformIndexHtml();
    expect(tag).toMatchObject({ tag: "script", attrs: { type: "module" }, injectTo: "body" });
    expect(tag.children).toMatch(/from "\/annotate\/overlay\.js"/);
  });

  test("mounts the endpoints at /__notes, /__replies and /__dismiss", () => {
    const used = [];
    annotate().configureServer({ middlewares: { use: (path, fn) => used.push([path, typeof fn]) } });
    expect(used).toEqual([
      ["/__notes", "function"],
      ["/__replies", "function"],
      ["/__dismiss", "function"],
    ]);
  });
});
