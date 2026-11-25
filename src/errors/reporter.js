// Client error log: uncaught errors and unhandled promise rejections go to the dev server's
// /__errors endpoint (error-log/plugin.js → .data/errors.log), so problems on the iPad can be read
// on the Mac with `node tools/errors.mjs`.
//
//   installErrorReporting({endpoint}) → reporter   (once, from src/main.js; window.pianoErrors)
//   createErrorReporter({send, now, ua, url, …}) → {report(errorOrEvent), stats}   (pure; tested)
//
// The same error (message + first stack frame) is sent once a minute at most, with a count of the
// repeats; at most 10 reports a minute and 50 a session. A production build has no endpoint: the
// first failed post (404, 405, network error) turns reporting off for the session.

const firstFrame = stack => String(stack || '').split('\n').map(s => s.trim()).find(s => /:\d+(:\d+)?\)?$/.test(s)) || '';

/** {message, stack} from an Error, an ErrorEvent, a PromiseRejectionEvent's reason or anything else. */
export function normalizeError(input) {
  let e = input;
  if (e && typeof e === 'object' && 'reason' in e && !(e instanceof Error)) e = e.reason;              // unhandledrejection
  else if (e && typeof e === 'object' && 'error' in e && !(e instanceof Error)) {                     // ErrorEvent
    const where = e.filename ? ` (${e.filename}:${e.lineno ?? 0}:${e.colno ?? 0})` : '';
    if (e.error instanceof Error) e = e.error;
    else return {message: String(e.message || e.error || 'Script error'), stack: where.trim()};
  }
  if (e instanceof Error || (e && typeof e === 'object' && 'message' in e)) {
    const name = e.name && e.name !== 'Error' && !String(e.message).startsWith(e.name) ? `${e.name}: ` : '';
    return {message: `${name}${e.message ?? ''}`.trim() || String(e.name || 'Error'), stack: String(e.stack || '')};
  }
  let message;
  try { message = typeof e === 'string' ? e : JSON.stringify(e); } catch { message = String(e); }
  return {message: message || 'Unknown error', stack: ''};
}

export function createErrorReporter({send, now = () => Date.now(), ua = '', url = () => '', perMinute = 10, perSession = 50, dedupeMs = 60000} = {}) {
  const seen = new Map();   // key → {last, repeats}
  let times = [];           // send times in the last minute
  let off = false;
  const stats = {sent: 0, dropped: 0, last: null, enabled: true};

  async function report(input) {
    if (off) return false;
    const {message, stack} = normalizeError(input);
    const key = message + '\n' + firstFrame(stack);
    const t = now();
    const prev = seen.get(key);
    if (prev && t - prev.last < dedupeMs) { prev.repeats++; stats.dropped++; return false; }
    times = times.filter(x => t - x < 60000);
    if (times.length >= perMinute || stats.sent >= perSession) { stats.dropped++; return false; }
    const count = 1 + (prev?.repeats ?? 0);
    seen.set(key, {last: t, repeats: 0});
    if (seen.size > 200) seen.delete(seen.keys().next().value);
    times.push(t);
    stats.sent++;
    stats.last = message.slice(0, 200);
    const entry = {message: message.slice(0, 1000), stack: stack.slice(0, 4000), url: String(typeof url === 'function' ? url() : url).slice(0, 300), ua: String(ua).slice(0, 300), at: t};
    if (count > 1) entry.count = count;
    try {
      const ok = await send(entry);
      if (ok === false) { off = true; stats.enabled = false; }
      return ok !== false;
    } catch { off = true; stats.enabled = false; return false; }
  }
  return {report, stats, disable() { off = true; stats.enabled = false; }};
}

/** Wires window `error` / `unhandledrejection` to the endpoint. Returns the reporter. */
export function installErrorReporting({endpoint = '/__errors', win = window} = {}) {
  if (win.pianoErrors) return win.pianoErrors;
  const send = async entry => {
    const r = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(entry), keepalive: true});
    // The dev server answers JSON; a static host's 404 / 405 / index.html means "no endpoint".
    return r.ok && /json/.test(r.headers.get('content-type') || '');
  };
  const reporter = createErrorReporter({send, ua: win.navigator?.userAgent || '', url: () => win.location?.href || ''});
  win.addEventListener('error', e => {
    // Failed <img>/<script> loads bubble here without a message; they are not script errors.
    if (!e || (!e.message && !e.error)) return;
    reporter.report(e);
  });
  win.addEventListener('unhandledrejection', e => reporter.report(e));
  win.pianoErrors = reporter;
  return reporter;
}
