/* Safe block-oriented Markdown for all ARROW Adapt identities. */
window.renderMarkdown = function renderMarkdown(raw) {
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const inline = value => {
    const codes = [];
    let out = escape(value).replace(/`([^`\n]+)`/g, (_, code) => {
      codes.push('<code>' + code + '</code>');
      return '@@INLINE' + (codes.length - 1) + '@@';
    });
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
      '<a href="' + url.replace(/&quot;|&#39;|[&<>"]/g, '') + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
    return out.replace(/@@INLINE(\d+)@@/g, (_, n) => codes[Number(n)]);
  };
  const lines = String(raw ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [], list = [], quote = [], code = [], language = '', fenced = false;
  const flushParagraph = () => { if (paragraph.length) { blocks.push('<p>' + paragraph.map(inline).join('<br>') + '</p>'); paragraph = []; } };
  const flushList = () => { if (list.length) { blocks.push('<ul>' + list.map(item => '<li>' + inline(item) + '</li>').join('') + '</ul>'); list = []; } };
  const flushQuote = () => { if (quote.length) { blocks.push('<blockquote><p>' + quote.map(inline).join('<br>') + '</p></blockquote>'); quote = []; } };
  for (const line of lines) {
    const fence = line.match(/^\s*```([^\s`]*)\s*$/);
    if (fence) {
      flushParagraph(); flushList(); flushQuote();
      if (fenced) {
        blocks.push('<div class="code-block">' + (language ? '<span class="code-lang">' + escape(language) + '</span>' : '') + '<pre><code>' + escape(code.join('\n')) + '</code></pre></div>');
        code = []; language = ''; fenced = false;
      } else { fenced = true; language = fence[1]; }
      continue;
    }
    if (fenced) { code.push(line); continue; }
    if (!line.trim()) { flushParagraph(); flushList(); flushQuote(); continue; }
    const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const quoteLine = line.match(/^\s*>\s?(.*)$/);
    if (heading) { flushParagraph(); flushList(); flushQuote(); const level = heading[1].length; blocks.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>'); }
    else if (bullet) { flushParagraph(); flushQuote(); list.push(bullet[1]); }
    else if (quoteLine) { flushParagraph(); flushList(); quote.push(quoteLine[1]); }
    else { flushList(); flushQuote(); paragraph.push(line); }
  }
  if (fenced) blocks.push('<div class="code-block"><pre><code>' + escape(['```' + language, ...code].join('\n')) + '</code></pre></div>');
  flushParagraph(); flushList(); flushQuote();
  return blocks.join('\n');
};
