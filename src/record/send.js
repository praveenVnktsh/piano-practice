// "Send to teacher": a message in the Teacher thread (POST /__teacher/messages, dev server)
// with the usual practice context plus `recording` — a compact summary and the take id, so the
// teacher can run `node teacher/cli.js review <takeId>` for the full report.
import {compactSummary, sendText} from './text.mjs';
import * as store from './store.js';

export async function sendTake(take, {text = sendText(take)} = {}) {
  let context = {recording: compactSummary(take)};
  try {
    const m = await import('../teacher/context.js');
    context = await m.collectContext({recording: compactSummary(take)});
  } catch {}
  let res;
  try {
    res = await fetch('/__teacher/messages', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text, context})});
  } catch {
    throw new Error('Couldn’t reach your teacher: the teacher needs the dev server on your Mac.');
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(res.status === 404 ? 'The teacher needs the dev server on your Mac.' : `Couldn’t send: ${msg}`);
  }
  try { await store.updateTake(take.id, {sentAt: Date.now()}); } catch {}
  return res.json().catch(() => ({}));
}
