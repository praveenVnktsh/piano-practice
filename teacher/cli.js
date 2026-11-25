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
//   node teacher/cli.js assign "<task>" [--action '<json>'] [--due YYYY-MM-DD]   homework shown on Today
//   node teacher/cli.js assignments [--all]    open assignments (with --all: done ones too)
//   node teacher/cli.js done <id> [--undo]     mark an assignment done (or open again)
//   node teacher/cli.js letter "<markdown>"    a (weekly) review letter, shown on Progress
//   node teacher/cli.js letters                letters written so far, newest first
//   node teacher/cli.js progress [--days N]    mastery, trouble bars, reviews, plateaus, path, goals, journal
//   node teacher/cli.js recordings [<songId>]  recorded takes (and mock exams), newest first
//   node teacher/cli.js review <takeId>        a take compared with the score, bar by bar
//   node teacher/cli.js comment <songId> <fromBar> <toBar> "<text>"   pin a note to bars of a piece
//   node teacher/cli.js comments [<songId>] [--all]   bar comments (with --all: dismissed ones too)
//   node teacher/cli.js uncomment <id>         remove a bar comment
//   node teacher/cli.js exercise "<title>" <file.notes> [--about "<why>"] [--song <id> --bars 5-8]
//                                              compose an exercise; it appears in Exercises → From your teacher
//   node teacher/cli.js exercises              the exercises composed so far
//   node teacher/cli.js unexercise <id>        remove one
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {addExercise} from './compose.js';
import {readExercises, removeExercise} from './exercises.js';
import {fileURLToPath} from 'node:url';
import {ACTION_TYPES} from './actions.js';
import {RECORDINGS_DIR, listExams, listTakes, readTake} from '../recordings/store.js';
import {takeMeta} from '../src/record/take.mjs';
import {examText, reportText, takeLine} from '../src/record/text.mjs';
import {progressReport, readCatalog, readProgressDoc} from './report.js';
import {
  addAssignment,
  addComment,
  addLetter,
  addReply,
  openMessages,
  PROFILE_TEMPLATE,
  readMessages,
  readAssignments,
  readComments,
  readLetters,
  readProfile,
  readReplies,
  removeComment,
  setAssignmentDone,
  setThinking,
  TEACHER_DIR,
} from './store.js';

