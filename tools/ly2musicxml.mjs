#!/usr/bin/env node
// Converts piano scores written in LilyPond (as published by the Mutopia
// Project) into MusicXML the app can play.
//
//   node tools/ly2musicxml.mjs input.ly [--title T] [--composer C] [--rights R]
//        [--source S] [--tempo BPM] > public/songs/x.musicxml
//
// Always check the result bar by bar (see songs/README.md): unsupported
// constructs are skipped with a warning, not reproduced.
//
// This is not a LilyPond implementation. It understands the subset that
// typical engraved piano pieces use, and ignores everything that only affects
// appearance:
//   absolute, \relative and \fixed pitch entry; chords <...>; rests, skips, R;
//   durations with dots and *n/m scaling; ties; \times / \tuplet;
//   \repeat volta|unfold|percent with \alternative (unfolded);
//   \partial; \key; \time; \clef; \tempo; \change Staff / \new Staff / \context;
//   simultaneous music << >> and voices << { } \\ { } >>; variables;
//   grace notes (dropped). Fingerings, dynamics, slurs, markups, \override,
//   \set, \tweak and Scheme expressions are skipped.

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const WHOLE = 1920; // ticks per whole note; quarter = 480 (the MusicXML divisions)
const DIVISIONS = WHOLE / 4;

