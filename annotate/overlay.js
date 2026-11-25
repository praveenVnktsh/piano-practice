// Annotate overlay, dev server only (see plugin.js). Alt+A or the button
// toggles annotate mode: hover outlines an element, click it to leave a note.
// Notes POST to /__notes; GET /__notes brings back each note's state, reply and
// thread. A sidebar on the right, open unless closed last time and as wide as
// it was dragged, lists every open note by state; a note opens there with its
// thread and a reply box (POST /__replies), and Dismiss resolves it
// (POST /__dismiss). Done and dismissed notes leave the list and the page.
const COLORS = { queued: "#e11d48", working: "#f59e0b", done: "#16a34a", question: "#2563eb", dismissed: "#71717a" };
const GROUPS = [
  ["question", "Waiting on you"],
  ["working", "Working"],
  ["queued", "Queued"],
];
const stateOf = (n) => (Object.hasOwn(COLORS, n.state) ? n.state : "queued");
const isOpen = (n) => !["done", "dismissed"].includes(stateOf(n));
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const here = () => location.pathname + location.search;
const saved = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const keep = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

const CSS = `
  .__ann-bar{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;gap:8px;font:600 13px Inter,system-ui,sans-serif}
  .__ann-bar button{padding:8px 12px;border-radius:999px;border:0;background:#7c6cff;color:#fff;font:inherit;
    box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer}
  .__ann-bar button.on{background:#e11d48}
  .__ann-bar button.list{background:#18181b}
  html.__ann-side-open .__ann-bar{right:calc(var(--ann-width) + 16px)}
  html.__ann-side-open body{margin-right:var(--ann-width)}
  .__ann-hover{outline:2px dashed #e11d48 !important;outline-offset:2px !important;cursor:crosshair !important}
  .__ann-pin{position:absolute;z-index:2147483646;min-width:22px;height:22px;padding:0 4px;box-sizing:border-box;border-radius:11px;
    color:#fff;font:700 12px/22px Inter,system-ui,sans-serif;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.35);cursor:pointer}
  .__ann-box{position:fixed;z-index:2147483647;width:300px;padding:10px;border-radius:10px;background:#18181b;color:#fff;
    box-shadow:0 10px 30px rgba(0,0,0,.4);font:13px Inter,system-ui,sans-serif}
  .__ann-box textarea,.__ann-side textarea{width:100%;box-sizing:border-box;height:72px;margin:6px 0;padding:6px;border-radius:6px;
    border:1px solid #3f3f46;background:#0f0f12;color:#fff;font:inherit;resize:vertical}
  .__ann-box button,.__ann-side .act{margin-right:6px;padding:4px 10px;border-radius:6px;border:0;font:inherit;cursor:pointer}
  .__ann-box .save,.__ann-side .send{background:#7c6cff;color:#fff}
  .__ann-side{position:fixed;top:0;right:0;bottom:0;z-index:2147483647;width:var(--ann-width);box-sizing:border-box;overflow-y:auto;
    padding:14px 12px 80px;background:#111114;color:#e4e4e7;border-left:1px solid #27272a;font:13px/1.45 Inter,system-ui,sans-serif}
  .__ann-grip{position:absolute;top:0;left:0;bottom:0;width:6px;cursor:col-resize}
  .__ann-grip:hover,.__ann-grip.dragging{background:rgba(124,108,255,.5)}
  .__ann-side header{display:flex;align-items:center;justify-content:space-between;margin:0 4px 10px}
  .__ann-side header strong{font-size:14px}
  .__ann-side header button{border:0;background:none;color:#a1a1aa;font:inherit;cursor:pointer}
  .__ann-side .counts{display:flex;gap:6px;flex-wrap:wrap;margin:0 4px 12px}
  .__ann-side .count{padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#fff}
  .__ann-side h4{margin:14px 4px 6px;font-size:11px;color:#a1a1aa;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
  .__ann-item{border-radius:8px;margin-bottom:4px;background:#18181b;border:1px solid #27272a}
  .__ann-item.open{border-color:#7c6cff}
  .__ann-item .row{display:flex;gap:8px;align-items:flex-start;padding:8px}
  .__ann-item .go{flex:1;min-width:0;text-align:left;border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:0}
  .__ann-item .top{display:flex;gap:6px;align-items:center;font-size:11px;color:#a1a1aa}
  .__ann-item .dot{width:8px;height:8px;border-radius:50%;flex:none;margin-top:5px}
  .__ann-item .dismiss{flex:none;border:1px solid #3f3f46;background:none;color:#a1a1aa;border-radius:6px;padding:2px 8px;font:inherit;
    font-size:11px;cursor:pointer}
  .__ann-item .dismiss:hover{color:#fff;border-color:#71717a}
  .__ann-item .thread{padding:0 8px 8px}
  .__ann-item .who{font-size:11px;color:#a1a1aa;margin-top:8px}
  .__ann-item .said{white-space:pre-wrap}
  .__ann-item .mine{color:#86efac}
  .__ann-item .q{color:#93c5fd}
  .__ann-side .empty{padding:8px 4px;color:#a1a1aa}`;

