import type { PerpView } from '../services/perpService.js';
import type { CoinIndexHit } from '../domain/coinIndex.js';
import type { LiquidationStats } from '../domain/types.js';
import { normalizeFunding } from '../domain/derivatives.js';
import { bold, escapeHtml, formatApr, formatFunding, formatRatio, formatUsdShort, fundingEmoji, label, tree } from './format.js';

/** 按所明细最多列几家（手机一屏）。 */
const VENUE_ROWS = 8;
/** 交易所名列宽：Hyperliquid / Crypto.com 都是 11 位。 */
const VENUE_COL = 11;

/**
 * /perp 视图。卡片上的 Perps 区块是汇总，这里展开到每家交易所。
 *   头部：OI（占市值比）、合约成交量（对现货倍数）、CEX/DEX OI 拆分、费率参考
 *   按所：OI · 成交量 · 费率（统一折算 8h）
 *   基差：最高溢价 / 最大折价
 *   爆仓：1h / 4h / 24h 多空
 */
export function renderPerpCard(v: PerpView): string {
  const out: string[] = [];
  const p = v.perp;
  const venueCount = p?.venues.length ?? 0;
  const head = [`${bold(`📈 ${escapeHtml(v.symbol)} Perps`)}`];
  if (p) head.push(`${venueCount} venue${venueCount === 1 ? '' : 's'}`, `${p.totalPairs} pair${p.totalPairs === 1 ? '' : 's'}`);
  out.push(head.join(' · '));

  if (p) {
    const rows: string[] = [];
    const mcap = v.core?.marketCapUsd;
    const oiShare = mcap && mcap > 0 ? Math.round((p.openInterestUsd / mcap) * 100) : undefined;
    rows.push(`${label('OI')} ${formatUsdShort(p.openInterestUsd)}${oiShare !== undefined ? `  (${oiShare}% of MC)` : ''}`);
    const spot = v.core?.spotVolume24hUsd;
    const ratio = formatRatio(p.volume24hUsd, spot);
    rows.push(`${label('Vol 24h')} ${formatUsdShort(p.volume24hUsd)}${ratio ? `  (${ratio} spot)` : ''}`);
    const cexOi = p.venues.filter((x) => x.kind === 'cex').reduce((s, x) => s + x.openInterestUsd, 0);
    const dexOi = p.openInterestUsd - cexOi;
    if (cexOi > 0 && dexOi > 0) rows.push(`${label('CEX/DEX')} ${formatUsdShort(cexOi)} / ${formatUsdShort(dexOi)} OI`);
    if (p.funding) rows.push(`${label('Funding')} ${fundingEmoji(p.funding.rate8h)} ${formatFunding(p.funding.rate8h)}/8h · ${formatApr(p.funding.apr)} APR`);
    out.push(...tree(rows));

    // ── 按所 ──
    out.push('', bold('🏦 By venue · OI · Vol · Funding/8h'));
    // 整行等宽才能对齐三列数字；36 列内：11 + 1 + 7 + 1 + 7 + 1 + 8
    // 费率色块放在等宽块前面（每行都有一个，宽度一致不破坏对齐）
    const venueRows = p.venues.slice(0, VENUE_ROWS).map((x) => {
      const r8 = x.fundingRate !== undefined ? normalizeFunding(x.name, x.fundingRate, x.fundingIntervalH).rate8h : undefined;
      const f = r8 !== undefined ? formatFunding(r8) : '—';
      const row = `${x.name.slice(0, VENUE_COL).padEnd(VENUE_COL)} ${formatUsdShort(x.openInterestUsd).padStart(7)} ${formatUsdShort(x.volume24hUsd).padStart(7)} ${f.padStart(8)}`;
      return `${r8 !== undefined ? fundingEmoji(r8) : '⚪️'} <code>${escapeHtml(row)}</code>`;
    });
    if (p.venues.length > VENUE_ROWS) venueRows.push(`+${p.venues.length - VENUE_ROWS} more`);
    out.push(...tree(venueRows));

    // ── 基差 ──
    const withBasis = p.venues.filter((x) => x.basis !== undefined && x.openInterestUsd > 0);
    if (withBasis.length >= 2) {
      const hi = withBasis.reduce((a, b) => (b.basis! > a.basis! ? b : a));
      const lo = withBasis.reduce((a, b) => (b.basis! < a.basis! ? b : a));
      // 只在符号对得上时用 Premium / Discount 的说法；全部同号就报区间
      const rows: string[] = [];
      if (hi.basis! > 0) rows.push(`${label('Premium')} ${fmtBasis(hi.basis!)} ${escapeHtml(hi.name)}`);
      if (lo.basis! < 0) rows.push(`${label('Discount')} ${fmtBasis(lo.basis!)} ${escapeHtml(lo.name)}`);
      if (rows.length === 0) rows.push(`${label('Range')} ${fmtBasis(lo.basis!)} … ${fmtBasis(hi.basis!)}`);
      out.push('', bold('📐 Basis vs index'));
      out.push(...tree(rows));
    }
  }

  // ── 爆仓 ──
  const liqRows = renderLiqRows(v.liquidations);
  if (liqRows.length) {
    out.push('', bold('💥 Liquidations · L / S'));
    out.push(...tree(liqRows));
  }

  if (!p && !liqRows.length) {
    out.push('', `No perpetual markets tracked for ${bold(escapeHtml(v.symbol))} on listed venues.`);
  }

  // ── 脚注 ──
  const notes: string[] = [];
  if (p) {
    const excluded = p.totalPairs - p.countedPairs;
    if (excluded > 0) notes.push(`${excluded} pair${excluded === 1 ? '' : 's'} on unlisted venues excluded`);
    notes.push('funding normalised to 8h');
  }
  if (v.liquidations) notes.push('liquidations cover 9 venues');
  if (v.degraded.length) notes.push(`unavailable: ${v.degraded.join(', ')}`);
  if (notes.length) out.push('', `<i>${escapeHtml(notes.join(' · '))}</i>`);

  return out.join('\n');
}

function renderLiqRows(l: LiquidationStats | undefined): string[] {
  if (!l) return [];
  const row = (name: string, total?: number, long?: number, short?: number) =>
    total !== undefined && total > 0
      ? `${label(name)} ${formatUsdShort(total)}${long !== undefined && short !== undefined ? `  ${formatUsdShort(long)} / ${formatUsdShort(short)}` : ''}`
      : undefined;
  return [
    row('1h', l.total1hUsd, l.long1hUsd, l.short1hUsd),
    row('4h', l.total4hUsd, l.long4hUsd, l.short4hUsd),
    row('24h', l.total24hUsd, l.long24hUsd, l.short24hUsd),
  ].filter((r): r is string => Boolean(r));
}

function fmtBasis(b: number): string {
  const pct = b * 100;
  return `${pct >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(2)}%`;
}

/** /perp 的同名消歧列表。 */
export function renderPerpCandidates(query: string, hits: CoinIndexHit[]): string {
  const lines = [`🔎 Several coins match ${bold(escapeHtml(query))}, pick one:`, ''];
  hits.forEach((h, i) => {
    lines.push(`${i + 1}. ${bold(escapeHtml(h.symbol))} · ${escapeHtml(h.name)}${h.rank ? ` · #${h.rank}` : ''}`);
  });
  return lines.join('\n');
}