// ───────────────────────── Tokenizer ─────────────────────────

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  const balanced = (open, close) => {
    let depth = 0, j = i;
    for (; j < n; j++) {
      const c = src[j];
      if (c === '"') { j++; while (j < n && src[j] !== '"') { if (src[j] === '\\') j++; j++; } continue; }
      if (c === ';' && open === '(') { while (j < n && src[j] !== '\n') j++; continue; }
      if (c === open) depth++;
      else if (c === close && --depth === 0) return j + 1;
    }
    return n;
  };
  const readString = () => {
    let j = i + 1;
    while (j < n && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
    return j + 1;
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') {
      if (src[i + 1] === '{') { const e = src.indexOf('%}', i + 2); i = e < 0 ? n : e + 2; }
      else { while (i < n && src[i] !== '\n') i++; }
      continue;
    }
    if (c === '"') { const e = readString(); tokens.push({t: 'str', v: src.slice(i + 1, e - 1)}); i = e; continue; }
    if (c === '#') {
      // Scheme expression: ##t, #'sym, #'(...), #(...), #"str", #-5, #sym
      let j = i + 1;
      if (src[j] === '#') j += 2;
      else {
        if (src[j] === "'" || src[j] === '`') j++;
        if (src[j] === '(') { i = j; j = balanced('(', ')'); }
        else if (src[j] === '"') { i = j; j = readString(); }
        else while (j < n && !/[\s{}<>()[\]|~"]/.test(src[j])) j++;
      }
      tokens.push({t: 'scheme'}); i = j; continue;
    }
    if (src.startsWith('\\markup', i) || src.startsWith('\\markuplist', i)) {
      i += src.startsWith('\\markuplist', i) ? 11 : 7;
      // markup arguments: commands then one braced block or a word/string
      for (;;) {
        while (/\s/.test(src[i])) i++;
        if (src[i] === '{') { i = balanced('{', '}'); break; }
        if (src[i] === '"') { i = readString(); break; }
        if (src[i] === '\\') { i++; while (/[A-Za-z-]/.test(src[i])) i++; continue; }
        if (src[i] === '#') { tokens.push(...tokenize(src.slice(i, i + 1)).slice(0, 0)); // skip scheme arg
          let j = i + 1; if (src[j] === "'") j++; if (src[j] === '(') { i = j; i = balanced('(', ')'); } else { while (!/\s/.test(src[j])) j++; i = j; } continue; }
        while (i < n && !/[\s{}]/.test(src[i])) i++;
        break;
      }
      tokens.push({t: 'markup'}); continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<<' || two === '>>' || two === '\\\\' || two === '\\(' || two === '\\)' || two === '\\[' || two === '\\]' || two === '\\<' || two === '\\>' || two === '\\!') {
      tokens.push({t: two === '<<' || two === '>>' || two === '\\\\' ? two : 'ignore'}); i += 2; continue;
    }
    if (c === '\\') {
      let j = i + 1;
      while (j < n && /[A-Za-z-]/.test(src[j])) j++;
      if (src[j - 1] === '-') j--;
      tokens.push({t: 'cmd', v: src.slice(i + 1, j)}); i = j; continue;
    }
    if ('{}<>=|~'.includes(c)) { tokens.push({t: c}); i++; continue; }
    if ('[]()'.includes(c)) { i++; continue; } // beams and slurs
    if ((c === '-' || c === '_' || c === '^') && i + 1 < n) {
      // articulation / fingering / attached text: -5  -.  ->  ^\pp  _"text"  -\tweak ...
      const d = src[i + 1];
      if (/\d/.test(d)) { let j = i + 1; while (/\d/.test(src[j])) j++; i = j; continue; }
      if ('.->^+!_|'.includes(d)) { i += 2; continue; }
      if (d === '"' || d === '\\' || d === '#') { i++; tokens.push({t: 'post'}); continue; } // string/command belongs to the note
      i++; continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j < n && (/[A-Za-z]/.test(src[j]) || ((src[j] === '.' || src[j] === '-') && /[A-Za-z]/.test(src[j + 1] ?? '')))) j++;
      while (j < n && (src[j] === "'" || src[j] === ',')) j++;
      if (src[j] === '!' || src[j] === '?') j++;
      if (src[j] === '=') { // octave check, e.g. c='
        let k = j + 1; while (src[k] === "'" || src[k] === ',') k++;
        if (k > j + 1 || /[\s\d]/.test(src[k])) j = k;
      }
      const word = src.slice(i, j);
      let dur = '';
      if (/\d/.test(src[j])) {
        let k = j; while (/\d/.test(src[k])) k++; while (src[k] === '.') k++;
        while (src[k] === '*' && /\d/.test(src[k + 1])) { k++; while (/[\d/]/.test(src[k])) k++; }
        dur = src.slice(j, k); j = k;
      }
      tokens.push({t: 'word', v: word, dur}); i = j; continue;
    }
    if (/\d/.test(c)) {
      let j = i; while (/[\d./*]/.test(src[j])) j++;
      tokens.push({t: 'num', v: src.slice(i, j)}); i = j; continue;
    }
    if (c === "'" || c === ',' || c === '.' || c === '!' || c === '?' || c === ':' || c === '+' || c === '*' || c === '/') { i++; continue; }
    i++;
  }
  return tokens;
}

// ───────────────────────── Pitches and durations ─────────────────────────

const STEPS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const SEMI = [0, 2, 4, 5, 7, 9, 11];

function parsePitchName(word) {
  const m = word.match(/^([a-g])((?:isis|eses|ises|is|es|ses|s)?)([',]*)[!?]?(?:=([',]*))?$/);
  if (!m) return null;
  let alter = {isis: 2, is: 1, eses: -2, ses: -2, es: -1, s: -1, ises: 0, '': 0}[m[2]];
  if (m[2] === 's' && !['a', 'e'].includes(m[1])) return null;
  const marks = [...m[3]].reduce((a, ch) => a + (ch === "'" ? 1 : -1), 0);
  return {step: STEPS.indexOf(m[1]), alter, marks};
}

function parseDuration(text) {
  const m = text.match(/^(\d+)(\.*)((?:\*\d+(?:\/\d+)?)*)$/);
  if (!m) throw Error(`bad duration "${text}"`);
  const base = +m[1];
  if (![1, 2, 4, 8, 16, 32, 64, 128].includes(base)) throw Error(`unsupported duration ${base}`);
  let d = WHOLE / base, add = d;
  for (let k = 0; k < m[2].length; k++) { add /= 2; d += add; }
  for (const f of m[3].split('*').filter(Boolean)) { const [a, b = 1] = f.split('/').map(Number); d = d * a / b; }
  return d;
}

const MAJOR = {c: 0, g: 1, d: 2, a: 3, e: 4, b: 5, fis: 6, cis: 7, f: -1, bes: -2, es: -3, ees: -3, as: -4, aes: -4, des: -5, ges: -6, ces: -7};
const MINOR = {a: 0, e: 1, b: 2, fis: 3, cis: 4, gis: 5, dis: 6, ais: 7, d: -1, g: -2, c: -3, f: -4, bes: -5, es: -6, ees: -6, as: -7, aes: -7};

// ───────────────────────── Parser / interpreter ─────────────────────────

export function lilypondToEvents(src) {
  const tokens = tokenize(src);
  const vars = new Map();
  const score = {events: [], time: null, key: 0, pickup: 0, tempo: null, clefs: {}, clefChanges: [], staffNames: [], title: null, composer: null, warnings: []};

  // Header fields.
  const header = src.match(/\\header\s*\{([\s\S]*?)\n\s*\}/);
  if (header) {
    const field = k => header[1].match(new RegExp(`(?:^|\\n)\\s*${k}\\s*=\\s*"([^"]*)"`))?.[1];
    score.title = field('title'); score.composer = field('composer');
  }

  // Skip a balanced { } block starting at index i (tokens[i] is '{').
  const skipBlock = i => { let d = 0; for (; i < tokens.length; i++) { if (tokens[i].t === '{') d++; else if (tokens[i].t === '}' && --d === 0) return i + 1; } return i; };
  const skipSimul = i => { let d = 0; for (; i < tokens.length; i++) { if (tokens[i].t === '<<') d++; else if (tokens[i].t === '>>' && --d === 0) return i + 1; } return i; };

  // Top level: collect variable definitions and find the score.
  let scoreStart = -1;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'cmd' && ['header', 'paper', 'layout', 'midi'].includes(tk.v) && tokens[i + 1]?.t === '{') { i = skipBlock(i + 1) - 1; continue; }
    if (tk.t === 'cmd' && tk.v === 'score') { scoreStart = i + 1; break; }
    if (tk.t === 'word' && tokens[i + 1]?.t === '=') {
      const start = i + 2;
      let end = start;
      // A definition is: optional prefix commands (\relative c', \fixed c) then { } or << >>
      while (end < tokens.length && !['{', '<<', 'scheme'].includes(tokens[end].t)) end++;
      if (tokens[end]?.t === '{') end = skipBlock(end);
      else if (tokens[end]?.t === '<<') end = skipSimul(end);
      else end = end + 1;
      vars.set(tk.v, [start, end]);
      i = end - 1;
    }
  }
  if (scoreStart < 0) {
    // \book { \score { ... } } or a bare music expression
    scoreStart = tokens.findIndex((t, i) => t.t === 'cmd' && t.v === 'score');
    if (scoreStart < 0) throw Error('no \\score block found');
    scoreStart++;
  }

  let voiceSeq = 0;
  const staffIndex = name => {
    if (!score.staffNames.includes(name)) score.staffNames.push(name);
    return score.staffNames.indexOf(name) + 1;
  };

  // Interpret music starting at token i with context ctx. Returns {i, t}.
  function music(i, ctx) {
    const tk = tokens[i];
    if (!tk) return {i, t: ctx.t};
    if (tk.t === '{') {
      i++;
      while (i < tokens.length && tokens[i].t !== '}') ({i} = music(i, ctx));
      return {i: i + 1, t: ctx.t};
    }
    if (tk.t === '<<') {
      i++;
      const start = ctx.t;
      let end = start;
      const branches = [];
      let cur = [];
      // Parse each element in parallel. `\\` separates voices.
      let hasVoices = false;
      while (i < tokens.length && tokens[i].t !== '>>') {
        if (tokens[i].t === '\\\\') { hasVoices = true; branches.push(cur); cur = []; i++; continue; }
        cur.push(i);
        i = skipMusic(i);
      }
      branches.push(cur);
      branches.forEach((elems, bi) => {
        for (const ei of elems) {
          const sub = {...ctx, t: start, voice: hasVoices ? `${ctx.voice}.${bi}` : (elems.length > 1 || branches.length > 1 ? `${ctx.voice}.${bi}.${ei}` : ctx.voice)};
          music(ei, sub);
          end = Math.max(end, sub.t);
          // Relative reference continues from the last parsed branch (LilyPond semantics).
          ctx.ref = sub.ref;
          ctx.dur = sub.dur;
        }
      });
      ctx.t = end;
      return {i: i + 1, t: end};
    }
    if (tk.t === 'cmd') return command(i, ctx);
    if (tk.t === 'word') return note(i, ctx);
    if (tk.t === '<') return chord(i, ctx);
    if (tk.t === 'num') { score.warnings.push(`ignored number ${tk.v}`); return {i: i + 1, t: ctx.t}; }
    return {i: i + 1, t: ctx.t}; // ~ | = post markup str scheme ignore
  }

  // Find the end of one music expression without interpreting it.
  function skipMusic(i) {
    const tk = tokens[i];
    if (tk.t === '{') return skipBlock(i);
    if (tk.t === '<<') return skipSimul(i);
    if (tk.t === '<') { while (tokens[i] && tokens[i].t !== '>') i++; i++; if (tokens[i]?.t === 'num') i++; return postfix(i); }
    if (tk.t === 'word') return postfix(i + 1);
    if (tk.t === 'cmd') {
      const v = tk.v;
      const withMusic = {relative: 1, fixed: 1, times: 1, tuplet: 1, grace: 0, appoggiatura: 0, acciaccatura: 0, slashedGrace: 0, new: 1, context: 1, repeat: 1, transpose: 2};
      if (v in withMusic) {
        i++;
        if (v === 'relative' || v === 'fixed') { if (tokens[i]?.t === 'word' && tokens[i].v !== '{') i++; }
        else if (v === 'times' || v === 'tuplet') { i++; if (tokens[i]?.t === 'num') i++; }
        else if (v === 'new' || v === 'context') { i++; if (tokens[i]?.t === '=') i += 2; if (tokens[i]?.t === 'cmd' && tokens[i].v === 'with') i = skipBlock(i + 1); }
        else if (v === 'repeat') { i += 2; }
        i = skipMusic(i);
        if (v === 'repeat' && tokens[i]?.t === 'cmd' && tokens[i].v === 'alternative') i = skipMusic(i + 1);
        return i;
      }
      if (vars.has(v)) return i + 1;
      return command(i, {t: -1, dur: WHOLE / 4, scale: 1, mode: 'absolute', ref: {step: 3, oct: 3}, voice: '_', staff: 0, discard: true}).i;
    }
    return i + 1;
  }

  // Tokens that belong to the previous note (ties, articulations, attached text).
  function postfix(i) {
    for (;;) {
      const tk = tokens[i];
      if (!tk) return i;
      if (tk.t === '~' || tk.t === 'ignore') { i++; continue; }
      if (tk.t === 'post') {
        i++;
        if (tokens[i]?.t === 'cmd' && tokens[i].v === 'tweak') { i += 3; continue; }
        if (tokens[i]) i++;
        continue;
      }
      if (tk.t === 'cmd' && isPostCommand(tk.v)) { i++; continue; }
      if (tk.t === 'markup' || tk.t === 'str') { i++; continue; }
      return i;
    }
  }
  const DYN = new Set(['ppppp', 'pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'fp', 'sf', 'sff', 'sfz', 'sfp', 'rfz', 'fz', 'cresc', 'decresc', 'dim', 'fermata', 'staccato', 'accent', 'tenuto', 'marcato', 'trill', 'prall', 'mordent', 'turn', 'arpeggio', 'sustainOn', 'sustainOff', 'sostenutoOn', 'sostenutoOff', 'laissezVibrer', 'startTrillSpan', 'stopTrillSpan', 'upbow', 'downbow', 'staccatissimo', 'portato', 'espressivo', 'flageolet', 'open', 'stopped', 'snappizzicato', 'thumb', 'segno', 'coda', 'shortfermata', 'longfermata', 'glissando', 'startTextSpan', 'stopTextSpan', 'breathe', 'sp', 'spp', 'n']);
  const isPostCommand = v => DYN.has(v) || /^(sustain|una|tre)/.test(v);

  // Number of tokens consumed by an ignorable command's arguments.
  function argCount(i) {
    const v = tokens[i].v;
    let j = i + 1;
    const take = () => j++;
    switch (v) {
      case 'override': case 'set': case 'unset': case 'revert': {
        if (tokens[j]?.t === 'cmd' && tokens[j].v === 'once') j++;
        while (tokens[j] && tokens[j].t !== '=' && (tokens[j].t === 'word' || tokens[j].t === 'scheme') && !(v === 'revert' && tokens[j - 1].t === 'scheme')) {
          take();
          if (v === 'revert' && tokens[j - 1].t === 'scheme') break;
          if (v === 'unset') break;
        }
        if (tokens[j]?.t === '=') { take(); take(); }
        return j - i - 1;
      }
      case 'tweak': return 2;
      case 'bar': case 'mark': case 'ottava': case 'tupletSpan': case 'barNumberCheck': case 'label': case 'footnote': return 1;
      case 'once': case 'temporary': return 0;
      default: return 0;
    }
  }

  function command(i, ctx) {
    const v = tokens[i].v;
    i++;
    switch (v) {
      case 'relative': {
        let ref = {step: 3, oct: 3}; // f (LilyPond default)
        if (tokens[i]?.t === 'word') {
          const p = parsePitchName(tokens[i].v);
          if (p) { ref = {step: p.step, oct: 3 + p.marks}; i++; }
        }
        const sub = {...ctx, ref, mode: 'relative'};
        const r = music(i, sub);
        ctx.t = sub.t; ctx.dur = sub.dur;
        return {i: r.i, t: ctx.t};
      }
      case 'fixed': {
        const p = parsePitchName(tokens[i].v); i++;
        const sub = {...ctx, mode: 'fixed', fixedOct: 3 + p.marks};
        const r = music(i, sub); ctx.t = sub.t; ctx.dur = sub.dur;
        return {i: r.i, t: ctx.t};
      }
      case 'absolute': {
        const sub = {...ctx, mode: 'absolute'};
        const r = music(i, sub); ctx.t = sub.t; ctx.dur = sub.dur;
        return {i: r.i, t: ctx.t};
      }
      case 'times': case 'tuplet': {
        const [a, b] = tokens[i].v.split('/').map(Number); i++;
        if (tokens[i]?.t === 'num') i++; // optional span duration
        const scale = v === 'times' ? a / b : b / a;
        const sub = {...ctx, scale: ctx.scale * scale};
        const r = music(i, sub); ctx.t = sub.t; ctx.ref = sub.ref; ctx.dur = sub.dur;
        return {i: r.i, t: ctx.t};
      }
      case 'grace': case 'appoggiatura': case 'acciaccatura': case 'slashedGrace': case 'afterGrace': {
        const sub = {...ctx, discard: true};
        const r = music(i, sub); ctx.ref = sub.ref;
        return {i: r.i, t: ctx.t};
      }
      case 'repeat': {
        const kind = tokens[i].v; i++;
        const times = +tokens[i].v; i++;
        const bodyStart = i;
        let after = skipMusic(i);
        const alts = [];
        if (tokens[after]?.t === 'cmd' && tokens[after].v === 'alternative') {
          let j = after + 1;
          if (tokens[j]?.t === '{') { j++; while (tokens[j] && tokens[j].t !== '}') { alts.push(j); j = skipMusic(j); } after = j + 1; }
        }
        const count = kind === 'tremolo' ? 1 : times;
        for (let k = 0; k < count; k++) {
          music(bodyStart, ctx);
          if (alts.length) music(alts[Math.max(0, k - (count - alts.length))], ctx);
        }
        return {i: after, t: ctx.t};
      }
      case 'alternative': return {i: skipMusic(i), t: ctx.t}; // handled by \repeat
      case 'new': case 'context': {
        const type = tokens[i].v; i++;
        let name = null;
        if (tokens[i]?.t === '=') { name = tokens[i + 1].v; i += 2; }
        if (tokens[i]?.t === 'cmd' && tokens[i].v === 'with') i = skipBlock(i + 1);
        const sub = {...ctx};
        if (/^(Dynamics|Lyrics|ChordNames|FiguredBass|FretBoards|NullVoice)$/.test(type)) sub.discard = true;
        if (type === 'Staff' || type === 'RhythmicStaff') sub.staff = staffIndex(name ?? `staff${score.staffNames.length + 1}`);
        if (type === 'Voice') sub.voice = `${ctx.voice}/${name ?? ++voiceSeq}`;
        if (type === 'Staff') sub.voice = `${ctx.voice}/S${sub.staff}`;
        const r = music(i, sub);
        ctx.t = Math.max(ctx.t, sub.t);
        return {i: r.i, t: ctx.t};
      }
      case 'change': {
        // \change Staff = "name"
        i++; if (tokens[i]?.t === '=') i++;
        if (!ctx.discard) ctx.staff = staffIndex(tokens[i].v); i++;
        return {i, t: ctx.t};
      }
      case 'key': {
        const tonic = tokens[i].v; i++;
        const mode = tokens[i]?.t === 'cmd' ? tokens[i].v : 'major'; i++;
        if (!ctx.discard && score.key === 0 && ctx.t === 0) score.key = (mode === 'minor' ? MINOR : MAJOR)[tonic] ?? 0;
        return {i, t: ctx.t};
      }
      case 'time': {
        const [a, b] = tokens[i].v.split('/').map(Number); i++;
        if (!score.time && !ctx.discard) score.time = [a, b];
        return {i, t: ctx.t};
      }
      case 'partial': {
        const d = parseDuration(tokens[i].v); i++;
        if (ctx.t === 0) score.pickup = d;
        return {i, t: ctx.t};
      }
      case 'clef': {
        const c = tokens[i].v; i++;
        const sign = /bass|^F/i.test(c) ? 'F' : 'G';
        if (!ctx.discard && ctx.staff) {
          if (!(ctx.staff in score.clefs) && ctx.t === 0) score.clefs[ctx.staff] = sign;
          else score.clefChanges.push({t: ctx.t, staff: ctx.staff, sign});
        }
        return {i, t: ctx.t};
      }
      case 'tempo': {
        if (tokens[i]?.t === 'str' || tokens[i]?.t === 'markup') i++;
        if (tokens[i]?.t === 'num' && tokens[i + 1]?.t === '=') {
          const unit = parseDuration(tokens[i].v);
          const bpm = parseFloat(tokens[i + 2].v);
          if (!score.tempo && !ctx.discard) score.tempo = Math.round(bpm * unit / (WHOLE / 4));
          i += 3;
        }
        return {i, t: ctx.t};
      }
      case 'transpose': throw Error('\\transpose is not supported');
      default: {
        if (vars.has(v)) {
          const [start] = vars.get(v);
          music(start, ctx);
          return {i, t: ctx.t};
        }
        return {i: i + argCount(i - 1), t: ctx.t};
      }
    }
  }

  function resolvePitch(p, ctx, refHolder) {
    let oct;
    if (ctx.mode === 'relative') {
      const ref = refHolder.ref;
      const prevDn = ref.oct * 7 + ref.step;
      let dn = ref.oct * 7 + p.step;
      if (dn - prevDn > 3) dn -= 7;
      if (dn - prevDn < -3) dn += 7;
      dn += 7 * p.marks;
      oct = Math.floor(dn / 7);
      refHolder.ref = {step: p.step, oct};
    } else if (ctx.mode === 'fixed') oct = ctx.fixedOct + p.marks;
    else oct = 3 + p.marks;
    return {step: 'CDEFGAB'[p.step], alter: p.alter, octave: oct, midi: (oct + 1) * 12 + SEMI[p.step] + p.alter};
  }

  function takeDuration(tok, ctx) {
    if (tok.dur) ctx.dur = parseDuration(tok.dur);
    return Math.round(ctx.dur * ctx.scale);
  }

  function emit(ctx, ev) {
    if (!ctx.discard) score.events.push({...ev, voice: ctx.voice, staff: ctx.staff || 1});
  }

  function note(i, ctx) {
    const tk = tokens[i];
    const w = tk.v;
    i++;
    if (w === 'r' || w === 'R' || w === 's') {
      const d = takeDuration(tk, ctx);
      emit(ctx, {t: ctx.t, dur: d, kind: w === 's' ? 'skip' : 'rest'});
      ctx.t += d;
      return {i: postfix(i), t: ctx.t};
    }
    const p = parsePitchName(w);
    if (!p) { score.warnings.push(`ignored word "${w}"`); return {i, t: ctx.t}; }
    const pitch = resolvePitch(p, ctx, ctx);
    const d = takeDuration(tk, ctx);
    let isRest = false;
    if (tokens[i]?.t === 'cmd' && tokens[i].v === 'rest') { isRest = true; i++; }
    const end = postfix(i);
    const tie = tokens.slice(i, end).some(t => t.t === '~');
    emit(ctx, isRest ? {t: ctx.t, dur: d, kind: 'rest'} : {t: ctx.t, dur: d, kind: 'note', pitches: [pitch], tie});
    ctx.t += d;
    return {i: end, t: ctx.t};
  }

  function chord(i, ctx) {
    i++;
    const pitches = [];
    const holder = {ref: ctx.ref};
    let first = null;
    while (tokens[i] && tokens[i].t !== '>') {
      const tk = tokens[i];
      if (tk.t === 'word') {
        const p = parsePitchName(tk.v);
        if (p) {
          const pitch = resolvePitch(p, ctx, holder);
          if (!first) first = holder.ref;
          pitches.push(pitch);
        }
        i = postfix(i + 1);
        continue;
      }
      i++;
    }
    i++; // '>'
    if (ctx.mode === 'relative' && first) ctx.ref = first;
    let dur = '';
    if (tokens[i]?.t === 'num') { dur = tokens[i].v; i++; }
    const d = takeDuration({dur}, ctx);
    const end = postfix(i);
    const tie = tokens.slice(i, end).some(t => t.t === '~');
    emit(ctx, {t: ctx.t, dur: d, kind: 'note', pitches, tie});
    ctx.t += d;
    return {i: end, t: ctx.t};
  }

  // The score body: first music expression after \score {
  let i = scoreStart;
  if (tokens[i]?.t === '{') i++;
  const ctx = {t: 0, dur: WHOLE / 4, scale: 1, mode: 'absolute', ref: {step: 3, oct: 3}, voice: 'v', staff: 0, discard: false};
  music(i, ctx);
  score.time ??= [4, 4];
  return score;
}

// ───────────────────────── MusicXML writer ─────────────────────────

const NOTE_TYPES = [[WHOLE, 'whole'], [WHOLE / 2, 'half'], [WHOLE / 4, 'quarter'], [WHOLE / 8, 'eighth'], [WHOLE / 16, '16th'], [WHOLE / 32, '32nd'], [WHOLE / 64, '64th']];
// Notatable values: plain, dotted, double-dotted, and triplet versions.
const VALUES = [];
for (const [d, type] of NOTE_TYPES) {
  VALUES.push({d, type, dots: 0, tuplet: false});
  VALUES.push({d: d * 1.5, type, dots: 1, tuplet: false});
  VALUES.push({d: d * 1.75, type, dots: 2, tuplet: false});
  VALUES.push({d: d * 2 / 3, type, dots: 0, tuplet: true});
}
VALUES.sort((a, b) => b.d - a.d || a.dots - b.dots);

function splitValue(dur) {
  const exact = VALUES.find(v => Math.abs(v.d - dur) < .01);
  if (exact) return [exact];
  const out = [];
  let rest = dur;
  while (rest > .01) {
    const v = VALUES.find(v => v.d <= rest + .01 && !v.tuplet) ?? VALUES.find(v => v.d <= rest + .01);
    if (!v) throw Error(`cannot notate duration ${dur}`);
    out.push(v); rest -= v.d;
  }
  return out;
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function eventsToMusicXML(score, {title, composer, rights, source} = {}) {
  const [beats, beatType] = score.time;
  const M = WHOLE * beats / beatType;
  const P = score.pickup;
  const beatLen = beatType === 8 && beats % 3 === 0 ? WHOLE * 3 / 8 : WHOLE / beatType;
  const notes = score.events.filter(e => e.kind !== 'skip');
  const end = Math.max(...score.events.map(e => e.t + e.dur));
  const barStart = k => (P ? (k === 0 ? 0 : P + (k - 1) * M) : k * M);
  const barEnd = k => barStart(k) + (P && k === 0 ? P : M);
  let measures = 0;
  while (barStart(measures) < end - .01) measures++;

  // Voices in order of first appearance; MusicXML voice numbers 1..n.
  const voiceIds = [...new Set(notes.map(e => e.voice))];
  const firstStaff = v => notes.find(e => e.voice === v).staff;
  voiceIds.sort((a, b) => firstStaff(a) - firstStaff(b));
  const voiceNo = new Map(voiceIds.map((v, k) => [v, k + 1]));

  // Split events at barlines.
  const perMeasure = Array.from({length: measures}, () => new Map());
  for (const e of notes.sort((a, b) => a.t - b.t)) {
    let t = e.t, left = e.dur;
    while (left > .01) {
      let k = 0; while (k < measures - 1 && barEnd(k) <= t + .01) k++;
      const part = Math.min(left, barEnd(k) - t);
      const piece = {...e, t, dur: part, tieIn: t > e.t, tieOut: left - part > .01 || e.tie};
      const map = perMeasure[k];
      if (!map.has(e.voice)) map.set(e.voice, []);
      map.get(e.voice).push(piece);
      t += part; left -= part;
    }
  }

  const keyAlters = {};
  const order = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  if (score.key > 0) order.slice(0, score.key).forEach(s => keyAlters[s] = 1);
  if (score.key < 0) [...order].reverse().slice(0, -score.key).forEach(s => keyAlters[s] = -1);

  // Clef changes after the start, without no-op repeats (e.g. one per voice).
  const clefNow = {1: score.clefs[1] ?? 'G', 2: score.clefs[2] ?? 'F'};
  const clefChanges = [...score.clefChanges].sort((a, b) => a.t - b.t)
    .filter(c => clefNow[c.staff] !== c.sign && (clefNow[c.staff] = c.sign));
  const clefXml = c => `   <attributes><clef number="${c.staff}"><sign>${c.sign}</sign><line>${c.sign === 'G' ? 2 : 4}</line></clef></attributes>\n`;

  const tiedFrom = new Map(); // voice -> midi numbers with an open tie
  let xml = '';
  for (let k = 0; k < measures; k++) {
    const len = barEnd(k) - barStart(k);
    xml += `  <measure number="${P ? k : k + 1}"${P && k === 0 ? ' implicit="yes"' : ''}>\n`;
    if (k === 0) {
      xml += `   <attributes><divisions>${DIVISIONS}</divisions><key><fifths>${score.key}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><staves>2</staves>` +
        `<clef number="1"><sign>${score.clefs[1] ?? 'G'}</sign><line>${(score.clefs[1] ?? 'G') === 'G' ? 2 : 4}</line></clef>` +
        `<clef number="2"><sign>${score.clefs[2] ?? 'F'}</sign><line>${(score.clefs[2] ?? 'F') === 'G' ? 2 : 4}</line></clef></attributes>\n`;
      if (score.tempo) xml += `   <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.tempo}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${score.tempo}"/></direction>\n`;
    }
    const shown = {1: {}, 2: {}};
    let wrote = false;
    for (const v of voiceIds) {
      const items = perMeasure[k].get(v);
      if (!items?.length) continue;
      if (wrote) xml += `   <backup><duration>${len}</duration></backup>\n`;
      wrote = true;
      const vn = voiceNo.get(v);
      let cursor = barStart(k);
      // Expand items into notated pieces (with gaps as forwards).
      const pieces = [];
      for (const it of items) {
        if (it.t > cursor + .01) pieces.push({forward: it.t - cursor, staff: it.staff});
        const parts = splitValue(it.dur);
        parts.forEach((pv, pi) => pieces.push({...it, value: pv, tieIn: pi > 0 || it.tieIn, tieOut: pi < parts.length - 1 || it.tieOut, pos: 0}));
        cursor = it.t + it.dur;
      }
      if (cursor < barEnd(k) - .01) pieces.push({forward: barEnd(k) - cursor, staff: items.at(-1).staff});

      // Positions for beaming and tuplets.
      let pos = barStart(k);
      for (const pc of pieces) { pc.pos = pos - barStart(k); pos += pc.forward ?? pc.value.d; }
      const beamInfo = beamPieces(pieces, beatLen);
      let tupletAcc = 0;
      pieces.forEach((pc, idx) => {
        for (const c of clefChanges)
          if (!c.done && c.staff === pc.staff && c.t >= barStart(k) - .01 && c.t <= barStart(k) + pc.pos + .01) { xml += clefXml(c); c.done = true; }
        if (pc.forward) { xml += `   <forward><duration>${Math.round(pc.forward)}</duration><voice>${vn}</voice><staff>${pc.staff}</staff></forward>\n`; tupletAcc = 0; return; }
        const val = pc.value;
        let tupletStart = false, tupletStop = false;
        if (val.tuplet) {
          if (tupletAcc === 0) tupletStart = true;
          tupletAcc += val.d;
          const group = NOTE_TYPES.find(([, t]) => t === val.type)[0] * 2;
          if (tupletAcc >= group - .01) { tupletStop = true; tupletAcc = 0; }
        } else tupletAcc = 0;
        const ps = pc.kind === 'rest' ? [null] : pc.pitches;
        ps.forEach((p, pi) => {
          let x = '   <note>';
          if (pi > 0) x += '<chord/>';
          const stop = p && pc.tieIn ? true : p && (tiedFrom.get(v) ?? []).includes(p.midi);
          x += p ? `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>` : '<rest/>';
          x += `<duration>${Math.round(val.d)}</duration>`;
          if (p && stop) x += '<tie type="stop"/>';
          if (p && pc.tieOut) x += '<tie type="start"/>';
          x += `<voice>${vn}</voice><type>${val.type}</type>` + '<dot/>'.repeat(val.dots);
          if (p) {
            const key = p.step + p.octave;
            const cur = shown[pc.staff]?.[key] ?? keyAlters[p.step] ?? 0;
            if (p.alter !== cur && !stop) x += `<accidental>${{'-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp'}[p.alter]}</accidental>`;
            (shown[pc.staff] ??= {})[key] = p.alter;
          }
          if (val.tuplet) x += '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
          x += `<staff>${pc.staff}</staff>`;
          if (pi === 0) for (const b of beamInfo[idx] ?? []) x += `<beam number="${b.n}">${b.v}</beam>`;
          const nots = [];
          if (p && stop) nots.push('<tied type="stop"/>');
          if (p && pc.tieOut) nots.push('<tied type="start"/>');
          if (pi === 0 && tupletStart) nots.push('<tuplet type="start" bracket="no"/>');
          if (pi === 0 && tupletStop) nots.push('<tuplet type="stop"/>');
          if (nots.length) x += `<notations>${nots.join('')}</notations>`;
          xml += x + '</note>\n';
        });
        tiedFrom.set(v, pc.kind === 'note' && pc.tieOut ? pc.pitches.map(p => p.midi) : []);
      });
    }
    for (const c of clefChanges) if (!c.done && c.t < barEnd(k) - .01) { xml += clefXml(c); c.done = true; }
    if (!wrote) xml += `   <note><rest measure="yes"/><duration>${len}</duration><voice>1</voice><staff>1</staff></note>\n`;
    if (k === measures - 1) xml += '   <barline location="right"><bar-style>light-heavy</bar-style></barline>\n';
    xml += '  </measure>\n';
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
 <work><work-title>${esc(title ?? score.title)}</work-title></work>
 <identification><creator type="composer">${esc(composer ?? score.composer)}</creator><rights>${esc(rights)}</rights><encoding><software>ly2musicxml</software></encoding>${source ? `<source>${esc(source)}</source>` : ''}</identification>
 <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
 <part id="P1">
${xml} </part>
</score-partwise>
`;
}

function beamPieces(pieces, beatLen) {
  const out = pieces.map(() => []);
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      run.forEach((idx, k) => out[idx].push({n: 1, v: k === 0 ? 'begin' : k === run.length - 1 ? 'end' : 'continue'}));
      const short = run.map(idx => ['16th', '32nd', '64th'].includes(pieces[idx].value.type));
      run.forEach((idx, k) => {
        if (!short[k]) return;
        const l = k > 0 && short[k - 1], r = k < run.length - 1 && short[k + 1];
        out[idx].push({n: 2, v: l && r ? 'continue' : l ? 'end' : r ? 'begin' : k === 0 ? 'forward hook' : 'backward hook'});
      });
    }
    run = [];
  };
  pieces.forEach((pc, idx) => {
    const ok = !pc.forward && pc.kind === 'note' && ['eighth', '16th', '32nd', '64th'].includes(pc.value.type);
    const group = Math.floor((pc.pos + .01) / beatLen);
    const endGroup = Math.floor((pc.pos + (pc.forward ?? pc.value.d) - .01) / beatLen);
    if (!ok || group !== endGroup || (run.length && run.group !== group)) flush();
    if (ok && group === endGroup) { if (!run.length) run.group = group; run.push(idx); }
  });
  flush();
  return out;
}

// ───────────────────────── CLI ─────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
  const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
  if (!file) { console.error('usage: ly2musicxml.mjs input.ly [--title T] [--composer C] [--rights R] [--source S] [--tempo BPM]'); process.exit(1); }
  const score = lilypondToEvents(readFileSync(file, 'utf8'));
  if (opt('tempo')) score.tempo = Math.round(+opt('tempo'));
  for (const w of new Set(score.warnings)) console.error('warning:', w);
  const counts = {};
  for (const e of score.events) if (e.kind === 'note') counts[e.voice] = (counts[e.voice] ?? 0) + e.pitches.length;
  console.error(`time ${score.time.join('/')} key ${score.key} pickup ${score.pickup / (WHOLE / 4)}q tempo ${score.tempo} staves ${score.staffNames.join(',')} notes`, counts);
  process.stdout.write(eventsToMusicXML(score, {title: opt('title'), composer: opt('composer'), rights: opt('rights'), source: opt('source')}));
}
