import { chainRegistry } from '../domain/chains.js';
import type { PortfolioRow } from '../services/portfolioService.js';
import { changeEmoji, escapeHtml, formatPercent, formatPrice, formatUsdShort, section, tree } from './format.js';

/**
 * /portfolio 视图：
 *   ⭐ Portfolio  3 tokens
 *   ├ PEPE · Ethereum  $0.0₅358  🟢 +12.3% since add · 🔴 −5.1% 24h
 *   └ …
 * 行情缺失只显示名字，不显示 "—" 一串。
 */
export function renderPortfolio(rows: PortfolioRow[]): string {
  const out: string[] = [];
  if (rows.length === 0) {
    out.push(section('⭐', 'Portfolio'), '', 'Empty. Tap ⭐ Add to Portfolio on any report to track a token here.');
    return out.join('\n');
  }
  out.push(`${section('⭐', 'Portfolio')}  ${rows.length} token${rows.length === 1 ? '' : 's'}`);
  out.push(
    ...tree(
      rows.map((r) => {
        const e = r.entry;
        const head = `${escapeHtml(e.symbol)} · ${escapeHtml(chainRegistry.displayName(e.networkSlug))}`;
        if (r.priceUsd === undefined) return head;
        const parts = [`${head}  ${formatPrice(r.priceUsd)}`];
        if (r.sinceAddedPct !== undefined) parts.push(`${changeEmoji(r.sinceAddedPct)} ${formatPercent(r.sinceAddedPct)} since add`);
        if (r.change24hPct !== undefined) parts.push(`${changeEmoji(r.change24hPct)} ${formatPercent(r.change24hPct)} 24h`);
        return parts.join(' · ').replace('  ·', ' ·');
      }),
    ),
  );
  const mcaps = rows.filter((r) => r.marketCapUsd !== undefined);
  if (mcaps.length) {
    out.push('', `<i>Tap 🔍 to rescan · 🗑 to remove · MC ${mcaps.map((r) => `${escapeHtml(r.entry.symbol)} ${formatUsdShort(r.marketCapUsd)}`).join(' · ')}</i>`);
  } else {
    out.push('', '<i>Tap 🔍 to rescan · 🗑 to remove</i>');
  }
  return out.join('\n');
}
