// Bundled + local song catalogs (public/songs/catalog.json, public/songs/local/catalog.json).

const BASE = import.meta.env.BASE_URL || '/';

async function fetchCatalog(path, optional) {
  try {
    const res = await fetch(BASE + path, {cache: 'no-cache'});
    if (!res.ok) throw Error(res.status + ' ' + res.statusText);
    const type = res.headers.get('content-type') || '';
    if (type.includes('text/html')) throw Error('not found'); // dev-server SPA fallback
    const json = await res.json();
    return (Array.isArray(json?.songs) ? json.songs : []).filter(s => s && s.id && s.file);
  } catch (e) {
    if (!optional) console.warn('Could not load ' + path + ':', e.message);
    return [];
  }
}

/** → {bundled: entry[], local: entry[]}; each entry gets `kind`. */
export async function loadCatalogs() {
  const [bundled, local] = await Promise.all([
    fetchCatalog('songs/catalog.json', false),
    fetchCatalog('songs/local/catalog.json', true),
  ]);
  return {
    bundled: bundled.map(e => ({...e, kind: 'bundled'})),
    local: local.map(e => ({...e, kind: 'local'})),
  };
}

/** Song source for loadSong() from any library entry. */
export function songSource(entry) {
  // Imports saved on the Mac have a file (served from public/); browser-only ones carry their data.
  if (entry.kind === 'import' && !entry.file) return entry.mxlBase64 ? {mxlBase64: entry.mxlBase64} : {data: entry.data};
  return {url: entry.file};
}
