// Small, safe markdown for teacher replies: paragraphs, line breaks, headings, bullet and
// numbered lists, **bold**, *italic*, `code`. All text is HTML-escaped first; the only tags
// in the output are the ones produced here (no links, images or raw HTML).

export const escapeHtml = t =>
  String(t ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;

/** Markdown text → safe HTML string. */
export function renderMarkdown(src) {
  const lines = String(src ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const out = [];
  let para = [],
    list = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const line of lines) {
    let m;
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if ((m = HEADING.exec(line))) {
      flushPara();
      flushList();
      out.push(`<h4>${inline(m[1])}</h4>`);
    } else if ((m = BULLET.exec(line)) || (m = NUMBER.exec(line))) {
      const tag = BULLET.test(line) ? 'ul' : 'ol';
      flushPara();
      if (list && list.tag !== tag) flushList();
      list ||= {tag, items: []};
      list.items.push(m[1]);
    } else if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ' ' + line.trim(); // continuation of a list item
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join('');
}
