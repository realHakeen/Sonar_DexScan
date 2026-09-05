/** 纯格式化工具，无副作用、无依赖，便于单测。输出面向 Telegram HTML parse_mode。 */

const SUBSCRIPT = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

export function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function toSubscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUBSCRIPT[Number(d)] ?? d)
    .join('');
}

/**
 * 价格格式化。meme 币动辄 0.000000001234，直接 toFixed 会全是 0，
 * 所以小于 0.001 时用 $0.0₆1234 的下标压缩写法。
 */
export function formatPrice(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  if (v === 0) return '$0';
  if (v >= 1) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
  if (v >= 0.001) return `$${v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;

  const exp = Math.floor(Math.log10(v));
  const leadingZeros = Math.abs(exp) - 1;
  const digits = Math.round(v * 10 ** (leadingZeros + 4)).toString().slice(0, 4);
  return `$0.0${toSubscript(leadingZeros)}${digits}`;
}

/** 大数压缩：$1.2B / $340.5M / $12.3K。 */
export function formatUsd(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatCount(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

/** 入参已是百分比数值（mapper 里已对 pc24h 做过 ×100）。 */
export function formatPercent(v: number | undefined, withSign = true): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const sign = withSign && v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

export function changeEmoji(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '';
  if (v > 0) return '🟢';
  if (v < 0) return '🔴';
  return '⚪️';
}

/** 上线时长。 */
export function formatAge(listedAt: number | undefined, now = Date.now()): string {
  if (!listedAt || listedAt <= 0 || listedAt > now) return '—';
  const ms = now - listedAt;
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** 长地址缩写，保留首尾便于人眼核对。 */
export function shortenAddress(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function link(text: string, url: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
}

export function bold(text: string): string {
  return `<b>${escapeHtml(text)}</b>`;
}

export function code(text: string): string {
  return `<code>${escapeHtml(text)}</code>`;
}

/** 用于集中度等占比的简易进度条。 */
export function bar(pct: number | undefined, width = 10): string {
  if (pct === undefined || !Number.isFinite(pct)) return '';
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

/** 等宽标签列：Telegram 只有 <code> 能对齐，标签补空格到固定宽度。 */
export function label(text: string, width = 7): string {
  return `<code>${text.padEnd(width)}</code>`;
}


/** 树形连接线：除最后一行用 └，其余用 ├。 */
export function tree(rows: string[]): string[] {
  return rows.map((r, i) => `${i === rows.length - 1 ? '└' : '├'} ${r}`);
}

/** a / b 的倍数，如 "3.4×"。 */
export function formatRatio(a: number | undefined, b: number | undefined): string | undefined {
  if (a === undefined || b === undefined || b <= 0) return undefined;
  const r = a / b;
  // 低于 1× 没有信息量（正常盘都低），只在偏高时显示
  if (!Number.isFinite(r) || r < 1) return undefined;
  return r >= 100 ? `${Math.round(r)}×` : r >= 10 ? `${r.toFixed(0)}×` : `${r.toFixed(1)}×`;
}

/** a 占 a+b 的百分比（买压），整数。 */
export function sharePct(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined || b === undefined) return undefined;
  const total = a + b;
  if (total <= 0) return undefined;
  return Math.round((a / total) * 100);
}

/** 紧凑金额（无小数的 K/M/B），用于一行里塞多个数字。 */
export function formatUsdShort(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`;
  return `$${abs.toFixed(0)}`;
}

/** 手机宽度下 DEX 全名太长，按常见前缀缩写；未知名字原样返回。 */
const DEX_SHORT: Array<[RegExp, string]> = [
  [/^PancakeSwap/i, 'Pancake'],
  [/^Uniswap/i, 'Uni'],
  [/^SushiSwap/i, 'Sushi'],
  [/^Raydium\s*\(?CLMM\)?/i, 'Raydium'],
  [/^Meteora\s*DLMM/i, 'Meteora'],
  [/^Orca\s*\(Whirlpool\)/i, 'Orca'],
];
export function shortDex(name: string): string {
  let n = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  for (const [re, short] of DEX_SHORT) n = n.replace(re, short);
  return n;
}

/** 紧凑百分比：≥10 用整数，否则 1 位小数（33.7% / 2% / 0.5%）。 */
export function pctShort(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  return v >= 10 ? `${Math.round(v)}%` : `${v.toFixed(1)}%`;
}

/**
 * 费率：输入小数（0.0001 = 0.01%）。四位小数足够分辨 0.01% 档，带符号，负费率是有信息量的。
 * 例：0.0001 → "+0.0100%"，-0.00005 → "-0.0050%"。
 */
export function formatFunding(rate: number | undefined): string {
  if (rate === undefined || !Number.isFinite(rate)) return '—';
  const pct = rate * 100;
  return `${pct >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(4)}%`;
}

/**
 * 费率的颜色语义按 CoinGlass 习惯反过来：正费率 = 多头付钱 = 多头拥挤，标红；负费率标绿。
 * Telegram 文本没有颜色，只能用彩色 emoji 当色块。
 */
export function fundingEmoji(rate: number | undefined): string {
  if (rate === undefined || !Number.isFinite(rate)) return '';
  if (rate > 0) return '🔴';
  if (rate < 0) return '🟢';
  return '⚪️';
}

/** 年化：输入小数，一位小数带符号（0.073 → "+7.3%"）。 */
export function formatApr(apr: number | undefined): string {
  if (apr === undefined || !Number.isFinite(apr)) return '—';
  const pct = apr * 100;
  const digits = Math.abs(pct) >= 100 ? 0 : 1;
  return `${pct >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(digits)}%`;
}
