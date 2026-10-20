// Small, safe markdown renderer for AI replies (escapes first, then formats).
import { esc } from './core.js';

const inline = (s) =>
  s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

export function markdown(src) {
  const lines = esc(src).split('\n');
  let html = '';
  let list = null;
  let table = null;
  const closeList = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  const closeTable = () => {
    if (table) html += '</tbody></table>';
    table = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\|.*\|$/.test(line.trim())) {
      closeList();
      const cells = line.trim().slice(1, -1).split('|').map((c) => inline(c.trim()));
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!table) {
        html += `<table><thead><tr>${cells.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
        table = true;
      } else html += `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
      continue;
    }
    closeTable();
    let m;
    if ((m = line.match(/^#{1,4}\s+(.*)/))) {
      closeList();
      html += `<h4>${inline(m[1])}</h4>`;
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      if (list !== 'ul') {
        closeList();
        html += '<ul>';
        list = 'ul';
      }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== 'ol') {
        closeList();
        html += '<ol>';
        list = 'ol';
      }
      html += `<li>${inline(m[1])}</li>`;
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();
  closeTable();
  return html;
}
