// Dev server only: loads the annotate overlay into the page and keeps the
// notes it sends under .notes. vite.config.js adds it when ANNOTATE
// is set.
import { addNote, addReply, dismiss, NOTES_DIR, readNotes } from "./notes.js";

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

export function notesHandler(dir) {
  return (req, res, next) => {
    if (req.method === "GET") return send(res, 200, readNotes(dir));
    if (req.method !== "POST") return next();
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let fields;
      try {
        fields = JSON.parse(body);
      } catch {
        return send(res, 400, { error: "not JSON" });
      }
      if (!fields || typeof fields !== "object" || Array.isArray(fields) || typeof fields.note !== "string" || !fields.note.trim()) {
        return send(res, 400, { error: "a note needs text" });
      }
      send(res, 201, addNote(dir, fields));
    });
  };
}

// A POST of JSON, handed to act; whatever act refuses is a 400.
function posted(act, ok) {
  return (req, res, next) => {
    if (req.method !== "POST") return next();
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let fields;
      try {
        fields = JSON.parse(body);
      } catch {
        return send(res, 400, { error: "not JSON" });
      }
      try {
        act(fields ?? {});
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
      send(res, ok, { ok: true });
    });
  };
}

export const repliesHandler = (dir) => posted((said) => addReply(dir, String(said.id ?? ""), said.text), 201);

export const dismissHandler = (dir) => posted((said) => dismiss(dir, String(said.id ?? "")), 200);

export function annotate({ dir = NOTES_DIR } = {}) {
  return {
    name: "annotate",
    apply: "serve",
    transformIndexHtml: () => [
      { tag: "script", attrs: { type: "module" }, children: 'import { mount } from "/annotate/overlay.js"; mount();', injectTo: "body" },
    ],
    configureServer(server) {
      server.middlewares.use("/__notes", notesHandler(dir));
      server.middlewares.use("/__replies", repliesHandler(dir));
      server.middlewares.use("/__dismiss", dismissHandler(dir));
    },
  };
}