export const USAGE = `usage: node teacher/cli.js list [--open]
       node teacher/cli.js show <id>
       node teacher/cli.js thinking <id> [--off]
       node teacher/cli.js reply <id> "<markdown text>" [--actions '<json array>']
       node teacher/cli.js profile
       node teacher/cli.js actions
       node teacher/cli.js assign "<task>" [--action '<json>'] [--due YYYY-MM-DD]
       node teacher/cli.js assignments [--all]
       node teacher/cli.js done <id> [--undo]
       node teacher/cli.js letter "<markdown text>"
       node teacher/cli.js letters
       node teacher/cli.js progress [--days N]
       node teacher/cli.js recordings [<songId>]
       node teacher/cli.js review <takeId>
       node teacher/cli.js comment <songId> <fromBar> <toBar> "<text>"
       node teacher/cli.js comments [<songId>] [--all]
       node teacher/cli.js uncomment <id>
       node teacher/cli.js exercise "<title>" <file.notes> [--about "<why>"] [--song <id> --bars 5-8]
       node teacher/cli.js exercises
       node teacher/cli.js unexercise <id>`;

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
    for (const m of (g.mastery || []).slice(0, full ? 8 : 5)) {
      out.push(
        `      mastery ${m.title} [${m.id}]: ${m.status}${m.bestCleanTempo ? `, clean up to ${m.bestCleanTempo} BPM` : ''}${m.targetTempo ? ` (target ${m.targetTempo})` : ''}` +
          `${m.coverage != null ? `, ${m.coverage}% of ${m.measureCount} bars secure` : ''}${m.reviewDue ? `, review due ${m.reviewDue}` : ''}`,
      );
    }
    if (g.bars?.weakest?.length)
      out.push(
        `      weakest bars in ${g.bars.songId}: ${g.bars.weakest.map(b => `${b.label} ${b.accuracy}% (${b.attempts} passes)`).join(', ')}`,
      );
    if (g.dueReviews?.length) out.push(`      due for review: ${g.dueReviews.map(r => `${r.title} [${r.id}]`).join(', ')}`);
    for (const p of g.plateaus || [])
      out.push(
        `      PLATEAU ${p.title} [${p.songId}] section [${p.section}]: ${p.days} days, best ${pct(p.firstBest)} → ${pct(p.lastBest)}`,
      );
    if (g.path)
      out.push(
        `      path: ${g.path.level} ${g.path.done}% · technique left ${(g.path.techniqueLeft || []).join(', ') || 'none'} · reading left ${(g.path.readingLeft || []).join(', ') || 'none'}${g.path.lessonsLeft?.length ? ` · first lessons left ${g.path.lessonsLeft.join(', ')}` : ''}`,
      );
    for (const goal of g.goals || [])
      out.push(
        `      goal ${goal.title || goal.songId} ${goal.bpm} BPM by ${goal.by}: ${goal.met ? 'met' : `best ${goal.bestTempo ?? '–'} BPM, ${goal.daysLeft} days left`}`,
      );
    for (const j of (g.journal || []).slice(full ? 0 : -3))
      out.push(`      journal ${j.at ? j.at.slice(0, 10) : ''}${j.title ? ` ${j.title}` : ''}${j.mood ? ` (${j.mood})` : ''}: ${j.text || ''}`);
  }
  for (const a of context.assignments || [])
    out.push(`  assignment #${a.id}: ${a.task}${a.due ? ` (due ${a.due})` : ''}`);
  const ask = context.ask;
  if (ask && ask.songId) out.push(...askLines(ask, {full}));
  const rec = context.recording;
  if (rec && rec.takeId) {
    out.push(
      `  RECORDING take ${rec.takeId}: ${rec.title || rec.songId} [${rec.songId}]${rec.name ? ` “${rec.name}”` : ''} · ` +
        `${rec.accuracy != null ? `${pct(rec.accuracy)} of notes (${rec.missed} missed, ${rec.wrong} wrong, ${rec.extra} extra)` : 'not compared yet'}` +
        `${rec.meanBpm ? ` · ♩ ≈ ${rec.meanBpm} (recorded at ${rec.tempo ?? '?'})` : ''}${rec.timingSdMs != null ? ` · timing ±${rec.timingSdMs} ms` : ''}` +
        `${rec.evenness != null ? ` · evenness ${rec.evenness}` : ''} — run: node teacher/cli.js review ${rec.takeId}`,
    );
    if (rec.weakBars?.length) out.push(`      weak bars: ${rec.weakBars.map(b => `${b.label} ${b.accuracy}%`).join(', ')}`);
    for (const r of rec.remarks || []) out.push(`      remark: ${r}`);
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

/** The "Ask about these bars" attachment: the piece, the bars and the last pass over them. */
export function askLines(ask, {full = false} = {}) {
  const sec = Array.isArray(ask.section) ? ask.section : null;
  const out = [
    `  ASKING ABOUT ${ask.bars || (sec ? `bars ${sec[0] + 1}–${sec[1] + 1}` : 'a passage')} of ${ask.title || ask.songId} [${ask.songId}]` +
      `${sec ? ` · section [${sec[0]}, ${sec[1]}]` : ''}${ask.tempo ? ` · ♩ = ${ask.tempo}` : ''}${ask.hands ? ` · ${ask.hands} hands` : ''}`,
  ];
  const r = ask.lastResult;
  if (r && typeof r === 'object') {
    const when = r.at ? new Date(r.at).toLocaleString() : '';
    const timing = r.timing ? ` · timing early ${r.timing.early} / late ${r.timing.late} / on time ${r.timing.onTime}` : '';
    out.push(
      `      last pass here: bars ${(r.section || []).map(n => n + 1).join('–')} · ${r.hands ?? '?'} · ${r.mode ?? '?'} · ${r.tempo ?? '?'} BPM · ` +
        `${pct(r.accuracy)} (${r.right ?? '?'} right, ${r.wrong ?? '?'} wrong)${timing} · ${when}`,
    );
    for (const m of (r.misses || []).slice(0, full ? 50 : 12))
      out.push(`      miss bar ${m.measure}: expected ${(m.expected || []).join(' ')}; played ${(m.played || []).join(' ') || '—'}`);
    for (const line of r.remarks || []) out.push(`      remark: ${line}`);
  } else out.push('      no practice pass over these bars yet');
  for (const c of ask.comments || []) out.push(`      your comment #${c.id} on bars ${c.first + 1}–${c.last + 1}: ${c.text}`);
  return out;
}

/** One bar comment as a line: "#3 fur-elise bars 5–8 · read · 2026-11-25: lift the wrist here". */
export function formatComment(c) {
  const state = c.dismissedAt ? 'dismissed' : c.readAt ? 'read' : 'unread';
  const bars = c.first === c.last ? `bar ${c.first + 1}` : `bars ${c.first + 1}–${c.last + 1}`;
  return `#${c.id} ${c.songId} ${bars} · ${state} · ${String(c.at).slice(0, 10)}: ${c.text}`;
}

const barNumber = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a bar number (1 = the first bar of the score)`);
  return n;
};

/** Removes `--name value` from args → value (undefined when absent). */
function option(args, name) {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
  args.splice(at, 2);
  return value;
}

function parseJson(raw, name) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${name} is not valid JSON: ${e.message}`, {cause: e});
  }
}

