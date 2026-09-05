import { chainRegistry } from '../domain/chains.js';
import type { PortfolioRow } from '../services/portfolioService.js';
import { bold, changeEmoji, escapeHtml, formatPercent, formatPrice, formatUsdShort, label, section, tree } from './format.js';

/**
 * /watchlist 视图，每个代币一个小块：
 *   牛来 · BNB Chain
 *   ├ Price   $0.116737
 *   ├ MC      $116.7M
 *   ├ +0.39% since add 🟢
 *   └ +35.28% 24h 🟢
 * 行情缺失的行省略；一行都没有时只留名字。
 */
export function renderPortfolio(rows: PortfolioRow[]): string {
  const out: string[] = [];
  if (rows.length === 0) {
    out.push(section('⭐', 'Watchlist'), '', 'Empty. Tap ⭐ Watchlist on any report to track a token here.');
    return out.join('\n');
  }
  out.push(`${section('⭐', 'Watchlist')}  ${rows.length} token${rows.length === 1 ? '' : 's'}`);
  for (const r of rows) {
    const e = r.entry;
    out.push('', `${bold(e.symbol)} · ${escapeHtml(chainRegistry.displayName(e.networkSlug))}`);
    const lines: string[] = [];
    if (r.priceUsd !== undefined) lines.push(`${label('Price')} ${formatPrice(r.priceUsd)}`);
    if (r.marketCapUsd !== undefined && r.marketCapUsd > 0) lines.push(`${label('MC')} ${formatUsdShort(r.marketCapUsd)}`);
    if (r.sinceAddedPct !== undefined) lines.push(`${formatPercent(r.sinceAddedPct)} since add ${changeEmoji(r.sinceAddedPct)}`);
    if (r.change24hPct !== undefined) lines.push(`${formatPercent(r.change24hPct)} 24h ${changeEmoji(r.change24hPct)}`);
    out.push(...tree(lines));
  }
  out.push('', '<i>Tap 🔍 to rescan · 🗑 to remove</i>');
  return out.join('\n');
}
