/**
 * 网页正文提取（纯函数，不联网）：去掉 script / style / noscript / svg，剥标签，解实体，压空白。
 * 只对服务端渲染的页面有用；JS 应用（Project Mars 的文档站）抓下来只有壳，visible 文本会很短，调用方按长度判断。
 */
export function extractVisibleText(html: string, maxChars = 6000): string {
  let t = html
    .replace(/<head[^>]*>[\s\S]*?<\/head>/i, ' ')
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t)
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return t.length > maxChars ? t.slice(0, maxChars) : t;
}

/** <meta name="description"> / og:description，很多正经项目的官网只有这一句是文字。 */
export function extractMetaDescription(html: string): string | undefined {
  const re = /<meta[^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]*>/gi;
  for (const m of html.matchAll(re)) {
    const c = /content=["']([^"']{20,})["']/i.exec(m[0]);
    if (c) return decodeEntities(c[1]!).trim();
  }
  return undefined;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * 单页应用（Vue / React 打包后）的兜底：HTML 只有壳，正文在 JS bundle 的渲染函数里，
 * 一句话被拆成多个文本节点：`P(" regions. Plant rigs, collect ")`、`m("b",null,"$DRILL")`、`m("p",null,"…")`。
 * 顺序扫描字符串字面量（正则会把 "don't" 里的 ' 当开头，串成垃圾），按出现顺序把像正文的拼回去。
 * Vite 单文件 bundle 里依赖库在前、应用代码在后，库的报错文案（ethers / noble）也像英文句子，
 * 所以从尾部取 maxChars：应用自己的文案离尾部近。结果是"近似正文"，够模型写简介，不是精确页面。
 */
export function extractProseFromScript(js: string, maxChars = 8000, keywords: string[] = []): string {
  const seen = new Set<string>();
  const cands: string[] = [];
  for (const raw of argumentStrings(js)) {
    const t = raw.replace(/\\n/g, ' ').replace(/\\(["'`])/g, '$1').trim();
    if (!looksLikeProse(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cands.push(t);
  }
  // 超长时先丢价值低的：提到代币符号 / 项目名的句子（"$DRILL pays for rigs…"）最后才丢，其余按短的先丢；保持原顺序
  const kws = keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 2);
  const value = (c: string) => (kws.some((k) => c.toLowerCase().includes(k)) ? 100_000 : 0) + c.length;
  let total = cands.reduce((n, c) => n + c.length + 1, 0);
  const keep = new Set(cands);
  if (total > maxChars) {
    for (const c of [...cands].sort((a, b) => value(a) - value(b))) {
      if (total <= maxChars) break;
      keep.delete(c);
      total -= c.length + 1;
    }
  }
  // 文本节点的碎片拼回句子：以标点结尾的接换行，否则接空格
  let text = '';
  for (const c of cands) if (keep.has(c)) text += c + (/[.!?:]$/.test(c) ? '\n' : ' ');
  return text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/**
 * 只取"参数位置"的双引号字面量：前面是 ( , : [ 之一，后面是 , ) ] } 之一。
 * 编译后的 Vue / React 文案都长这样（`P("…",-1)`、`m("p",null,"…")`、`children:"…"`），
 * 两头都卡住就不会像顺序扫描那样被正则字面量 / 注释里的引号带偏。
 */
function* argumentStrings(js: string): Generator<string> {
  const re = /[(,:[]"((?:[^"\\\n]|\\.){3,400})"(?=[,)\]}])/g;
  for (const m of js.matchAll(re)) yield m[1]!;
}

function looksLikeProse(s: string): boolean {
  if (s.length < 12) return false;
  // 自然语言的词：纯字母（可带尾标点），tailwind 类名 "tw:bg-card"、"translateY(50%)" 这类都不算
  const tokens = s.split(/\s+/);
  const natural = tokens.filter((w) => /^[A-Za-z][A-Za-z']*[,.;:!?)]?$/.test(w)).length;
  if (natural < 3 || natural / tokens.length < 0.7) return false;
  const letters = (s.match(/[A-Za-z]/g) ?? []).length;
  if (letters / s.length < 0.6) return false;
  if (/[{}<>=;\\]|\$\{|\bfunction\b|\breturn\b|https?:\/\/|\.(js|css|png|svg|woff)\b|--[a-z]|\b(utils|instanceof|undefined|null|prototype|constructor)\b/i.test(s)) return false;
  // 库的报错 / 断言文案（ethers / noble / viem）：Expected … / Invalid … / … does not support … / … mismatch
  if (/^(expected|invalid|unsupported|unexpected|cannot|missing|failed|error|unknown|bad|incorrect)\b|does not support|must be|should be|is not (a|an|supported|valid)\b|mismatch|not implemented|already (been )?(called|sent|destroyed)|too (short|large|long|big)|exceeds?\b|is locked|not on curve|requires a\b/i.test(s)) return false;
  return true;
}

/**
 * Next.js 页面（CMC community 的文章页等）的正文在 <script id="__NEXT_DATA__"> 的 JSON 里，
 * 可见文本只有导航。取 JSON 里最长的、像文章的字符串值（含 <p> 或多段落、≥ minChars），剥标签。
 * 找不到返回 undefined，调用方退回可见文本。
 */
export function extractArticleFromNextData(html: string, maxChars = 4000, minChars = 800): string | undefined {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(m[1]!);
  } catch {
    return undefined;
  }
  let best = '';
  const walk = (o: unknown, depth: number): void => {
    if (depth > 12 || o === null) return;
    if (typeof o === 'string') {
      if (o.length > best.length && o.length >= minChars && (/<p[\s>]/i.test(o) || o.split('\n\n').length >= 3)) best = o;
      return;
    }
    if (Array.isArray(o)) for (const v of o) walk(v, depth + 1);
    else if (typeof o === 'object') for (const v of Object.values(o as Record<string, unknown>)) walk(v, depth + 1);
  };
  walk(data, 0);
  if (!best) return undefined;
  const text = extractVisibleText(best, maxChars);
  return text.length >= 200 ? text : undefined;
}
