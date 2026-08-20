import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

/** Same minimal sanitization as the server (api/src/lib/render.ts): strip
 *  <script>/<iframe>, inline event handlers, and javascript: URLs. Client-side
 *  preview renders user/AI markdown via dangerouslySetInnerHTML, so it must not
 *  execute embedded scripts. */
function sanitize(html: string): string {
  return html
    .replace(/<\s*(script|iframe)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

export function renderMarkdown(src: string): string {
  if (!src.trim()) return '<p class="muted">(비어 있음)</p>';
  return sanitize(marked.parse(src) as string);
}
