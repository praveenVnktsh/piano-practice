// LilyPond → MusicXML converter core (no Node APIs: also runs in the browser,
// see src/mutopia/). The command-line wrapper is tools/ly2musicxml.mjs.
//
// This is not a LilyPond implementation. It understands the subset that
// typical engraved piano pieces (Mutopia Project) use, and ignores everything
// that only affects appearance:
//   absolute, \relative, \fixed and \transpose pitch entry; note-name languages
//   (\language, \include "english.ly" …: nederlands, english, deutsch, italiano,
//   español, français …); chords <...> and chord repetition q; rests, skips, R;
//   durations with dots and *n/m scaling; ties; \times / \tuplet;
//   \repeat volta|unfold|percent|segno with \alternative (unfolded);
//   \repeat tremolo (written out) and single-note tremolos c2:16 (a notation);
//   repeats written with \bar ".|:" / ":|." and \set Score.repeatCommands
//   (unfolded, first/second endings included);
//   \partial (also mid-piece); \key and \time (also mid-piece); \cadenzaOn/Off; \clef; \tempo;
//   \tag / \keepWithTag / \removeWithTag; variables (also redefined in terms of themselves);
//   \change Staff / \new Staff / \context; simultaneous music << >> and voices
//   << { } \\ { } >>; variables; \include (with a file reader);
//   grace notes (\grace, \appoggiatura, \acciaccatura, \slashedGrace,
//   \afterGrace) as real grace notes; trills, mordents, turns, fermatas and
//   arpeggios as notations. Fingerings, dynamics, slurs, markups, \override,
//   \set, \tweak and other Scheme expressions are skipped.

const WHOLE = 1920; // ticks per whole note; quarter = 480 (the MusicXML divisions)
const DIVISIONS = WHOLE / 4;
const EPS = .01;

// ───────────────────────── Note-name languages ─────────────────────────

const LANG_ALIASES = {
  nederlands: 'nl', vlaams: 'sol', english: 'en', deutsch: 'de', norsk: 'de', svenska: 'de', suomi: 'de',
  italiano: 'sol', catalan: 'sol', espanol: 'sol', español: 'sol', portugues: 'sol', francais: 'sol', français: 'sol',
};
const langOf = name => LANG_ALIASES[String(name).toLowerCase().replace(/\.ly$/, '')] ?? null;

const STEPS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const SEMI = [0, 2, 4, 5, 7, 9, 11];
const SOLFEGE = {do: 0, re: 1, mi: 2, fa: 3, sol: 4, la: 5, si: 6};

/** Splits a note name into {step (0 = C), alter} in the given language, or null. */
function noteName(name, lang = 'nl') {
  let m;
  switch (lang) {
    case 'en':
      m = name.match(/^([a-g])(ss|x|s|ff|f|-sharpsharp|-sharp|-flatflat|-flat)?$/);
      if (!m) return null;
      return {step: STEPS.indexOf(m[1]), alter: {ss: 2, x: 2, '-sharpsharp': 2, s: 1, '-sharp': 1, ff: -2, '-flatflat': -2, f: -1, '-flat': -1}[m[2]] ?? 0};
    case 'de': {
      m = name.match(/^([a-h])(isis|is|eses|es|ses|s)?$/);
      if (!m) return null;
      if (m[1] === 'b') return m[2] ? (m[2] === 'es' ? {step: 6, alter: -2} : null) : {step: 6, alter: -1};
      const step = m[1] === 'h' ? 6 : STEPS.indexOf(m[1]);
      if ((m[2] === 's' || m[2] === 'ses') && !['a', 'e'].includes(m[1])) return null;
      return {step, alter: {isis: 2, is: 1, eses: -2, ses: -2, es: -1, s: -1}[m[2]] ?? 0};
    }
    case 'sol':
      m = name.match(/^(do|re|mi|fa|sol|la|si)(dd|ss|x|d|s|bb|b)?$/);
      if (!m) return null;
      return {step: SOLFEGE[m[1]], alter: {dd: 2, ss: 2, x: 2, d: 1, s: 1, bb: -2, b: -1}[m[2]] ?? 0};
    default:
      m = name.match(/^([a-g])(isis|eses|ises|is|es|ses|s)?$/);
      if (!m) return null;
      if ((m[2] === 's' || m[2] === 'ses') && !['a', 'e'].includes(m[1])) return null;
      return {step: STEPS.indexOf(m[1]), alter: {isis: 2, is: 1, eses: -2, ses: -2, es: -1, s: -1}[m[2]] ?? 0};
  }
}

function parsePitchName(word, lang) {
  const m = word.match(/^([a-z-]+?)([',]*)[!?]?(?:=[',]*)?$/);
  if (!m) return null;
  const n = noteName(m[1], lang);
  if (!n) return null;
  return {...n, marks: [...m[2]].reduce((a, ch) => a + (ch === "'" ? 1 : -1), 0)};
}

// ───────────────────────── \include ─────────────────────────

const INCLUDE_RE = /\\include\s+"([^"]+)"/g;

/**
 * Inlines \include "file" using read(path, fromPath) → text | null (sync) or a
 * Promise of it (then the result is a Promise too). Language files
 * ("english.ly", …) become \language; files the reader can't find are dropped
 * with a warning in `warnings`.
 */
export function expandIncludes(src, read, {path = '', warnings = [], depth = 0} = {}) {
  const parts = [];
  let last = 0, async = false;
  for (const m of src.matchAll(INCLUDE_RE)) {
    parts.push(src.slice(last, m.index));
    last = m.index + m[0].length;
    const file = m[1];
    if (langOf(file)) { parts.push(`\\language "${file.replace(/\.ly$/, '')}"`); continue; }
    if (depth > 8 || !read) { warnings.push(`skipped \\include "${file}"`); parts.push(''); continue; }
    const target = joinPath(dirOf(path), file);
    const got = read(target, path);
    const expand = text => {
      if (text == null) { warnings.push(`could not include "${file}"`); return ''; }
      return expandIncludes(String(text), read, {path: target, warnings, depth: depth + 1});
    };
    if (got && typeof got.then === 'function') { async = true; parts.push(got.then(expand)); }
    else parts.push(expand(got));
  }
  parts.push(src.slice(last));
  if (!async && !parts.some(p => p && typeof p.then === 'function')) return parts.join('');
  return Promise.all(parts).then(ps => ps.join(''));
}
const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
function joinPath(dir, file) {
  if (file.startsWith('/')) return file;
  const out = [];
  for (const seg of (dir + file).split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.') out.push(seg);
  }
  return out.join('/');
}

// ───────────────────────── Tokenizer ─────────────────────────

const MARKUP_FUNCTIONS = new Set(('bold italic upright medium huge large normalsize small tiny teeny fontsize abs-fontsize magnify ' +
  'sans roman typewriter caps smallCaps normal-text number dynamic finger underline box rounded-box circle bracket parenthesize ' +
  'line column center-column left-column right-column dir-column concat wordwrap justify fill-line combine overlay ' +
  'raise lower translate translate-scaled hspace vspace override with-url with-color with-dimensions char fromproperty ' +
  'halign general-align center-align left-align right-align vcenter hcenter-in pad-markup pad-around pad-x pad-to-box ' +
  'rotate scale whiteout transparent hbracket super sub fontCaps musicglyph note note-by-number strut null tied-lyric ' +
  'larger smaller bigger arrow-head draw-line draw-circle epsfile score-lines put-adjacent').split(' '));

