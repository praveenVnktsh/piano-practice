// The public-site guard shared by tools/publish-site.mjs and the publish-site GitHub Action.
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';
import {checkBuild, checkTarget} from '../tools/site-guard.mjs';

function build(files) {
  const dir = mkdtempSync(join(tmpdir(), 'site-guard-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), {recursive: true});
    writeFileSync(join(dir, path), text);
  }
  return dir;
}
const CATALOG = JSON.stringify({songs: [{id: 'ode-to-joy', composer: 'Beethoven'}]});

describe('site guard: the build', () => {
  test('a clean build passes', () => {
    const r = checkBuild(build({'index.html': '<!doctype html>', 'songs/catalog.json': CATALOG, 'songs/ode.musicxml': '<x/>'}));
    expect(r.problems).toEqual([]);
    expect(r.files).toHaveLength(3);
  });
  test('private songs, a private catalog entry, a missing catalog', () => {
    expect(checkBuild(build({'songs/catalog.json': CATALOG, 'songs/local/secret.musicxml': 'x'})).problems.join()).toMatch(/songs\/local\/secret/);
    expect(checkBuild(build({'songs/catalog.json': CATALOG, 'songs/una-mattina.mei': 'x'})).problems.join()).toMatch(/una-mattina/);
    expect(checkBuild(build({'songs/catalog.json': JSON.stringify({songs: [{composer: 'Ludovico Einaudi'}]})})).problems.join()).toMatch(/catalog/);
    expect(checkBuild(build({'index.html': 'x'})).problems.join()).toMatch(/catalog\.json is missing/);
  });
});

describe('site guard: the target repo', () => {
  const site = {repo: 'me/piano-practice-site', visibility: 'PUBLIC', url: 'https://github.com/me/piano-practice-site', id: 2};
  test('a separate public repo passes', () => {
    expect(checkTarget({...site, sources: ['https://github.com/me/piano-practice.git', 'me/piano-practice', 'id:1']})).toBeNull();
  });
  test('a private repo is refused', () => {
    expect(checkTarget({...site, visibility: 'PRIVATE'})).toMatch(/not public/);
    expect(checkTarget({...site, visibility: undefined})).toMatch(/not public/);
  });
  test('the source repo is refused, however it is named', () => {
    const src = {repo: 'me/piano-practice', visibility: 'PUBLIC', url: 'https://github.com/me/piano-practice', id: 1};
    expect(checkTarget({...src, sources: ['https://github.com/Me/Piano-Practice.git']})).toMatch(/source repo/);
    expect(checkTarget({...src, sources: ['git@github.com:me/piano-practice.git']})).toMatch(/source repo/);
    expect(checkTarget({...src, sources: ['me/piano-practice']})).toMatch(/source repo/);
    // Renamed under us: the API answers with the new name, the id still matches.
    expect(checkTarget({...src, repo: 'me/renamed', url: 'https://github.com/me/renamed', sources: ['me/old-name', 'id:1']})).toMatch(/source repo/);
    expect(checkTarget({...src, sources: ['https://token@github.com/me/piano-practice']})).toMatch(/source repo/);
  });
});
