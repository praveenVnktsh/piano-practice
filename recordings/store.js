// Recordings on the Mac's disk (dev server + teacher CLI). One JSON file per take:
//   <dir>/<songDir>/<takeId>.json        (songDir: the song id, made path-safe by songDir())
//   <dir>/_exams/<examId>.json           mock-exam results sheets
// <dir> is .data/recordings (gitignored), or RECORDINGS_DIR. Writes are atomic (temp file +
// rename); nothing the client sends becomes part of a path except validated ids.
import {randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {EXAMS_DIR, ID_RE, MAX_TAKES_PER_SONG, patchTake, songDir, songIdFromDir, takeMeta, validateExam, validateTake} from '../src/record/take.mjs';

export const RECORDINGS_DIR = process.env.RECORDINGS_DIR ? resolve(process.env.RECORDINGS_DIR) : resolve('.data', 'recordings');

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function writeAtomic(dir, name, text) {
  mkdirSync(dir, {recursive: true});
  const tmp = join(dir, `.tmp-${process.pid}-${randomBytes(6).toString('hex')}`);
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, join(dir, name));
  } catch (e) {
    rmSync(tmp, {force: true});
    throw e;
  }
}

const dirsOf = dir => {
  try { return readdirSync(dir).filter(n => n !== EXAMS_DIR && songIdFromDir(n) != null && statSync(join(dir, n)).isDirectory()); } catch { return []; }
};
const jsonFiles = dir => {
  try { return readdirSync(dir).filter(n => n.endsWith('.json') && ID_RE.test(n.slice(0, -5))); } catch { return []; }
};
function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/** Every take (validated; unreadable files are skipped), newest first. With songId: that song's only. */
export function listTakes(dir = RECORDINGS_DIR, songId) {
  const dirs = songId != null ? [songDir(songId)] : dirsOf(dir);
  const out = [];
  for (const d of dirs) for (const f of jsonFiles(join(dir, d))) {
    const raw = readJson(join(dir, d, f));
    if (!raw) continue;
    try { out.push(validateTake(raw)); } catch {}
  }
  return out.sort((a, b) => b.at - a.at);
}

function findTakePath(dir, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, 'invalid take id');
  for (const d of dirsOf(dir)) {
    const path = join(dir, d, id + '.json');
    if (existsSync(path)) return path;
  }
  return null;
}

/** One take by id, or null. */
export function readTake(dir = RECORDINGS_DIR, id) {
  const path = findTakePath(dir, id);
  if (!path) return null;
  try { return validateTake(readJson(path)); } catch { return null; }
}

/** Saves (creates or replaces) a take → its meta. A take id keeps its song. */
export function saveTake(dir = RECORDINGS_DIR, body, {maxPerSong = MAX_TAKES_PER_SONG} = {}) {
  const take = validateTake(body);
  const existing = findTakePath(dir, take.id);
  const target = join(dir, songDir(take.songId));
  if (existing && resolve(existing) !== resolve(join(target, take.id + '.json'))) throw new HttpError(409, 'that take id belongs to another piece');
  if (!existing && jsonFiles(target).length >= maxPerSong) throw new HttpError(409, `at most ${maxPerSong} takes per piece; delete some first`);
  writeAtomic(target, take.id + '.json', JSON.stringify(take) + '\n');
  return takeMeta(take);
}

/** Renames / stores a report / marks a take sent → its meta. */
export function updateTake(dir = RECORDINGS_DIR, id, patch) {
  const path = findTakePath(dir, id);
  if (!path) throw new HttpError(404, `no take ${id}`);
  const take = patchTake(validateTake(readJson(path)), patch);
  writeAtomic(dirname(path), take.id + '.json', JSON.stringify(take) + '\n');
  return takeMeta(take);
}

export function deleteTake(dir = RECORDINGS_DIR, id) {
  const path = findTakePath(dir, id);
  if (!path) throw new HttpError(404, `no take ${id}`);
  rmSync(path, {force: true});
  return true;
}

export function listExams(dir = RECORDINGS_DIR) {
  const d = join(dir, EXAMS_DIR), out = [];
  for (const f of jsonFiles(d)) { try { out.push(validateExam(readJson(join(d, f)))); } catch {} }
  return out.sort((a, b) => b.at - a.at);
}
export function readExam(dir = RECORDINGS_DIR, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, 'invalid exam id');
  const raw = readJson(join(dir, EXAMS_DIR, id + '.json'));
  if (!raw) return null;
  try { return validateExam(raw); } catch { return null; }
}
export function saveExam(dir = RECORDINGS_DIR, body) {
  const exam = validateExam(body);
  writeAtomic(join(dir, EXAMS_DIR), exam.id + '.json', JSON.stringify(exam) + '\n');
  return exam;
}
export function deleteExam(dir = RECORDINGS_DIR, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, 'invalid exam id');
  const path = join(dir, EXAMS_DIR, id + '.json');
  if (!existsSync(path)) throw new HttpError(404, `no exam ${id}`);
  rmSync(path, {force: true});
  return true;
}
