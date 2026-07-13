import hljs from "highlight.js/lib/common";

// Map a file extension to a highlight.js language id.
const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  scala: "scala",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  sql: "sql",
  html: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  dockerfile: "dockerfile",
  makefile: "makefile",
};

export function langForPath(path: string): string | null {
  const base = path.split("/").pop()?.toLowerCase() ?? "";
  const byName = EXT_LANG[base];
  if (byName) return hljs.getLanguage(byName) ? byName : null;
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  const lang = EXT_LANG[ext];
  return lang && hljs.getLanguage(lang) ? lang : null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Highlight a multi-line block and return one HTML string per line, with spans
 * split so they stay balanced across line boundaries. Highlighting the whole
 * block (rather than each line alone) preserves multi-line context — string
 * templates, annotations, comments, `when`/`if` blocks — which matters a lot
 * for languages like Kotlin. Falls back to escaped plain text.
 */
export function highlightBlock(code: string, lang: string | null): string[] {
  if (!lang) return code.split("\n").map(escapeHtml);
  let html: string;
  try {
    html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return code.split("\n").map(escapeHtml);
  }

  const lines: string[] = [];
  const stack: string[] = []; // currently-open <span> opening tags
  let cur = "";
  const re = /<span[^>]*>|<\/span>|[^<]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tok = m[0];
    if (tok.startsWith("<span")) {
      stack.push(tok);
      cur += tok;
    } else if (tok === "</span>") {
      stack.pop();
      cur += tok;
    } else {
      const parts = tok.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          cur += "</span>".repeat(stack.length); // close open spans at line end
          lines.push(cur);
          cur = stack.join(""); // reopen them on the next line
        }
        cur += parts[i];
      }
    }
  }
  lines.push(cur);
  return lines;
}
