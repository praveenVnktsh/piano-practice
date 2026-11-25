// Publish the built app (only the build, never the source or private songs) to a public GitHub Pages
// repo, so it opens from anywhere: https://<owner>.github.io/<repo>/
//
//   node tools/publish-site.mjs [--repo owner/name] [--dry-run]
//
// Builds with BASE=./ (works from any sub-path) into a temp dir, checks that no private song made it
// in, and force-pushes a single commit to the repo's gh-pages branch (no history: the samples are
// large and every publish replaces the last). Uses your gh / git credentials; the commit is authored
// with your GitHub noreply address so no personal email is published.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkBuild, checkTarget} from './site-guard.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const dry = args.includes('--dry-run');
const run = (cmd, a, o = {}) => execFileSync(cmd, a, {stdio: ['ignore', 'pipe', 'inherit'], ...o}).toString().trim();

const owner = run('gh', ['api', 'user', '--jq', '.login']);
const repo = opt('--repo') || `${owner}/piano-practice-site`;
const work = mkdtempSync(join(tmpdir(), 'piano-site-'));
const out = join(work, 'site');

console.log(`Building into ${out} …`);
execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {stdio: 'inherit', env: {...process.env, BASE: './', INCLUDE_LOCAL_SONGS: ''}});

// Guard (tools/site-guard.mjs, shared with the GitHub Action): nothing private, nothing too big.
const {files, bytes, problems} = checkBuild(out);
if (problems.length) { console.error('Refusing to publish:\n  ' + problems.join('\n  ')); process.exit(1); }
writeFileSync(join(out, '.nojekyll'), '');
console.log(`${files.length} files, ${(bytes / 1e6).toFixed(1)} MB`);
if (dry) { console.log('Dry run: not pushing.'); process.exit(0); }

// The public repo (created once). Never the source repo, and never a private repo: the target must
// be public, and must not be this checkout's origin (repos can be renamed under us).
let exists = true, info = null;
try { info = JSON.parse(run('gh', ['repo', 'view', repo, '--json', 'nameWithOwner,visibility,url'])); } catch { exists = false; }
let origin = '';
try { origin = run('git', ['remote', 'get-url', 'origin']).replace(/\.git$/, '').toLowerCase(); } catch {}
let source = '';
try { source = run('gh', ['repo', 'view', '--json', 'url', '--jq', '.url']).toLowerCase(); } catch {}
const problem = exists && checkTarget({repo: info.nameWithOwner, visibility: info.visibility, url: info.url, sources: [origin, source]});
if (problem) {
  console.error(`${problem} Pass --repo owner/name for a separate public repo.`);
  process.exit(1);
}
if (!exists) {
  const [o, name] = repo.split('/');
  const path = o === owner ? 'user/repos' : `orgs/${o}/repos`;
  run('gh', ['api', '-X', 'POST', path, '-f', `name=${name}`, '-F', 'private=false', '-f', 'description=Piano Practice: a practice room in the browser (built app only).']);
  console.log(`Created https://github.com/${repo}`);
}

const id = run('gh', ['api', 'user', '--jq', '.id']);
const env = {...process.env, GIT_AUTHOR_NAME: owner, GIT_COMMITTER_NAME: owner,
  GIT_AUTHOR_EMAIL: `${id}+${owner}@users.noreply.github.com`, GIT_COMMITTER_EMAIL: `${id}+${owner}@users.noreply.github.com`};
const git = (...a) => run('git', a, {cwd: out, env});
const commit = run('git', ['rev-parse', '--short', 'HEAD']);
git('init', '-q', '-b', 'gh-pages');
git('add', '-A');
git('commit', '-q', '-m', `Publish ${commit}`);
const url = run('gh', ['repo', 'view', repo, '--json', 'url', '--jq', '.url']);
git('push', '-q', '--force', `${url}.git`, 'gh-pages');

// Pages from the gh-pages branch (first time only).
try { run('gh', ['api', `repos/${repo}/pages`]); } catch {
  run('gh', ['api', '-X', 'POST', `repos/${repo}/pages`, '-f', 'source[branch]=gh-pages', '-f', 'source[path]=/']);
}
const site = run('gh', ['api', `repos/${repo}/pages`, '--jq', '.html_url']);
rmSync(work, {recursive: true, force: true});
console.log(`Published ${commit} → ${site} (GitHub takes a minute to update it).`);
if (existsSync('.data')) console.log('Your .data/ stays on this Mac: the public site keeps progress in the browser.');
