import { createLogger } from './logger.js';
import { extractArticleFromNextData, extractMetaDescription, extractProseFromScript, extractVisibleText } from '../domain/webText.js';

const log = createLogger('fetchText');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

export interface PageText {
  url: string;
  text: string;
  meta?: string;
  /** 'html' = 服务端渲染的正文；'bundle' = 壳页，正文是从 JS bundle 里挖出来的近似文本。 */
  kind: 'html' | 'bundle';
}

/** 壳页判定阈值：可见文本不到这个数就去找 bundle。 */
const SHELL_MAX_CHARS = 300;
/** 最多拉几个同源脚本、每个最大多少字节。 */
const BUNDLE_MAX_SCRIPTS = 3;
const BUNDLE_MAX_BYTES = 3_000_000;

/**
 * 抓一个公开网页的可见文本（≤ 6000 字）。只认 http(s)，10 秒超时（走代理时 SPA 壳页 + bundle 实测 6s），最多 1MB；失败或几乎没有文字返回 undefined。
 * 不做 JS 渲染：抓不到正文的站点由调用方退到只给链接。
 */
export async function fetchPageText(url: string, opts: { timeoutMs?: number; maxChars?: number; /** 裁剪 bundle 文案时优先保留含这些词的句子（代币符号、项目名） */ keywords?: string[] } = {}): Promise<PageText | undefined> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  try {
    const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000), redirect: 'follow' });
    if (!res.ok) return undefined;
    const type = res.headers.get('content-type') ?? '';
    if (!/html|text\/plain/i.test(type)) return undefined;
    const html = (await res.text()).slice(0, 1_000_000);
    const maxChars = opts.maxChars ?? 6000;
    const text = extractVisibleText(html, maxChars);
    const meta = extractMetaDescription(html);
    if (text.length >= SHELL_MAX_CHARS) return { url: u.toString(), text, meta, kind: 'html' };
    // 单页应用：HTML 只有壳（Project Mars 的文档站 905 字节），正文在 JS bundle 的渲染函数里
    // bundle 挖出来的文案碎、噪音多，给模型的额度放宽一些（Gemini 免费档输入不计费）
    const prose = await proseFromBundles(u, html, Math.max(maxChars, 10_000), opts.timeoutMs ?? 10_000, opts.keywords ?? []);
    if (prose) return { url: u.toString(), text: prose, meta, kind: 'bundle' };
    if (text.length < 120 && !meta) return undefined;
    return { url: u.toString(), text, meta, kind: 'html' };
  } catch (err) {
    log.debug('fetch failed', { url, err: String(err) });
    return undefined;
  }
}

/** 壳页里的同源 <script src> → 拉下来挖文案。跨域的（CDN 上的框架）不拉，文案不会在那里。 */
async function proseFromBundles(page: URL, html: string, maxChars: number, timeoutMs: number, keywords: string[]): Promise<string | undefined> {
  const srcs: string[] = [];
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1]!, page);
      if (u.origin === page.origin && !srcs.includes(u.toString())) srcs.push(u.toString());
    } catch {
      /* 非法 src 跳过 */
    }
    if (srcs.length >= BUNDLE_MAX_SCRIPTS) break;
  }
  const parts: string[] = [];
  for (const src of srcs) {
    try {
      const res = await fetch(src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs * 2) });
      if (!res.ok) continue;
      const js = (await res.text()).slice(0, BUNDLE_MAX_BYTES);
      const prose = extractProseFromScript(js, maxChars, keywords);
      if (prose.length >= SHELL_MAX_CHARS) parts.push(prose);
    } catch (err) {
      log.debug('bundle fetch failed', { src, err: String(err) });
    }
  }
  if (parts.length === 0) return undefined;
  const joined = parts.join('\n');
  log.info('prose mined from app bundle', { page: page.hostname, scripts: srcs.length, chars: joined.length });
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
}

/**
 * 新闻文章正文（/lore 用）：CMC community 文章页是 Next.js，正文在 __NEXT_DATA__ 里；其它站退回可见文本。
 * 失败或太短返回 undefined。
 */
export async function fetchArticleText(url: string, opts: { timeoutMs?: number; maxChars?: number } = {}): Promise<string | undefined> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  try {
    const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000), redirect: 'follow' });
    if (!res.ok) return undefined;
    const html = (await res.text()).slice(0, 1_500_000);
    const maxChars = opts.maxChars ?? 4000;
    const fromNext = extractArticleFromNextData(html, maxChars);
    if (fromNext) return fromNext;
    const text = extractVisibleText(html, maxChars);
    return text.length >= 400 ? text : undefined;
  } catch (err) {
    log.debug('article fetch failed', { url, err: String(err) });
    return undefined;
  }
}
