/**
 * A small, dependency-free markdown renderer.
 * Escapes HTML first, then applies a limited set of markdown transforms.
 * Not a full CommonMark implementation on purpose — just enough for
 * RAVIN's replies: bold, italics, inline code, code blocks, links,
 * and simple lists.
 */
window.renderMarkdown = function renderMarkdown(raw) {
  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Pull out fenced code blocks first so nothing inside them gets touched.
  const codeBlocks = [];
  let text = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang.trim(), code: code.replace(/\n$/, "") });
    return `\u0000CODEBLOCK${idx}\u0000`;
  });

  // Escape everything else.
  text = escapeHtml(text);

  // Inline code.
  text = text.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);

  // Bold, then italics.
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  // Links: [text](url) — only allow http(s) to avoid javascript: schemes.
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Unordered lists: turn consecutive "- " or "* " lines into <ul><li>.
  text = text.replace(/(^|\n)([-*] .+(\n[-*] .+)*)/g, (match, lead, block) => {
    const items = block
      .split("\n")
      .map((line) => line.replace(/^[-*]\s+/, "").trim())
      .filter(Boolean)
      .map((item) => `<li>${item}</li>`)
      .join("");
    return `${lead}<ul>${items}</ul>`;
  });

  // Line breaks for anything not already inside a list/block.
  text = text.replace(/\n{2,}/g, "</p><p>");
  text = `<p>${text}</p>`.replace(/\n/g, "<br>");

  // Clean up: don't wrap <ul> blocks in stray <p> tags.
  text = text.replace(/<p>(\s*<ul>)/g, "$1").replace(/(<\/ul>\s*)<\/p>/g, "$1");

  // Don't wrap code block placeholders in <p> tags either (invalid nesting).
  text = text
    .replace(/<p>(\s*\u0000CODEBLOCK\d+\u0000\s*)<\/p>/g, "$1")
    .replace(/(\u0000CODEBLOCK\d+\u0000)/g, "$1");

  // Restore code blocks.
  text = text.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_, idx) => {
    const block = codeBlocks[Number(idx)];
    const langLabel = block.lang ? `<span class="code-lang">${escapeHtml(block.lang)}</span>` : "";
    return `<div class="code-block">${langLabel}<pre><code>${escapeHtml(block.code)}</code></pre></div>`;
  });

  return text;
};
