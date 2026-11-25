// The checks every publish of the public site runs (tools/publish-site.mjs on the Mac and
// .github/workflows/publish-site.yml in CI), so the two can't drift apart:
//
//   checkBuild(dir)  → {files, bytes, problems: [text]}   nothing private in the build, nothing too big
//   checkTarget({repo, visibility, url, sources}) → problem text or null
//                    the target must be public and must not be the source repo
//
// CLI (CI):
//   node tools/site-guard.mjs build <dir>
//   node tools/site-guard.mjs target <owner/name>     reads the repo with GH_TOKEN via the GitHub API;
//                                                    the source is GITHUB_REPOSITORY (+ _ID)
// Exits 1 with the reason when a check fails.
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PRIVATE_PATH = /songs\/local\/|una-mattina\.(mei|pdf|musicxml)|comptine/i;
export const PRIVATE_CATALOG = /einaudi|tiersen/i;
export const MAX_FILE = 90e6; // GitHub refuses files over 100 MB

const walk = d => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

export function checkBuild(dir) {
  const files = walk(dir);
  const problems = [];
  const leaked = files.map(f => relative(dir, f)).filter(f => PRIVATE_PATH.test(f.split('\\').join('/')));
  if (leaked.length) problems.push(`private material in the build: ${leaked.join(', ')}`);
  let catalog = '';
  try { catalog = readFileSync(join(dir, 'songs/catalog.json'), 'utf8'); } catch { problems.push('songs/catalog.json is missing from the build'); }
  if (PRIVATE_CATALOG.test(catalog)) problems.push('private material in the build: songs/catalog.json names a private piece');
  const big = files.filter(f => statSync(f).size > MAX_FILE).map(f => relative(dir, f));
  if (big.length) problems.push(`files too large for GitHub: ${big.join(', ')}`);
  return {files, bytes: files.reduce((n, f) => n + statSync(f).size, 0), problems};
}

const norm = s => String(s || '').trim().toLowerCase().replace(/\.git$/, '').replace(/\/$/, '')
  .replace(/^git@github\.com:/, 'https://github.com/').replace(/^https:\/\/[^@/]+@/, 'https://');

/**
 * `sources`: what identifies the private source repo (its URL or owner/name, origin remote, repo id).
 * `url` / `repo` / `id` describe the target as GitHub reports it (renames resolve to the new name).
 */
export function checkTarget({repo, visibility, url, id, sources = []}) {
  const vis = String(visibility || '').toUpperCase();
  if (vis !== 'PUBLIC') return `Refusing to publish to ${repo}: it is not public.`;
  const target = new Set([norm(url), norm(repo), norm(repo && `https://github.com/${repo}`), id != null ? `id:${id}` : ''].filter(Boolean));
  for (const s of sources.filter(Boolean)) {
    const n = /^id:/.test(String(s)) ? String(s) : norm(s);
    if (target.has(n) || target.has(norm(`https://github.com/${n}`))) return `Refusing to publish to ${repo}: it is this source repo. Use a separate public repo.`;
  }
  return null;
}

async function cli([cmd, arg]) {
  if (cmd === 'build') {
    const {files, bytes, problems} = checkBuild(arg);
    if (problems.length) { console.error('Refusing to publish:\n  ' + problems.join('\n  ')); return 1; }
    console.log(`Build checked: ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB, nothing private.`);
    return 0;
  }
  if (cmd === 'target') {
    const res = await fetch(`https://api.github.com/repos/${arg}`, {headers: {accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? {authorization: `Bearer ${process.env.GH_TOKEN}`} : {})}});
    if (!res.ok) { console.error(`Cannot read ${arg} (${res.status}). Create the public repo once (see README) and check the token.`); return 1; }
    const info = await res.json();
    const problem = checkTarget({repo: info.full_name, visibility: info.private ? 'PRIVATE' : info.visibility, url: info.html_url, id: info.id,
      sources: [process.env.GITHUB_REPOSITORY, process.env.GITHUB_REPOSITORY_ID && `id:${process.env.GITHUB_REPOSITORY_ID}`]});
    if (problem) { console.error(problem); return 1; }
    console.log(`Target ${info.full_name} is public and separate from the source.`);
    return 0;
  }
  console.error('usage: node tools/site-guard.mjs build <dir> | target <owner/name>');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(await cli(process.argv.slice(2)));