export function formatAssignment(a, today = new Date().toISOString().slice(0, 10)) {
  const due = a.due ? ` · due ${a.due}${!a.done && a.due < today ? ' (overdue)' : ''}` : '';
  const act = a.action ? ` · action ${JSON.stringify(a.action)}` : '';
  return `#${a.id} ${a.done ? '[done]' : '[ ]'} ${a.task}${due}${act}${a.done && a.doneAt ? ` · done ${a.doneAt.slice(0, 10)}` : ''}`;
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

export function main(argv, dir = TEACHER_DIR, out = console.log, err = console.error, opts = {}) {
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
    if (command === 'assign' && args.length >= 1) {
      const rawAction = option(args, '--action');
      const due = option(args, '--due');
      const action = rawAction === undefined ? undefined : parseJson(rawAction, '--action');
      if (action?.type === 'plan') throw new Error('an assignment action is one step (not a plan); make several assignments instead');
      const a = addAssignment(dir, {task: args.join(' '), action, due});
      out(`Assigned #${a.id}: ${a.task}${a.due ? ` (due ${a.due})` : ''}.`);
      return 0;
    }
    if (command === 'assignments') {
      const all = args.includes('--all');
      const list = readAssignments(dir).filter(a => all || !a.done);
      out(list.length ? list.map(a => formatAssignment(a)).join('\n') : all ? 'No assignments yet.' : 'No open assignments.');
      return 0;
    }
    if (command === 'done' && args.length >= 1) {
      const a = setAssignmentDone(dir, args[0], !args.includes('--undo'));
      out(`${a.done ? 'Done' : 'Open again'}: #${a.id} ${a.task}`);
      return 0;
    }
    if (command === 'letter' && args.length >= 1) {
      const letter = addLetter(dir, args.join(' '));
      out(`Letter ${letter.id} written; it appears on the Progress page.`);
      return 0;
    }
    if (command === 'letters') {
      const list = readLetters(dir).slice().reverse();
      out(list.length ? list.map(l => `#${l.id} · ${l.at.slice(0, 10)} · ${l.readAt ? 'read' : 'unread'}\n  ${l.text.split('\n')[0].slice(0, 120)}`).join('\n') : 'No letters yet.');
      return 0;
    }
    if (command === 'recordings') {
      const dir2 = opts.recordingsDir ?? RECORDINGS_DIR;
      const songId = args[0];
      const takes = listTakes(dir2, songId).map(takeMeta);
      const exams = songId ? [] : listExams(dir2);
      if (!takes.length && !exams.length) out(songId ? `No recordings of ${songId}.` : 'No recordings yet.');
      else out([...takes.map(takeLine), ...(exams.length ? ['', 'Mock exams:', ...exams.map(examText)] : [])].join('\n'));
      return 0;
    }
    if (command === 'review' && args.length === 1) {
      const take = readTake(opts.recordingsDir ?? RECORDINGS_DIR, args[0]);
      if (!take) throw new Error(`no take ${args[0]} (see node teacher/cli.js recordings)`);
      out(reportText(take));
      return 0;
    }
    if (command === 'progress') {
      const days = Number(option(args, '--days') ?? 7);
      out(
        progressReport(opts.progress ?? readProgressDoc(), opts.catalog ?? readCatalog(), {
          days: days > 0 && days <= 90 ? days : 7,
          comments: readComments(dir),
        }),
      );
      return 0;
    }
    if (command === 'comment' && args.length >= 4) {
      const [songId, from, to, ...text] = args;
      const first = barNumber(from, 'fromBar') - 1,
        last = barNumber(to, 'toBar') - 1;
      const catalog = opts.catalog ?? readCatalog();
      const c = addComment(dir, {songId, first, last, text: text.join(' ')});
      out(`Comment #${c.id} pinned to ${c.first === c.last ? `bar ${c.first + 1}` : `bars ${c.first + 1}–${c.last + 1}`} of ${songId}; it shows on the score.`);
      if (!/^(import|ex|sr|tex|mutopia):/.test(songId) && !catalog.some(e => e.id === songId))
        err(`(note: ${songId} isn't in the bundled or local catalog — check the id; it is kept anyway)`);
      return 0;
    }
    if (command === 'comments') {
      const all = args.includes('--all');
      const songId = args.find(a => !a.startsWith('--'));
      const list = readComments(dir).filter(c => (!songId || c.songId === songId) && (all || !c.dismissedAt));
      out(list.length ? list.map(formatComment).join('\n') : songId ? `No bar comments on ${songId}.` : 'No bar comments yet.');
      return 0;
    }
    if (command === 'exercise' && args.length >= 2) {
      const about = option(args, '--about');
      const songId = option(args, '--song');
      const barsArg = option(args, '--bars');
      let first, last;
      if (barsArg !== undefined) {
        const m = /^(\d+)(?:[-–](\d+))?$/.exec(barsArg);
        if (!m) throw new Error('--bars must be like 5-8 (bar numbers from 1)');
        first = barNumber(m[1], '--bars') - 1;
        last = barNumber(m[2] ?? m[1], '--bars') - 1;
      }
      const [title, file] = args;
      let notes;
      try {
        notes = readFileSync(file, 'utf8');
      } catch {
        throw new Error(`can't read ${file} (write the notes to a file first; format: songs/README.md)`);
      }
      const ex = addExercise(dir, {title, notes, about, songId, first, last});
      out(`Exercise tex:${ex.id} “${ex.title}” is in Exercises → From your teacher. Button: {"type":"open_song","id":"tex:${ex.id}"}`);
      return 0;
    }
    if (command === 'exercises') {
      const list = readExercises(dir);
      out(list.length ? list.map(e => `tex:${e.id} · ${e.at.slice(0, 10)} · ${e.title}${e.songId ? ` · for ${e.songId}${e.first != null ? ` bars ${e.first + 1}–${e.last + 1}` : ''}` : ''}${e.about ? ` — ${e.about}` : ''}`).join('\n') : 'No exercises yet.');
      return 0;
    }
    if (command === 'unexercise' && args.length === 1) {
      const ex = removeExercise(dir, String(args[0]).replace(/^tex:/, ''));
      out(`Removed exercise tex:${ex.id}.`);
      return 0;
    }
    if (command === 'uncomment' && args.length === 1) {
      const c = removeComment(dir, args[0]);
      out(`Removed comment #${c.id} (${c.songId}).`);
      return 0;
    }
  } catch (e) {
    err(e.message);
    if ((command === 'reply' || command === 'assign') && /action/.test(e.message)) err('\n' + ACTIONS_HELP);
    return 1;
  }
  err(USAGE);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