function tokenize(src) {
  const tokens = [];
  let i = 0, lang = 'nl';
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
    if (c === '"') {
      const e = readString();
      const v = src.slice(i + 1, e - 1);
      const prev = tokens.at(-1);
      if (prev?.t === 'cmd' && (prev.v === 'language' || prev.v === 'include') && langOf(v)) lang = langOf(v);
      tokens.push({t: 'str', v}); i = e; continue;
    }
    if (c === '#') {
      // Scheme expression: ##t, #'sym, #'(...), #(...), #"str", #-5, #sym
      const start = i;
      let j = i + 1;
      if (src[j] === '#') j += 2;
      else {
        if (src[j] === "'" || src[j] === '`') j++;
        if (src[j] === '(') { i = j; j = balanced('(', ')'); }
        else if (src[j] === '"') { i = j; j = readString(); }
        else while (j < n && !/[\s{}<>()[\]|~"]/.test(src[j])) j++;
      }
      tokens.push({t: 'scheme', v: src.slice(start, j)}); i = j; continue;
    }
    if (src.startsWith('\\markup', i) || src.startsWith('\\markuplist', i)) {
      i += src.startsWith('\\markuplist', i) ? 11 : 7;
      // markup arguments: commands then one braced block or a word/string
      for (;;) {
        while (/\s/.test(src[i])) i++;
        if (src[i] === '{') { i = balanced('{', '}'); break; }
        if (src[i] === '"') { i = readString(); break; }
        if (src[i] === '\\') {
          const s0 = ++i; while (/[A-Za-z-]/.test(src[i])) i++;
          // Markup functions take further arguments; anything else (a variable) is the argument.
          if (MARKUP_FUNCTIONS.has(src.slice(s0, i))) continue;
          break;
        }
        if (src[i] === '#') {
          let j = i + 1; if (src[j] === "'") j++;
          if (src[j] === '(') { i = j; i = balanced('(', ')'); } else { while (j < n && !/\s/.test(src[j])) j++; i = j; }
          continue;
        }
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
      while (j < n && (/[A-Za-z-]/.test(src[j]) || (src[j] === '_' && /[A-Za-z]/.test(src[j - 1]) && /[A-Za-z]/.test(src[j + 1] ?? '')))) j++;
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
    if (c === ':' && /\d/.test(src[i + 1] ?? '')) { // tremolo strokes: c2:16
      let j = i + 1; while (/\d/.test(src[j])) j++;
      tokens.push({t: 'trem', v: +src.slice(i + 1, j)}); i = j; continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j < n && (/[A-Za-z]/.test(src[j]) || ((src[j] === '.' || src[j] === '-' || src[j] === '_') && /[A-Za-z]/.test(src[j + 1] ?? '')))) j++;
      const letters = src.slice(i, j);
      while (j < n && (src[j] === "'" || src[j] === ',')) j++;
      if (src[j] === '!' || src[j] === '?') j++;
      if (src[j] === '=' && noteName(letters, lang)) { // octave check, e.g. c='
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
      tokens.push({t: 'word', v: word, dur, lang}); i = j; continue;
    }
    if (/\d/.test(c)) {
      let j = i; while (/[\d./*]/.test(src[j])) j++;
      tokens.push({t: 'num', v: src.slice(i, j)}); i = j; continue;
    }
    i++;
  }
  return tokens;
}

// ───────────────────────── Durations and keys ─────────────────────────

function parseDuration(text) {
  const m = String(text).match(/^(\d+)(\.*)((?:\*\d+(?:\/\d+)?)*)$/);
  if (!m) throw Error(`bad duration "${text}"`);
  const base = +m[1];
  if (![1, 2, 4, 8, 16, 32, 64, 128].includes(base)) throw Error(`unsupported duration ${base}`);
  let d = WHOLE / base, add = d;
  for (let k = 0; k < m[2].length; k++) { add /= 2; d += add; }
  for (const f of m[3].split('*').filter(Boolean)) { const [a, b = 1] = f.split('/').map(Number); d = d * a / b; }
  return d;
}

// Fifths of a key from its tonic (step + alter) and mode.
const MODE_SHIFT = {major: 0, ionian: 0, minor: -3, aeolian: -3, dorian: -2, phrygian: -4, lydian: 1, mixolydian: -1, locrian: -5};
const STEP_FIFTHS = [0, 2, 4, -1, 1, 3, 5]; // C D E F G A B in major
const keyFifths = (p, mode) => STEP_FIFTHS[p.step] + 7 * p.alter + (MODE_SHIFT[mode] ?? 0);

const ORNAMENTS = {
  trill: 'trill-mark', startTrillSpan: 'trill-mark', prall: 'inverted-mordent', prallprall: 'inverted-mordent',
  upprall: 'inverted-mordent', downprall: 'inverted-mordent', prallmordent: 'inverted-mordent', mordent: 'mordent',
  turn: 'turn', reverseturn: 'inverted-turn',
};
const MARKS = {fermata: 'fermata', shortfermata: 'fermata', longfermata: 'fermata', verylongfermata: 'fermata', arpeggio: 'arpeggiate'};
const DYN = new Set(['ppppp', 'pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'fp', 'sf', 'sff', 'sfz', 'sfp', 'rfz', 'fz', 'cresc', 'decresc', 'dim', 'staccato', 'accent', 'tenuto', 'marcato', 'arpeggio', 'sustainOn', 'sustainOff', 'sostenutoOn', 'sostenutoOff', 'laissezVibrer', 'stopTrillSpan', 'upbow', 'downbow', 'staccatissimo', 'portato', 'espressivo', 'flageolet', 'open', 'stopped', 'snappizzicato', 'thumb', 'segno', 'coda', 'glissando', 'startTextSpan', 'stopTextSpan', 'breathe', 'sp', 'spp', 'n', 'repeatTie', 'lheel', 'rheel', 'ltoe', 'rtoe', 'halfopen', 'varcoda', 'signumcongruentiae']);
const isPostCommand = v => DYN.has(v) || v in ORNAMENTS || v in MARKS || /^(sustain(On|Off)|unaCorda|treCorde)$/.test(v);

// ───────────────────────── Parser / interpreter ─────────────────────────

/**
 * Reads LilyPond source into timed events. `read` (optional) resolves \include
 * synchronously: read(path, fromPath) → text | null; `path` is the file's own path.
 * With `unfold: false` volta repeats stay as printed (body, then each ending once);
 * score.checks then holds the source's bar checks (`|`) and \barNumberCheck marks.
 */
export function lilypondToEvents(src, {read, path = '', unfold = true} = {}) {
  const preWarnings = [];
  if (/\\include\s+"/.test(src)) {
    src = expandIncludes(src, read ?? null, {path, warnings: preWarnings});
    if (typeof src !== 'string') throw Error('use expandIncludes() first for an asynchronous reader');
  }
  const tokens = tokenize(src);
  const vars = new Map();
  const varHistory = new Map(); // name → every definition, in order
  const expanding = new Map(); // name → how deep it is being expanded
  const score = {
    events: [], time: null, key: 0, pickup: 0, tempo: null, clefs: {}, clefChanges: [], staffNames: [], title: null, composer: null,
    keys: [], times: [], partials: [], repeatMarks: [], repeats: [], cadenzas: [], warnings: preWarnings, checks: {bars: [], numbers: []},
  };

  // Header fields.
  const header = src.match(/\\header\s*\{([\s\S]*?)\n\s*\}/);
  if (header) {
    const field = k => header[1].match(new RegExp(`(?:^|\\n)\\s*${k}\\s*=\\s*"([^"]*)"`))?.[1];
    score.title = field('title') ?? field('mutopiatitle'); score.composer = field('composer');
  }

  // Skip a balanced { } block starting at index i (tokens[i] is '{').
  const skipBlock = i => { let d = 0; for (; i < tokens.length; i++) { if (tokens[i].t === '{') d++; else if (tokens[i].t === '}' && --d === 0) return i + 1; } return i; };
  const skipSimul = i => { let d = 0; for (; i < tokens.length; i++) { if (tokens[i].t === '<<') d++; else if (tokens[i].t === '>>' && --d === 0) return i + 1; } return i; };

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
          ctx.lastChord = sub.lastChord;
        }
      });
      ctx.t = end;
      return {i: i + 1, t: end};
    }
    if (tk.t === 'cmd') return command(i, ctx);
    if (tk.t === 'word') return note(i, ctx);
    if (tk.t === '<') return chord(i, ctx);
    if (tk.t === 'num') { score.warnings.push(`ignored number ${tk.v}`); return {i: i + 1, t: ctx.t}; }
    if (tk.t === '|' && live(ctx) && !ctx.grace) score.checks.bars.push({t: ctx.t, voice: ctx.voice});
    return {i: i + 1, t: ctx.t}; // ~ | = post markup str scheme ignore trem
  }

  const WITH_MUSIC = {articulate: 0, unfoldRepeats: 0, relative: 1, fixed: 1, absolute: 1, times: 1, tuplet: 1, grace: 0, appoggiatura: 0, acciaccatura: 0, slashedGrace: 0, afterGrace: 0, new: 1, context: 1, repeat: 1, transpose: 2};

  // Find the end of one music expression without interpreting it.
  function skipMusic(i) {
    const tk = tokens[i];
    if (!tk) return i;
    if (tk.t === '{') return skipBlock(i);
    if (tk.t === '<<') return skipSimul(i);
    if (tk.t === '<') { while (tokens[i] && tokens[i].t !== '>') i++; i++; if (tokens[i]?.t === 'num') i++; return postfix(i); }
    if (tk.t === 'word') return postfix(i + 1);
    if (tk.t === 'cmd') {
      const v = tk.v;
      if (v in WITH_MUSIC) {
        i++;
        if (v === 'relative') { if (tokens[i]?.t === 'word') i++; }
        else if (v === 'fixed') i++;
        else if (v === 'transpose') i += 2;
        else if (v === 'times' || v === 'tuplet') { i++; if (tokens[i]?.t === 'num') i++; }
        else if (v === 'new' || v === 'context') { i++; if (tokens[i]?.t === '=') i += 2; if (tokens[i]?.t === 'cmd' && tokens[i].v === 'with') i = skipBlock(i + 1); }
        else if (v === 'repeat') { i += 2; }
        else if (v === 'afterGrace') { if (tokens[i]?.t === 'num') i++; i = skipMusic(i); }
        i = skipMusic(i);
        if (v === 'repeat' && tokens[i]?.t === 'cmd' && tokens[i].v === 'alternative') i = skipMusic(i + 1);
        return i;
      }
      if (v === 'tag' || v === 'keepWithTag' || v === 'removeWithTag') return skipMusic(i + 2);
      if ((v === 'score' || v === 'book' || v === 'bookpart') && tokens[i + 1]?.t === '{') return skipBlock(i + 1);
      if (vars.has(v)) return postfix(i + 1);
      return command(i, {t: -1, dur: WHOLE / 4, scale: 1, mode: 'absolute', ref: {step: 3, oct: 3}, voice: '_', staff: 0, discard: true}).i;
    }
    return i + 1;
  }

  // Tokens that belong to the previous note (ties, articulations, attached text).
  // Ornaments, fermatas, arpeggios and tremolo strokes are collected in `marks`.
  function postfix(i, marks = []) {
    for (;;) {
      const tk = tokens[i];
      if (!tk) return i;
      if (tk.t === '~' || tk.t === 'ignore') { i++; continue; }
      if (tk.t === 'trem') { marks.push({trem: tk.v}); i++; continue; }
      if (tk.t === 'post') {
        i++;
        if (tokens[i]?.t === 'cmd' && tokens[i].v === 'tweak') { i += 3; continue; }
        if (tokens[i]?.t === 'cmd') addMark(tokens[i].v, marks);
        if (tokens[i]) i++;
        continue;
      }
      if (tk.t === 'cmd' && isPostCommand(tk.v) && !vars.has(tk.v)) { addMark(tk.v, marks); i++; continue; }
      if (tk.t === 'markup' || tk.t === 'str') { i++; continue; }
      return i;
    }
  }
  const addMark = (v, marks) => {
    if (v in ORNAMENTS) marks.push({ornament: ORNAMENTS[v]});
    else if (v in MARKS) marks.push({mark: MARKS[v]});
  };

  // Number of tokens consumed by an ignorable command's arguments.
  function argCount(i) {
    const v = tokens[i].v;
    let j = i + 1;
    const take = () => j++;
    switch (v) {
      case 'unset': case 'revert': { // \revert Grob.prop  /  \revert Grob #'prop
        if (tokens[j]?.t === 'word') j++;
        if (tokens[j]?.t === 'scheme') j++;
        return j - i - 1;
      }
      case 'override': case 'set': {
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
      case 'mark': case 'ottava': case 'tupletSpan': case 'barNumberCheck': case 'label': case 'footnote': case 'language': case 'include': case 'version':
      case 'accidentalStyle': case 'hide': case 'omit': return tokens[j]?.t === 'word' || tokens[j]?.t === 'str' || tokens[j]?.t === 'scheme' ? 1 : 0;
      default: return 0;
    }
  }

  const live = ctx => !ctx.discard && ctx.t >= 0;

  function setCommand(i, ctx) {
    // \set Score.repeatCommands = #'((volta "1")) / #'(start-repeat) / #'((volta #f) end-repeat)
    let j = i;
    if (tokens[j]?.t === 'cmd' && tokens[j].v === 'once') j++;
    if (tokens[j]?.t === 'word' && /(^|\.)repeatCommands$/.test(tokens[j].v) && tokens[j + 1]?.t === '=' && tokens[j + 2]?.t === 'scheme' && live(ctx)) {
      const s = tokens[j + 2].v;
      if (/\(\s*volta\s+#f\s*\)/.test(s)) score.repeatMarks.push({t: ctx.t, type: 'volta-end'});
      const label = s.match(/\(\s*volta\s+"([^"]*)"/);
      if (label) score.repeatMarks.push({t: ctx.t, type: 'volta', label: label[1]});
      if (/end-repeat/.test(s)) score.repeatMarks.push({t: ctx.t, type: 'end'});
      if (/start-repeat/.test(s)) score.repeatMarks.push({t: ctx.t, type: 'start'});
    }
  }

  function command(i, ctx) {
    const v = tokens[i].v;
    i++;
    switch (v) {
      case 'relative': {
        let ref = {step: 3, oct: 3}; // f (LilyPond default)
        if (tokens[i]?.t === 'word') {
          const p = parsePitchName(tokens[i].v, tokens[i].lang);
          if (p) { ref = {step: p.step, oct: 3 + p.marks}; i++; }
        }
        const sub = {...ctx, ref, mode: 'relative'};
        const r = music(i, sub);
        ctx.t = sub.t; ctx.dur = sub.dur; ctx.lastChord = sub.lastChord;
        return {i: r.i, t: ctx.t};
      }
      case 'fixed': {
        const p = parsePitchName(tokens[i].v, tokens[i].lang); i++;
        const sub = {...ctx, mode: 'fixed', fixedOct: 3 + (p?.marks ?? 0)};
        const r = music(i, sub); ctx.t = sub.t; ctx.dur = sub.dur; ctx.lastChord = sub.lastChord;
        return {i: r.i, t: ctx.t};
      }
      case 'absolute': {
        const sub = {...ctx, mode: 'absolute'};
        const r = music(i, sub); ctx.t = sub.t; ctx.dur = sub.dur; ctx.lastChord = sub.lastChord;
        return {i: r.i, t: ctx.t};
      }
      case 'transpose': {
        const a = parsePitchName(tokens[i]?.v ?? '', tokens[i]?.lang), b = parsePitchName(tokens[i + 1]?.v ?? '', tokens[i + 1]?.lang);
        i += 2;
        if (!a || !b) throw Error('\\transpose needs two pitches');
        const steps = (b.marks * 7 + b.step) - (a.marks * 7 + a.step);
        const semis = (b.marks * 12 + SEMI[b.step] + b.alter) - (a.marks * 12 + SEMI[a.step] + a.alter);
        const prev = ctx.transpose ?? {steps: 0, semis: 0};
        const sub = {...ctx, transpose: {steps: prev.steps + steps, semis: prev.semis + semis}};
        const r = music(i, sub); ctx.t = sub.t; ctx.dur = sub.dur;
        if (ctx.mode === 'relative') ctx.ref = sub.ref;
        return {i: r.i, t: ctx.t};
      }
      case 'times': case 'tuplet': {
        const [a, b] = tokens[i].v.split('/').map(Number); i++;
        if (tokens[i]?.t === 'num') i++; // optional span duration
        const scale = v === 'times' ? a / b : b / a;
        const sub = {...ctx, scale: ctx.scale * scale};
        const r = music(i, sub); ctx.t = sub.t; ctx.ref = sub.ref; ctx.dur = sub.dur; ctx.lastChord = sub.lastChord;
        return {i: r.i, t: ctx.t};
      }
      case 'grace': case 'appoggiatura': case 'acciaccatura': case 'slashedGrace': {
        const sub = {...ctx, grace: {slash: v === 'acciaccatura' || v === 'slashedGrace'}};
        const r = music(i, sub); ctx.ref = sub.ref; ctx.dur = sub.dur;
        return {i: r.i, t: ctx.t};
      }
      case 'afterGrace': {
        if (tokens[i]?.t === 'num') i++; // optional fraction
        ({i} = music(i, ctx)); // the main note
        const sub = {...ctx, grace: {slash: false}};
        const r = music(i, sub); ctx.ref = sub.ref; ctx.dur = sub.dur;
        return {i: r.i, t: ctx.t};
      }
      case 'repeat': {
        const kind = tokens[i].v; i++;
        const times = Math.max(1, parseInt(tokens[i].v, 10) || 1); i++;
        const bodyStart = i;
        let after = skipMusic(i);
        const alts = [];
        if (tokens[after]?.t === 'cmd' && tokens[after].v === 'alternative') {
          let j = after + 1;
          if (tokens[j]?.t === '{') { j++; while (tokens[j] && tokens[j].t !== '}') { alts.push(j); j = skipMusic(j); } after = j + 1; }
        }
        if (kind === 'volta' || kind === 'segno') {
          // Volta repeats are read as printed (body, then each ending once) and unfolded
          // afterwards on the timeline, for every staff at once (unfoldRepeats): a voice may
          // write the same passage out without \repeat, as engravers often do.
          score.voltaRepeats = true;
          const start = ctx.t;
          music(bodyStart, ctx);
          const bodyEnd = ctx.t;
          const spans = alts.map(a => { const s = ctx.t; music(a, ctx); return [s, ctx.t]; });
          if (live(ctx)) score.repeats.push({start, bodyEnd, alts: spans, times});
          return {i: after, t: ctx.t};
        }
        // unfold / percent are written out; a tremolo's notes are repeated `times` times (its length).
        // \relative octaves and default durations are lexical: every pass starts from the same
        // reference, and the music after the repeat continues from the body (or last ending) as written.
        const ref0 = ctx.ref, dur0 = ctx.dur;
        let bodyRef = ref0, bodyDur = dur0;
        const altEnd = [];
        for (let k = 0; k < times; k++) {
          ctx.ref = ref0; ctx.dur = dur0;
          music(bodyStart, ctx);
          bodyRef = ctx.ref; bodyDur = ctx.dur;
          if (alts.length) {
            const a = Math.max(0, k - (times - alts.length));
            [ctx.ref, ctx.dur] = a === 0 ? [bodyRef, bodyDur] : altEnd[a - 1] ?? [bodyRef, bodyDur];
            music(alts[a], ctx);
            altEnd[a] = [ctx.ref, ctx.dur];
          }
        }
        [ctx.ref, ctx.dur] = alts.length ? altEnd.at(-1) ?? [bodyRef, bodyDur] : [bodyRef, bodyDur];
        return {i: after, t: ctx.t};
      }
      case 'alternative': return {i: skipMusic(i), t: ctx.t}; // handled by \repeat
      case 'new': case 'context': {
        const type = tokens[i].v; i++;
        let name = null;
        if (tokens[i]?.t === '=') { name = tokens[i + 1].v; i += 2; }
        if (tokens[i]?.t === 'cmd' && tokens[i].v === 'with') i = skipBlock(i + 1);
        const sub = {...ctx};
        if (/^(Dynamics|Lyrics|ChordNames|FiguredBass|FretBoards|NullVoice|TabStaff|TabVoice)$/.test(type)) sub.discard = true;
        if (type === 'Staff' || type === 'RhythmicStaff') {
          // `\context Staff` without a name means the current staff.
          sub.staff = v === 'context' && !name && ctx.staff ? ctx.staff : staffIndex(name ?? `staff${score.staffNames.length + 1}`);
          sub.voice = `${ctx.voice}/S${sub.staff}`;
        }
        if (type === 'Voice') sub.voice = `${ctx.voice}/${name ?? (v === 'context' ? 'ctx' : ++voiceSeq)}`;
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
        const p = parsePitchName(tokens[i]?.v ?? '', tokens[i]?.lang); i++;
        let mode = 'major';
        if (tokens[i]?.t === 'cmd' && tokens[i].v in MODE_SHIFT) { mode = tokens[i].v; i++; }
        if (p && live(ctx)) score.keys.push({t: ctx.t, fifths: keyFifths(p, mode)});
        return {i, t: ctx.t};
      }
      case 'time': {
        if (tokens[i]?.t === 'num' && !tokens[i].v.includes('/')) i++; // beat grouping "2,3"
        const [a, b] = String(tokens[i]?.v ?? '4/4').split('/').map(Number); i++;
        if (a > 0 && b > 0 && live(ctx)) score.times.push({t: ctx.t, beats: a, beatType: b});
        return {i, t: ctx.t};
      }
      case 'partial': {
        const d = parseDuration(tokens[i].v); i++;
        if (live(ctx)) score.partials.push({t: ctx.t, dur: Math.round(d * ctx.scale)});
        return {i, t: ctx.t};
      }
      case 'bar': {
        const s = tokens[i]?.t === 'str' ? tokens[i].v : ''; i++;
        if (live(ctx)) {
          if (/^:/.test(s)) score.repeatMarks.push({t: ctx.t, type: 'end'});
          if (/:$/.test(s)) score.repeatMarks.push({t: ctx.t, type: 'start'});
        }
        return {i, t: ctx.t};
      }
      case 'clef': {
        const c = tokens[i].v; i++;
        const sign = /bass|^F|baritone|varbaritone|subbass/i.test(c) ? 'F' : 'G';
        if (live(ctx) && ctx.staff) {
          // Several clefs at the very start (e.g. \clef bass in the score, \clef treble in the music): the last wins.
          if (ctx.t < EPS && !score.events.some(e => e.staff === ctx.staff && e.t < EPS && !e.grace && e.kind !== 'skip')) score.clefs[ctx.staff] = sign;
          else score.clefChanges.push({t: ctx.t, staff: ctx.staff, sign});
        }
        return {i, t: ctx.t};
      }
      case 'tempo': {
        if (tokens[i]?.t === 'str' || tokens[i]?.t === 'markup') i++;
        if (tokens[i]?.t === 'num' && tokens[i + 1]?.t === '=') {
          const unit = parseDuration(tokens[i].v);
          const bpm = parseFloat(tokens[i + 2].v);
          if (!score.tempo && !ctx.discard && bpm > 0) score.tempo = Math.round(bpm * unit / (WHOLE / 4));
          i += 3;
          if (tokens[i]?.t === 'num' && tokens[i].v.startsWith('-')) i++;
        }
        return {i, t: ctx.t};
      }
      case 'articulate': case 'unfoldRepeats': return music(i, ctx); // music functions that only change playback
      case 'score': {
        // A \score kept in a variable (theScore = \score { … }): its first music expression.
        if (tokens[i]?.t !== '{') return {i, t: ctx.t};
        music(i + 1, ctx);
        return {i: skipBlock(i), t: ctx.t};
      }
      case 'cadenzaOn': case 'cadenzaOff': {
        // Free time: the cadenza is added to the length of the bar it starts in (measureGrid).
        if (live(ctx)) {
          if (v === 'cadenzaOn') score.cadenzas.push({t: ctx.t, end: null, voice: ctx.voice});
          else { const c = score.cadenzas.findLast(c => c.end == null && c.voice === ctx.voice); if (c) c.end = ctx.t; }
        }
        return {i, t: ctx.t};
      }
      case 'barNumberCheck': {
        const n = parseInt(String(tokens[i]?.v ?? '').replace(/^#/, ''), 10);
        if (live(ctx) && Number.isFinite(n)) score.checks.numbers.push({t: ctx.t, n, voice: ctx.voice});
        return {i: i + 1, t: ctx.t};
      }
      case 'keepWithTag': case 'removeWithTag': case 'tag': {
        // Tags: #'name, #'(a b) or a bare word.
        const tk = tokens[i];
        const names = tk?.t === 'scheme' ? tk.v.replace(/^#'?\(?|\)$/g, '').split(/\s+/).filter(Boolean) : tk?.t === 'word' ? [tk.v] : [];
        i++;
        if (v === 'tag') {
          const drop = (ctx.keepTags && !names.some(n => ctx.keepTags.includes(n))) || (ctx.removeTags && names.some(n => ctx.removeTags.includes(n)));
          if (drop) return {i: skipMusic(i), t: ctx.t};
          return music(i, ctx);
        }
        const sub = {...ctx, [v === 'keepWithTag' ? 'keepTags' : 'removeTags']: names};
        const r = music(i, sub);
        ctx.t = sub.t; ctx.dur = sub.dur; ctx.ref = sub.ref; ctx.lastChord = sub.lastChord;
        return {i: r.i, t: ctx.t};
      }
      case 'set': setCommand(i, ctx); return {i: i + argCount(i - 1), t: ctx.t};
      default: {
        if (vars.has(v)) {
          // `x = { \x c }` extends the previous definition of x: inside x, \x is the older one.
          const depth = expanding.get(v) ?? 0;
          const defs = varHistory.get(v);
          const def = defs[defs.length - 1 - depth];
          if (!def || depth > 50) { score.warnings.push(`\\${v} refers to itself`); return {i: postfix(i), t: ctx.t}; }
          expanding.set(v, depth + 1);
          try { music(def[0], ctx); } finally { expanding.set(v, depth); }
          return {i: postfix(i), t: ctx.t};
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
    let step = p.step, alter = p.alter;
    let midi = (oct + 1) * 12 + SEMI[step] + alter;
    if (ctx.transpose) {
      const dn = oct * 7 + step + ctx.transpose.steps;
      step = ((dn % 7) + 7) % 7; oct = Math.floor(dn / 7);
      midi += ctx.transpose.semis;
      alter = midi - ((oct + 1) * 12 + SEMI[step]);
    }
    return {step: 'CDEFGAB'[step], alter, octave: oct, midi};
  }

  function takeDuration(tok, ctx) {
    if (tok.dur) ctx.dur = parseDuration(tok.dur);
    return Math.round(ctx.dur * ctx.scale);
  }

  // Adds an event at the current time; grace notes take no time.
  function place(ctx, ev, d) {
    if (ctx.grace && ev.kind !== 'note') return;
    if (!ctx.discard && ctx.t >= 0) {
      const e = {t: ctx.t, dur: d, ...ev, voice: ctx.voice, staff: ctx.staff || 1, seq: score.events.length};
      if (ctx.grace) e.grace = {...ctx.grace};
      score.events.push(e);
    }
    if (!ctx.grace) ctx.t += d;
  }

  const withMarks = (ev, marks) => {
    const orn = marks.filter(m => m.ornament).map(m => m.ornament);
    const other = marks.filter(m => m.mark).map(m => m.mark);
    const trem = marks.find(m => m.trem)?.trem;
    if (orn.length) ev.ornaments = [...new Set(orn)];
    if (other.length) ev.marks = [...new Set(other)];
    if (trem) ev.tremolo = trem;
    return ev;
  };

  function note(i, ctx) {
    const tk = tokens[i];
    const w = tk.v;
    i++;
    if (w === 'r' || w === 'R' || w === 's') {
      const d = takeDuration(tk, ctx);
      place(ctx, {kind: w === 's' ? 'skip' : 'rest'}, d);
      return {i: postfix(i), t: ctx.t};
    }
    if (w === 'q') { // repeat the previous chord
      const d = takeDuration(tk, ctx);
      const marks = [];
      const end = postfix(i, marks);
      const tie = tokens.slice(i, end).some(t => t.t === '~');
      if (ctx.lastChord) place(ctx, withMarks({kind: 'note', pitches: ctx.lastChord.map(({tie: _, ...p}) => p), tie}, marks), d);
      else { score.warnings.push('q without a previous chord'); place(ctx, {kind: 'rest'}, d); }
      return {i: end, t: ctx.t};
    }
    const p = parsePitchName(w, tk.lang);
    if (!p) { score.warnings.push(`ignored word "${w}"`); return {i, t: ctx.t}; }
    const pitch = resolvePitch(p, ctx, ctx);
    const d = takeDuration(tk, ctx);
    let isRest = false;
    if (tokens[i]?.t === 'cmd' && tokens[i].v === 'rest') { isRest = true; i++; }
    const marks = [];
    const end = postfix(i, marks);
    const tie = tokens.slice(i, end).some(t => t.t === '~');
    place(ctx, isRest ? {kind: 'rest'} : withMarks({kind: 'note', pitches: [pitch], tie}, marks), d);
    return {i: end, t: ctx.t};
  }

  function chord(i, ctx) {
    i++;
    const pitches = [];
    const holder = {ref: ctx.ref};
    const marks = [];
    let first = null;
    while (tokens[i] && tokens[i].t !== '>') {
      const tk = tokens[i];
      if (tk.t === 'word') {
        const p = parsePitchName(tk.v, tk.lang);
        const end = postfix(i + 1, marks);
        if (p) {
          const pitch = resolvePitch(p, ctx, holder);
          if (!first) first = holder.ref;
          if (tokens.slice(i + 1, end).some(t => t.t === '~')) pitch.tie = true; // <c~ e>: only c is tied
          pitches.push(pitch);
        }
        i = end;
        continue;
      }
      i++;
    }
    i++; // '>'
    if (ctx.mode === 'relative' && first) ctx.ref = first;
    let dur = '';
    if (tokens[i]?.t === 'num') { dur = tokens[i].v; i++; }
    if (!pitches.length) return {i: postfix(i), t: ctx.t}; // <> attaches marks and takes no time
    const d = takeDuration({dur}, ctx);
    const end = postfix(i, marks);
    const tie = tokens.slice(i, end).some(t => t.t === '~');
    if (pitches.length) ctx.lastChord = pitches;
    place(ctx, withMarks({kind: 'note', pitches, tie}, marks), d);
    return {i: end, t: ctx.t};
  }

  // Top level: collect variable definitions and find the score.
  let scoreStart = -1;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'cmd' && ['header', 'paper', 'layout', 'midi'].includes(tk.v) && tokens[i + 1]?.t === '{') { i = skipBlock(i + 1) - 1; continue; }
    if (tk.t === 'cmd' && tk.v === 'score') { scoreStart = i + 1; break; }
    if ((tk.t === 'word' || tk.t === 'str') && tokens[i + 1]?.t === '=') {
      const start = i + 2;
      const end = Math.max(start + 1, skipMusic(start)); // one expression: { }, << >>, \relative c' { }, \clef bass …
      vars.set(tk.v, [start, end]);
      (varHistory.get(tk.v) ?? varHistory.set(tk.v, []).get(tk.v)).push([start, end]);
      i = end - 1;
    }
  }
  if (scoreStart < 0) {
    // \book { \score { ... } } or a bare music expression
    scoreStart = tokens.findIndex(t => t.t === 'cmd' && t.v === 'score');
    if (scoreStart < 0) throw Error('no \\score block found');
    scoreStart++;
  }

  // The score body: first music expression after \score {
  let i = scoreStart;
  if (tokens[i]?.t === '{') i++;
  const ctx = {t: 0, dur: WHOLE / 4, scale: 1, mode: 'absolute', ref: {step: 3, oct: 3}, voice: 'v', staff: 0, discard: false};
  music(i, ctx);

  if (unfold) unfoldRepeats(score);
  finishState(score);
  return score;
}

// Keys, meters and pickups: sorted, de-duplicated, with the legacy single values.
function finishState(score) {
  const dedupe = (list, same) => {
    const out = [];
    for (const x of list.sort((a, b) => a.t - b.t)) {
      const at = out.findIndex(o => Math.abs(o.t - x.t) < EPS);
      if (at >= 0) { if (at === out.length - 1) out[at] = x; continue; } // several voices: keep one
      if (out.length && same(out.at(-1), x)) continue;
      out.push(x);
    }
    return out;
  };
  // At the same time the first voice wins (others usually repeat the same change).
  const firstWins = list => list.filter((x, k) => list.findIndex(y => Math.abs(y.t - x.t) < EPS) === k);
  score.keys = dedupe(firstWins(score.keys.slice().sort((a, b) => a.t - b.t)), (a, b) => a.fifths === b.fifths);
  score.times = dedupe(firstWins(score.times.slice().sort((a, b) => a.t - b.t)), (a, b) => a.beats === b.beats && a.beatType === b.beatType);
  if (!score.times.length || score.times[0].t > EPS) score.times.unshift({t: 0, beats: 4, beatType: 4});
  if (!score.keys.length || score.keys[0].t > EPS) score.keys.unshift({t: 0, fifths: 0});
  score.partials = firstWins(score.partials.slice().sort((a, b) => a.t - b.t));
  score.cadenzas = firstWins(score.cadenzas.filter(c => c.end > c.t + EPS).sort((a, b) => a.t - b.t)).map(({t, end}) => ({t, end}));
  score.time = [score.times[0].beats, score.times[0].beatType];
  score.key = score.keys[0].fifths;
  score.pickup = score.partials.find(p => p.t < EPS)?.dur ?? 0;
}

// Repeats drawn with bar lines (\bar ".|:" … ":|.") or \set Score.repeatCommands, as
// {start, bodyEnd, alts: [[from, to], …], times: 2}.
function barLineRepeats(score) {
  const raw = score.repeatMarks.slice().sort((a, b) => a.t - b.t);
  const marks = raw.filter((m, k) => raw.findIndex(o => o.type === m.type && Math.abs(o.t - m.t) < EPS) === k);
  const out = [];
  let start = 0, volta = null;
  marks.forEach((m, k) => {
    if (m.type === 'start') start = m.t;
    else if (m.type === 'volta' && volta == null && !/^\s*[2-9]/.test(m.label ?? '')) volta = m.t;
    else if (m.type === 'end' && m.t > start + EPS) {
      if (volta != null && volta > start) {
        const close = marks.slice(k + 1).find(o => o.type === 'volta-end' || o.type === 'start' || o.type === 'end');
        const alt2End = close?.type === 'volta-end' ? close.t : m.t;
        out.push({start, bodyEnd: volta, alts: [[volta, m.t], [m.t, alt2End]], times: 2});
      } else out.push({start, bodyEnd: m.t, alts: [], times: 2});
      start = m.t; volta = null;
    }
  });
  return out;
}

// Unfolds volta repeats: the timeline is cut into the order the music is played in.
function unfoldRepeats(score) {
  let repeats = score.repeats;
  if (score.repeatMarks.some(m => m.type === 'end')) {
    // With \repeat volta in the file, repeat bar lines only decorate it (old LilyPond style).
    if (score.voltaRepeats) score.warnings.push('repeat bar lines ignored: the file also uses \\repeat volta');
    else repeats = barLineRepeats(score);
  }
  score.repeatMarks = [];
  if (!repeats.length) return;
  // One repeat per start time (every voice reports it), outermost first, no overlaps.
  const sorted = repeats.slice().sort((a, b) => a.start - b.start || (b.alts.at(-1)?.[1] ?? b.bodyEnd) - (a.alts.at(-1)?.[1] ?? a.bodyEnd));
  const end = Math.max(0, ...score.events.map(e => e.t + (e.grace ? 0 : e.dur)));
  const play = [];
  let cursor = 0;
  for (const r of sorted) {
    if (r.start < cursor - EPS) continue;
    play.push([cursor, r.start]);
    for (let p = 0; p < r.times; p++) {
      play.push([r.start, r.bodyEnd]);
      if (r.alts.length) play.push(r.alts[Math.max(0, p - (r.times - r.alts.length))]);
    }
    cursor = r.alts.length ? Math.max(r.bodyEnd, ...r.alts.map(a => a[1])) : r.bodyEnd;
  }
  if (end > cursor + EPS) play.push([cursor, end]);
  const intervals = [];
  let off = 0;
  for (const [a, b] of play) if (b > a + EPS) { intervals.push({a, b, off}); off += b - a; }

  const inside = (t, iv) => t >= iv.a - EPS && t < iv.b - EPS;
  const remap = (list, keep = () => true) => {
    const out = [];
    for (const iv of intervals)
      for (const x of list)
        if (inside(x.t, iv) && keep(x, iv)) out.push({...x, t: x.t - iv.a + iv.off, ...(x.end != null ? {end: x.end - iv.a + iv.off} : {})});
    return out;
  };
  const events = [];
  for (const iv of intervals)
    for (const e of score.events)
      if (inside(e.t, iv) || (e.grace && Math.abs(e.t - iv.b) < EPS && iv.b >= end - EPS))
        events.push({...e, t: e.t - iv.a + iv.off, dur: e.grace ? e.dur : Math.min(e.dur, iv.b - e.t)});
  events.forEach((e, k) => e.seq = k);
  // The key and meter in effect where a replayed section starts are restated there.
  const restate = list => {
    const sorted = list.slice().sort((a, b) => a.t - b.t);
    const out = remap(sorted);
    for (const iv of intervals) {
      const s = sorted.filter(x => x.t <= iv.a + EPS).at(-1);
      if (s && !out.some(x => Math.abs(x.t - iv.off) < EPS)) out.push({...s, t: iv.off});
    }
    return out;
  };
  // Clefs: restate each staff's clef where a replayed section starts.
  const clefs = remap(score.clefChanges);
  for (const iv of intervals.slice(1)) {
    for (const staff of new Set(score.clefChanges.map(c => c.staff))) {
      const s = score.clefChanges.filter(c => c.staff === staff && c.t <= iv.a + EPS).at(-1);
      const sign = s ? s.sign : score.clefs[staff] ?? (staff === 1 ? 'G' : 'F');
      if (!clefs.some(c => c.staff === staff && Math.abs(c.t - iv.off) < EPS)) clefs.push({t: iv.off, staff, sign});
    }
  }
  score.events = events;
  score.keys = restate(score.keys);
  score.times = restate(score.times);
  score.partials = remap(score.partials, (p, iv) => p.t > EPS || iv.off < EPS);
  score.clefChanges = clefs;
  score.cadenzas = remap(score.cadenzas.filter(c => c.end != null));
}

// ───────────────────────── MusicXML writer ─────────────────────────

const NOTE_TYPES = [[WHOLE, 'whole'], [WHOLE / 2, 'half'], [WHOLE / 4, 'quarter'], [WHOLE / 8, 'eighth'], [WHOLE / 16, '16th'], [WHOLE / 32, '32nd'], [WHOLE / 64, '64th'], [WHOLE / 128, '128th']];
const BEAMS = {eighth: 1, '16th': 2, '32nd': 3, '64th': 4, '128th': 5};
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
  const exact = VALUES.find(v => Math.abs(v.d - dur) < EPS);
  if (exact) return [exact];
  const out = [];
  let rest = dur;
  while (rest > EPS) {
    const v = VALUES.find(v => v.d <= rest + EPS && !v.tuplet) ?? VALUES.find(v => v.d <= rest + EPS);
    if (!v) {
      // Tuplets other than triplets (quintuplets, …) and odd remainders: round to the grid.
      if (rest < WHOLE / 128) break;
      throw Error(`cannot notate duration ${dur}`);
    }
    out.push(v); rest -= v.d;
  }
  return out;
}
// Written value of a grace note (it takes no time).
const graceValue = dur => VALUES.find(v => !v.tuplet && Math.abs(v.d - dur) < EPS) ?? VALUES.filter(v => !v.tuplet && !v.dots).find(v => v.d <= dur + EPS) ?? {type: '16th', dots: 0, d: WHOLE / 16};

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The measures of a score: [{start, len, beats, beatType, full}] from its meters and \partial marks. */
export function measureGrid(score) {
  const times = score.times?.length ? score.times : [{t: 0, beats: score.time[0], beatType: score.time[1]}];
  const partials = score.partials?.length ? score.partials : score.pickup ? [{t: 0, dur: score.pickup}] : [];
  const end = Math.max(EPS, ...score.events.map(e => e.t + (e.grace ? 0 : e.dur)));
  const meterAt = t => times.filter(x => x.t <= t + EPS).at(-1) ?? times[0];
  const bars = [];
  let start = 0;
  while (start < end - EPS && bars.length < 100000) {
    const m = meterAt(start);
    const full = WHOLE * m.beats / m.beatType;
    let len = full;
    const here = partials.find(p => Math.abs(p.t - start) < EPS);
    if (here && here.dur < full - EPS) len = here.dur;
    // Cut the bar short where the meter changes or a mid-piece \partial starts.
    const cuts = [
      ...times.filter(x => x.t > start + EPS && x.t < start + len - EPS).map(x => x.t),
      ...partials.filter(p => p.t > start + EPS && p.t < start + len - EPS && Math.abs(p.t + p.dur - (start + len)) > EPS).map(p => p.t),
    ];
    if (cuts.length) len = Math.min(...cuts) - start;
    for (const c of score.cadenzas ?? []) if (c.t >= start - EPS && c.t < start + len - EPS) len += c.end - c.t;
    bars.push({start, len, beats: m.beats, beatType: m.beatType, full: len >= full - EPS});
    start += len;
  }
  return bars;
}

export function eventsToMusicXML(score, {title, composer, rights, source} = {}) {
  const keys = score.keys?.length ? score.keys : [{t: 0, fifths: score.key}];
  const notes = score.events.filter(e => e.kind !== 'skip');
  const bars = measureGrid(score);
  const measures = bars.length;
  if (!notes.length || !measures) throw Error('No notes could be read from this score');
  const barStart = k => bars[k].start;
  const barEnd = k => bars[k].start + bars[k].len;
  const barAt = t => { // the bar holding time t (bisection)
    let lo = 0, hi = measures - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].start <= t + EPS) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const keyAt = t => keys.filter(x => x.t <= t + EPS).at(-1)?.fifths ?? 0;

  // Voices in order of first appearance; MusicXML voice numbers 1..n.
  const voiceIds = [...new Set(notes.map(e => e.voice))];
  const firstStaff = v => notes.find(e => e.voice === v).staff;
  voiceIds.sort((a, b) => firstStaff(a) - firstStaff(b));
  const voiceNo = new Map(voiceIds.map((v, k) => [v, k + 1]));
  const staves = Math.max(2, ...notes.map(e => e.staff));

  // Split events at barlines. Grace notes stay whole, in the bar where they are played.
  const perMeasure = Array.from({length: measures}, () => new Map());
  const order = (a, b) => a.t - b.t || (b.grace ? 1 : 0) - (a.grace ? 1 : 0) || (a.seq ?? 0) - (b.seq ?? 0);
  for (const e of notes.slice().sort(order)) {
    const push = (k, piece) => {
      const map = perMeasure[k];
      if (!map.has(e.voice)) map.set(e.voice, []);
      map.get(e.voice).push(piece);
    };
    if (e.grace) { if (e.t < barEnd(measures - 1) - EPS) push(barAt(e.t), {...e}); continue; }
    let t = e.t, left = e.dur;
    while (left > EPS) {
      const k = barAt(t);
      const part = k === measures - 1 ? left : Math.min(left, barEnd(k) - t);
      push(k, {...e, t, dur: part, tieIn: t > e.t, tieOut: left - part > EPS || e.tie, first: t === e.t});
      t += part; left -= part;
    }
  }

  const keyAltersOf = fifths => {
    const alters = {};
    const sharps = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
    if (fifths > 0) sharps.slice(0, fifths).forEach(s => alters[s] = 1);
    if (fifths < 0) [...sharps].reverse().slice(0, -fifths).forEach(s => alters[s] = -1);
    return alters;
  };

  // Clef changes after the start, without no-op repeats (e.g. one per voice).
  const clefNow = {1: score.clefs[1] ?? 'G', 2: score.clefs[2] ?? 'F'};
  const clefChanges = [...score.clefChanges].sort((a, b) => a.t - b.t)
    .filter(c => (clefNow[c.staff] ?? 'G') !== c.sign && (clefNow[c.staff] = c.sign))
    .map(c => ({...c}));
  const clefXml = c => `   <attributes><clef number="${c.staff}"><sign>${c.sign}</sign><line>${c.sign === 'G' ? 2 : 4}</line></clef></attributes>\n`;

  const tiedFrom = new Map(); // voice -> midi numbers with an open tie
  let xml = '';
  let number = bars[0] && !bars[0].full ? 0 : 1;
  let prevKey = null, prevTime = null;
  for (let k = 0; k < measures; k++) {
    const bar = bars[k];
    const len = bar.len;
    const fifths = keyAt(bar.start);
    const keyAlters = keyAltersOf(fifths);
    const beatLen = bar.beatType === 8 && bar.beats % 3 === 0 ? WHOLE * 3 / 8 : WHOLE / bar.beatType;
    const implicit = !bar.full && (k === 0 || (bars[k - 1] && !bars[k - 1].full));
    xml += `  <measure number="${number}"${implicit ? ' implicit="yes"' : ''}>\n`;
    number++;
    const timeStr = `${bar.beats}/${bar.beatType}`;
    if (k === 0) {
      xml += `   <attributes><divisions>${DIVISIONS}</divisions><key><fifths>${fifths}</fifths></key><time><beats>${bar.beats}</beats><beat-type>${bar.beatType}</beat-type></time><staves>${staves}</staves>` +
        Array.from({length: staves}, (_, s) => { const sign = score.clefs[s + 1] ?? (s === 0 ? 'G' : 'F'); return `<clef number="${s + 1}"><sign>${sign}</sign><line>${sign === 'G' ? 2 : 4}</line></clef>`; }).join('') + '</attributes>\n';
      if (score.tempo) xml += `   <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.tempo}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${score.tempo}"/></direction>\n`;
    } else if (fifths !== prevKey || (timeStr !== prevTime && bar.full)) {
      xml += '   <attributes>' + (fifths !== prevKey ? `<key><fifths>${fifths}</fifths></key>` : '') +
        (timeStr !== prevTime && bar.full ? `<time><beats>${bar.beats}</beats><beat-type>${bar.beatType}</beat-type></time>` : '') + '</attributes>\n';
    }
    prevKey = fifths;
    if (bar.full || k === 0) prevTime = timeStr;
    const shown = {};
    let wrote = false;
    for (const v of voiceIds) {
      const items = perMeasure[k].get(v);
      if (!items?.length) continue;
      if (wrote) xml += `   <backup><duration>${Math.round(len)}</duration></backup>\n`;
      wrote = true;
      const vn = voiceNo.get(v);
      let cursor = barStart(k);
      // Expand items into notated pieces (with gaps as forwards).
      const pieces = [];
      for (const it of items) {
        if (it.t > cursor + EPS) { pieces.push({forward: it.t - cursor, staff: it.staff}); cursor = it.t; }
        if (it.grace) { pieces.push({...it, value: graceValue(it.dur)}); continue; }
        const parts = splitValue(it.dur);
        parts.forEach((pv, pi) => pieces.push({...it, value: pv, tieIn: pi > 0 || it.tieIn, tieOut: pi < parts.length - 1 || it.tieOut, first: pi === 0 && it.first !== false}));
        cursor = Math.max(cursor, it.t + it.dur);
      }
      if (cursor < barEnd(k) - EPS) pieces.push({forward: barEnd(k) - cursor, staff: items.at(-1).staff});

      // Positions for beaming and tuplets.
      let pos = barStart(k);
      for (const pc of pieces) { pc.pos = pos - barStart(k); pos += pc.grace ? 0 : pc.forward ?? pc.value.d; }
      const beamInfo = beamPieces(pieces, beatLen);
      let tupletAcc = 0;
      pieces.forEach((pc, idx) => {
        for (const c of clefChanges)
          if (!c.done && c.staff === pc.staff && c.t >= barStart(k) - EPS && c.t <= barStart(k) + pc.pos + EPS) { xml += clefXml(c); c.done = true; }
        if (pc.forward) { xml += `   <forward><duration>${Math.round(pc.forward)}</duration><voice>${vn}</voice><staff>${pc.staff}</staff></forward>\n`; tupletAcc = 0; return; }
        const val = pc.value;
        let tupletStart = false, tupletStop = false;
        if (!pc.grace && val.tuplet) {
          if (tupletAcc === 0) tupletStart = true;
          tupletAcc += val.d;
          const group = NOTE_TYPES.find(([, t]) => t === val.type)[0] * 2;
          if (tupletAcc >= group - EPS) { tupletStop = true; tupletAcc = 0; }
        } else if (!pc.grace) tupletAcc = 0;
        const ps = pc.kind === 'rest' ? [null] : pc.pitches;
        ps.forEach((p, pi) => {
          let x = '   <note>';
          if (pc.grace) x += pc.grace.slash ? '<grace slash="yes"/>' : '<grace/>';
          if (pi > 0) x += '<chord/>';
          const stop = !pc.grace && p && (pc.tieIn ? true : (tiedFrom.get(v) ?? []).includes(p.midi));
          x += p ? `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>` : '<rest/>';
          if (!pc.grace) x += `<duration>${Math.round(val.d)}</duration>`;
          if (p && stop) x += '<tie type="stop"/>';
          const tieOut = p && !pc.grace && (pc.tieOut || p.tie);
          if (tieOut) x += '<tie type="start"/>';
          x += `<voice>${vn}</voice><type>${val.type}</type>` + '<dot/>'.repeat(val.dots);
          if (p) {
            const key = p.step + p.octave;
            const st = (shown[pc.staff] ??= {});
            const cur = st[key] ?? keyAlters[p.step] ?? 0;
            if (p.alter !== cur && !stop) x += `<accidental>${{'-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp'}[p.alter]}</accidental>`;
            st[key] = p.alter;
          }
          if (!pc.grace && val.tuplet) x += '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
          x += `<staff>${pc.staff}</staff>`;
          if (pi === 0) for (const b of beamInfo[idx] ?? []) x += `<beam number="${b.n}">${b.v}</beam>`;
          const nots = [];
          if (p && stop) nots.push('<tied type="stop"/>');
          if (tieOut) nots.push('<tied type="start"/>');
          if (pi === 0 && tupletStart) nots.push('<tuplet type="start" bracket="no"/>');
          if (pi === 0 && tupletStop) nots.push('<tuplet type="stop"/>');
          const firstPiece = pc.grace || (pc.first !== false && !pc.tieIn);
          if (pi === 0 && firstPiece) {
            const orn = (pc.ornaments ?? []).map(o => `<${o}/>`);
            if (pc.tremolo && p) orn.push(`<tremolo type="single">${Math.max(1, Math.min(4, Math.round(Math.log2(pc.tremolo)) - 2 - (BEAMS[val.type] ?? 0)))}</tremolo>`);
            if (orn.length) nots.push(`<ornaments>${orn.join('')}</ornaments>`);
            if (pc.marks?.includes('fermata')) nots.push('<fermata type="upright"/>');
          }
          if (p && firstPiece && pc.marks?.includes('arpeggiate')) nots.push('<arpeggiate/>');
          if (nots.length) x += `<notations>${nots.join('')}</notations>`;
          xml += x + '</note>\n';
        });
        if (!pc.grace) tiedFrom.set(v, pc.kind === 'note' ? pc.pitches.filter(p => pc.tieOut || p.tie).map(p => p.midi) : []);
      });
    }
    for (const c of clefChanges) if (!c.done && c.t < barEnd(k) - EPS) { xml += clefXml(c); c.done = true; }
    if (!wrote) xml += `   <note><rest measure="yes"/><duration>${Math.round(len)}</duration><voice>1</voice><staff>1</staff></note>\n`;
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
      const levels = run.map(idx => BEAMS[pieces[idx].value.type] ?? 1);
      for (let n = 2; n <= Math.max(...levels); n++) {
        run.forEach((idx, k) => {
          if (levels[k] < n) return;
          const l = k > 0 && levels[k - 1] >= n, r = k < run.length - 1 && levels[k + 1] >= n;
          out[idx].push({n, v: l && r ? 'continue' : l ? 'end' : r ? 'begin' : k === 0 ? 'forward hook' : 'backward hook'});
        });
      }
    }
    run = [];
  };
  pieces.forEach((pc, idx) => {
    if (pc.grace) return; // grace notes are not part of the beat's beam
    const ok = !pc.forward && pc.kind === 'note' && pc.value.type in BEAMS;
    const group = Math.floor((pc.pos + EPS) / beatLen);
    const endGroup = Math.floor((pc.pos + (pc.forward ?? pc.value.d) - EPS) / beatLen);
    if (!ok || group !== endGroup || (run.length && run.group !== group)) flush();
    if (ok && group === endGroup) { if (!run.length) run.group = group; run.push(idx); }
  });
  flush();
  return out;
}

/** One-call conversion: LilyPond text → {xml, score}. */
export function convertLilyPond(src, {read, path, title, composer, rights, source, tempo} = {}) {
  const score = lilypondToEvents(src, {read, path});
  if (tempo) score.tempo = Math.round(+tempo);
  return {score, xml: eventsToMusicXML(score, {title, composer, rights, source})};
}

export {parsePitchName, tokenize, WHOLE};