function selector(el) {
  const parts = [];
  for (let n = el; n && n !== document.body && parts.length < 6; n = n.parentElement) {
    let p = n.tagName.toLowerCase();
    if (n.id) {
      parts.unshift(`${p}#${n.id}`);
      break;
    }
    const cls = [...n.classList].filter((c) => !c.startsWith("__ann")).slice(0, 2);
    if (cls.length) p += "." + cls.join(".");
    const label = n.getAttribute("aria-label");
    if (label) p += `[aria-label="${label}"]`;
    parts.unshift(p);
  }
  return parts.join(" > ");
}

export function mount() {
  let on = false;
  let hovered = null;
  let notes = [];
  let side = saved("__ann-side", "open") === "open";
  let width = Math.min(Math.max(Number(saved("__ann-width", 380)) || 380, 280), 760);
  let expanded = null;
  let seen = "";
  const live = new AbortController();
  const { signal } = live;

  const css = document.createElement("style");
  css.textContent = CSS;
  document.head.appendChild(css);

  const bar = document.createElement("div");
  bar.className = "__ann-bar";
  const listBtn = document.createElement("button");
  listBtn.className = "list";
  const btn = document.createElement("button");
  bar.append(listBtn, btn);
  const sidebar = document.createElement("aside");
  sidebar.className = "__ann-side";
  const grip = document.createElement("div");
  grip.className = "__ann-grip";
  document.body.append(bar, sidebar);

  function label() {
    btn.classList.toggle("on", on);
    btn.textContent = on ? "Annotating: click an element (Alt+A to stop)" : "Annotate (Alt+A)";
    listBtn.textContent = `Notes · ${notes.filter(isOpen).length} open`;
  }

  function toggle() {
    on = !on;
    if (!on && hovered) hovered.classList.remove("__ann-hover");
    label();
  }

  function sized() {
    document.documentElement.style.setProperty("--ann-width", width + "px");
  }

  function showSide(to) {
    side = to;
    keep("__ann-side", side ? "open" : "closed");
    sidebar.hidden = !side;
    document.documentElement.classList.toggle("__ann-side-open", side);
    render();
  }

  const ours = (el) => el.closest?.(".__ann-bar, .__ann-box, .__ann-pin, .__ann-side");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });
  listBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showSide(!side);
  });
  // Dragging the sidebar's left edge sets its width.
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    grip.classList.add("dragging");
    grip.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      width = Math.min(Math.max(innerWidth - ev.clientX, 280), Math.min(760, innerWidth - 320));
      sized();
    };
    const up = () => {
      grip.classList.remove("dragging");
      keep("__ann-width", String(width));
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  });
  addEventListener(
    "keydown",
    (e) => {
      if (e.altKey && e.code === "KeyA") {
        e.preventDefault();
        toggle();
      }
    },
    { signal },
  );
  document.addEventListener(
    "mouseover",
    (e) => {
      if (!on || ours(e.target)) return;
      if (hovered) hovered.classList.remove("__ann-hover");
      hovered = e.target;
      hovered.classList.add("__ann-hover");
    },
    { capture: true, signal },
  );
  document.addEventListener(
    "click",
    (e) => {
      if (!on || ours(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.target.classList.remove("__ann-hover");
      ask(e.target, e.clientX, e.clientY);
    },
    { capture: true, signal },
  );

  function ask(el, x, y) {
    const box = document.createElement("div");
    box.className = "__ann-box";
    box.style.left = Math.min(x, innerWidth - 320) + "px";
    box.style.top = Math.min(y + 10, innerHeight - 160) + "px";
    const text = (el.innerText ?? el.textContent ?? el.value ?? "").trim().slice(0, 80);
    box.innerHTML = `<div style="opacity:.7">${esc(el.tagName.toLowerCase())} ${text ? "· “" + esc(text) + "”" : ""}</div>
      <textarea placeholder="What should change?"></textarea>
      <button class="save">Save</button><button class="cancel">Cancel</button>`;
    document.body.appendChild(box);
    const area = box.querySelector("textarea");
    area.focus();
    const close = () => box.remove();
    const save = async () => {
      const note = area.value.trim();
      if (!note) return close();
      const r = el.getBoundingClientRect();
      const dark = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches;
      const body = {
        at: new Date().toISOString(),
        url: here(),
        viewport: [innerWidth, innerHeight],
        theme: document.documentElement.getAttribute("data-theme") || (dark ? "dark(system)" : "light(system)"),
        selector: selector(el),
        text,
        rect: [Math.round(r.x + scrollX), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)],
        note,
      };
      close();
      await fetch("/__notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      refresh();
    };
    box.querySelector(".cancel").onclick = close;
    box.querySelector(".save").onclick = save;
    area.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
      if (e.key === "Escape") close();
    });
  }

  // A note opened: its page, scrolled to where it was left, and its thread in the sidebar.
  function openNote(n) {
    expanded = n.id;
    showSide(true);
    const land = () => scrollTo({ top: Math.max(0, (n.rect?.[1] ?? 0) - 160), behavior: "smooth" });
    if (here() === n.url) return land();
    history.pushState({}, "", n.url);
    dispatchEvent(new PopStateEvent("popstate"));
    setTimeout(land, 700);
  }

  async function post(path, body) {
    await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    seen = "";
    refresh();
  }

  function item(n) {
    const state = stateOf(n);
    const open = expanded === n.id;
    const thread = (n.thread ?? []).map((r) => `<div class="who">you</div><div class="said">${esc(r.text)}</div>`).join("");
    return `
      <div class="__ann-item${open ? " open" : ""}" data-id="${esc(n.id)}">
        <div class="row">
          <span class="dot" style="background:${COLORS[state]}"></span>
          <button class="go">
            <div class="top"><span>#${esc(n.id)}</span><span>${esc(n.url)}</span></div>
            <div>${esc(n.note)}</div>
          </button>
          <button class="dismiss" title="Resolve and hide">Dismiss</button>
        </div>
        ${
          open
            ? `<div class="thread">
          ${n.reply ? `<div class="who">claude</div><div class="said ${state === "question" ? "q" : "mine"}">${esc(n.reply)}</div>` : ""}
          ${thread}
          <textarea placeholder="Reply"></textarea>
          <button class="act send">Send</button>
        </div>`
            : ""
        }
      </div>`;
  }

  function render() {
    document.querySelectorAll(".__ann-pin").forEach((p) => p.remove());
    for (const n of notes.filter((one) => one.url === here() && isOpen(one) && Array.isArray(one.rect))) {
      const p = document.createElement("div");
      p.className = "__ann-pin";
      p.textContent = n.id;
      p.title = n.note;
      p.style.background = COLORS[stateOf(n)];
      // Follow the element if it's still on the page (layouts differ between
      // devices), and never place a pin past the right edge: on phones that
      // widens the whole page.
      let [x, y, w] = n.rect;
      try {
        const el = n.selector && document.querySelector(n.selector);
        const r = el?.getBoundingClientRect();
        if (r && (r.width || r.height)) [x, y, w] = [r.x + scrollX, r.y + scrollY, r.width];
      } catch {
        // an old selector that no longer parses: keep the saved rect
      }
      const maxLeft = document.documentElement.clientWidth + scrollX - 24;
      p.style.left = Math.max(0, Math.min(x + w - 11, maxLeft)) + "px";
      p.style.top = Math.max(0, y - 11) + "px";
      p.onclick = (e) => {
        e.stopPropagation();
        openNote(n);
      };
      document.body.appendChild(p);
    }
    label();
    if (!side) return;
    const open = notes.filter(isOpen);
    const counts = GROUPS.map(([state, name]) => {
      const many = open.filter((n) => stateOf(n) === state).length;
      return many ? `<span class="count" style="background:${COLORS[state]}">${many} ${esc(name.toLowerCase())}</span>` : "";
    }).join("");
    const groups = GROUPS.map(([state, name]) => {
      const these = open.filter((n) => stateOf(n) === state).reverse();
      return these.length ? `<h4>${esc(name)}</h4>${these.map(item).join("")}` : "";
    }).join("");
    const done = notes.filter((n) => stateOf(n) === "done").length;
    sidebar.innerHTML = `<header><strong>Notes</strong><button class="close">Close</button></header>
      <div class="counts">${counts}<span class="count" style="background:${COLORS.done}">${done} done</span></div>
      ${groups || '<div class="empty">Nothing open.</div>'}`;
    sidebar.prepend(grip);
    sidebar.querySelector(".close").onclick = () => showSide(false);
    sidebar.querySelectorAll(".__ann-item").forEach((el) => {
      const n = notes.find((one) => one.id === el.dataset.id);
      el.querySelector(".go").onclick = () => {
        if (expanded !== n.id) return openNote(n);
        expanded = null;
        render();
      };
      el.querySelector(".dismiss").onclick = () => post("/__dismiss", { id: n.id });
      const area = el.querySelector("textarea");
      if (!area) return;
      const send = () => area.value.trim() && post("/__replies", { id: n.id, text: area.value.trim() });
      el.querySelector(".send").onclick = send;
      area.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
      });
    });
  }

  async function refresh() {
    try {
      const got = await (await fetch("/__notes")).json();
      if (!Array.isArray(got)) return;
      notes = got;
      const key = JSON.stringify(got) + here();
      // A poll does not redraw under a reply being typed.
      const typing = document.activeElement?.tagName === "TEXTAREA" && sidebar.contains(document.activeElement);
      if (key !== seen && !typing) {
        seen = key;
        render();
      }
    } catch {}
  }

  sized();
  showSide(side);
  refresh();
  const timer = setInterval(refresh, 3000);
  return () => {
    clearInterval(timer);
    live.abort();
    document.documentElement.classList.remove("__ann-side-open");
    for (const el of [css, bar, sidebar, ...document.querySelectorAll(".__ann-pin, .__ann-box")]) el.remove();
  };
}
