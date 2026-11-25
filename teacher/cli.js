// CLI for whoever answers the student (a Claude Code subagent in the developer's session).
// Messages typed in the app's Teacher panel land in .teacher/messages.jsonl; replies written
// here appear in the app at once (the dev server watches .teacher/).
//
//   node teacher/cli.js list [--open]          messages (with --open: unanswered ones, with their context)
//   node teacher/cli.js show <id>              one message, its full context and the replies to it
//   node teacher/cli.js thinking <id> [--off]  show (or clear) "Teacher is thinking…" in the app
//   node teacher/cli.js reply <id> "<markdown>" [--actions '<json array>']
//   node teacher/cli.js profile                print .teacher/student.md (edit that file directly)
//   node teacher/cli.js actions                describe the action types a reply can carry
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ACTION_TYPES} from './actions.js';
import {
  addReply,
  openMessages,
  PROFILE_TEMPLATE,
  readMessages,
  readProfile,
  readReplies,
  setThinking,
  TEACHER_DIR,
} from './store.js';

export const USAGE = `usage: node teacher/cli.js list [--open]
       node teacher/cli.js show <id>
       node teacher/cli.js thinking <id> [--off]
       node teacher/cli.js reply <id> "<markdown text>" [--actions '<json array>']
       node teacher/cli.js profile
       node teacher/cli.js actions`;

export const ACTIONS_HELP = `Actions are buttons the student taps to apply (never run automatically). Types:
  {"type":"open_song","id":"fur-elise"}                 a library id (see context.player.songId / progress.recentSongs)
  {"type":"set_section","first":0,"last":7}             0-based measure indices, like context.player.section
  {"type":"set_tempo","bpm":60}                          20–300
  {"type":"set_hands","hands":"right"}                  both | right | left
  {"type":"set_mode","mode":"wait"}                     wait | timed
  {"type":"set_loop","on":true}
  {"type":"open_exercise","id":"ex:scale:C:major:both:2:up-down"}
      ids: ex:scale:<key>:<major|minor>:<hands>:<octaves>:<up-down>, ex:arpeggio:Fs:minor:right:2,
           ex:five-finger:G:major:both, ex:progression:Bb:major:I-IV-V-I  (s = sharp, b = flat)
  {"type":"open_note_reading","level":"treble"}         level optional: landmarks, treble, bass, grand, …
  {"type":"plan","items":[{"label":"Warm up: C major scale","minutes":5,"action":{…}}, …]}  a checklist
Any action may add "label" (≤ 80 chars) for its button text. Allowed: ${ACTION_TYPES.join(', ')}.`;

const pct = v => (typeof v === 'number' ? `${Math.round(v)}%` : '?');

function bars(section, label) {
  if (label && Array.isArray(section)) return `${label} (section [${section[0]}, ${section[1]}])`;
  if (label) return label;
  if (Array.isArray(section))
    return `section [${section[0]}, ${section[1]}] (bars ${section[0] + 1}–${section[1] + 1})`;
  return '';
}

