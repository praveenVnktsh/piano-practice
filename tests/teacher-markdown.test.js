import {describe, expect, test} from 'vitest';
import {escapeHtml, renderMarkdown} from '../src/teacher/markdown.js';

describe('teacher markdown', () => {
  test('escapes HTML everywhere', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    const html = renderMarkdown('<script>alert(1)</script>\n\n- <img src=x onerror=alert(1)>\n\n**<b>bold</b>**');
    expect(html).not.toMatch(/<script|<img|<b>/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<strong>&lt;b&gt;bold&lt;/b&gt;</strong>');
  });

  test('renders paragraphs, line breaks, lists, bold, italic and code', () => {
    expect(renderMarkdown('Hello **there**.\nSecond line.\n\nNew *para* with `C4`.')).toBe(
      '<p>Hello <strong>there</strong>.<br>Second line.</p><p>New <em>para</em> with <code>C4</code>.</p>',
    );
    expect(renderMarkdown('Try this:\n- slow\n- hands separately\n\n1. one\n2. two')).toBe(
      '<p>Try this:</p><ul><li>slow</li><li>hands separately</li></ul><ol><li>one</li><li>two</li></ol>',
    );
    expect(renderMarkdown('## Plan')).toBe('<h4>Plan</h4>');
  });

  test('leaves links and attributes inert', () => {
    const html = renderMarkdown('[click](javascript:alert(1)) and " onmouseover="x');
    expect(html).not.toContain('<a');
    expect(html).toContain('&quot; onmouseover=&quot;x');
  });

  test('handles empty and odd input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown('2 * 3 * 4')).toBe('<p>2 * 3 * 4</p>');
  });
});