/** Readable summary of the context the app attached to a message. */
export function formatContext(context, {full = false} = {}) {
  if (!context) return '  (no context)';
  const out = [];
  if (context.route) out.push(`  route: ${context.route}`);
  const p = context.player;
  if (p && p.songId) {
    out.push(
      `  player: ${p.title || p.songId}${p.composer ? ` (${p.composer})` : ''} [${p.songId}] · ${bars(p.section, p.sectionLabel)}` +
        ` of ${p.measureCount ?? '?'} · ${p.tempo ?? '?'} BPM${p.targetTempo ? ` (target ${p.targetTempo})` : ''} · ${p.hands} hands · ${p.mode} mode` +
        `${p.loop ? ' · loop' : ''}${p.practicing ? ' · practising' : p.playing ? ' · playing' : ''}`,
    );
  } else out.push('  player: no song open');
  for (const r of (context.recentResults || []).slice(0, full ? 10 : 3)) {
    const when = r.at ? new Date(r.at).toLocaleString() : '';
    const timing = r.timing
      ? ` · timing early ${r.timing.early} / late ${r.timing.late} / on time ${r.timing.onTime}`
      : '';
    out.push(
      `  result: ${r.title || r.songId} · bars ${(r.section || []).map(n => n + 1).join('–')} · ${r.hands} · ${r.mode} · ${r.tempo} BPM · ` +
        `${pct(r.accuracy)} (${r.right} right, ${r.wrong} wrong)${timing} · ${when}`,
    );
    const misses = r.misses || [];
    for (const m of misses.slice(0, full ? 50 : 8)) {
      out.push(
        `      miss bar ${m.measure}: expected ${(m.expected || []).join(' ')}; played ${(m.played || []).join(' ') || '—'}`,
      );
    }
    if (!full && misses.length > 8) out.push(`      … ${misses.length - 8} more misses (show the message for all)`);
  }
  if (context.trainer) {
    const t = context.trainer;
    out.push(`  note reading: level ${t.level} · ${pct(t.accuracy)} · avg ${Math.round(t.avgMs || 0)} ms`);
  }
  const g = context.progress;
  if (g) {
    out.push(
      `  progress: today ${Math.round(g.todayMinutes || 0)}/${g.dailyGoalMin ?? '?'} min · streak ${g.streak?.current ?? 0} days` +
        ` (longest ${g.streak?.longest ?? 0}) · ${Math.round(g.totalMinutes || 0)} min total`,
    );
    for (const s of (g.recentSongs || []).slice(0, full ? 10 : 5)) {
      out.push(
        `      song ${s.title} [${s.id}]: ${s.attempts} attempts, best ${pct(s.best)}, latest ${pct(s.latest)}${s.bestTempo ? `, best tempo ${s.bestTempo}` : ''}`,
      );
    }
    for (const s of (g.recentExercises || []).slice(0, full ? 10 : 5)) {
      out.push(`      exercise [${s.id}]: ${s.attempts} attempts, best ${pct(s.best)}`);
    }
    if (g.reading?.drills)
      out.push(
        `      note reading: ${g.reading.drills} drills, ${pct(g.reading.accuracy)}, avg ${Math.round(g.reading.avgMs || 0)} ms`,
      );
  }
  if (full)
    out.push(
      '  raw context:',
      ...JSON.stringify(context, null, 2)
        .split('\n')
        .map(l => '    ' + l),
    );
  return out.join('\n');
}

function formatMessage(m, replies, {context = false, full = false} = {}) {
  const head = `#${m.id} · ${new Date(m.at).toLocaleString()}${replies.length ? ` · ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}` : ' · OPEN'}`;
  const lines = [head, ...m.text.split('\n').map(l => `  > ${l}`)];
  if (context) lines.push(formatContext(m.context, {full}));
  for (const r of replies) {
    lines.push(
      `  <- reply ${r.id}: ${r.text.split('\n')[0].slice(0, full ? 10000 : 100)}${r.actions ? ` [${r.actions.length} action(s)]` : ''}`,
    );
  }
  return lines.join('\n');
}

export function main(argv, dir = TEACHER_DIR, out = console.log, err = console.error) {
  const [command, ...args] = argv;
  const repliesTo = id => readReplies(dir).filter(r => r.replyTo === id);
  try {
    if (command === 'list') {
      const open = args.includes('--open');
      const messages = open ? openMessages(dir) : readMessages(dir);
      if (messages.length) out(messages.map(m => formatMessage(m, repliesTo(m.id), {context: open})).join('\n\n'));
      else out(open ? 'No unanswered messages.' : 'No messages yet.');
      return 0;
    }
    if (command === 'show' && args.length === 1) {
      const m = readMessages(dir).find(x => x.id === Number(args[0]));
      if (!m) throw new Error(`no message ${args[0]}`);
      out(formatMessage(m, repliesTo(m.id), {context: true, full: true}));
      return 0;
    }
    if (command === 'thinking' && args.length >= 1) {
      setThinking(dir, args.includes('--off') ? null : args[0]);
      return 0;
    }
    if (command === 'reply' && args.length >= 2) {
      const at = args.indexOf('--actions');
      let actions;
      if (at !== -1) {
        const raw = args[at + 1];
        if (raw === undefined) throw new Error('--actions needs a JSON array');
        try {
          actions = JSON.parse(raw);
        } catch (e) {
          throw new Error(`--actions is not valid JSON: ${e.message}`, {cause: e});
        }
        args.splice(at, 2);
      }
      const [id, ...text] = args;
      const reply = addReply(dir, id, text.join(' '), actions);
      out(
        `Replied to #${reply.replyTo} (reply ${reply.id}${reply.actions ? `, ${reply.actions.length} action(s)` : ''}).`,
      );
      return 0;
    }
    if (command === 'profile') {
      const profile = readProfile(dir);
      out(profile ?? `(no ${dir}/student.md yet — create it; a starting template:)\n\n${PROFILE_TEMPLATE}`);
      return 0;
    }
    if (command === 'actions') {
      out(ACTIONS_HELP);
      return 0;
    }
  } catch (e) {
    err(e.message);
    if (command === 'reply' && /action/.test(e.message)) err('\n' + ACTIONS_HELP);
    return 1;
  }
  err(USAGE);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
