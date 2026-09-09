import { chainRegistry } from '../domain/chains.js';
import type { PortfolioPage, PortfolioRow } from '../services/portfolioService.js';
import { bold, changeEmoji, code, escapeHtml, formatPrice, formatUsdShort, pctSigned, section } from './format.js';

/**
 * /watchlist 视图，每个代币一行（上限 100、每页 20，单行才塞得进 4096 字符）：
 *   PEPE · Ethereum · $0.0₄1200 · MC $5.0B · 🟢 +20% add · 🔴 -5.1% 24h
 * 行情缺失的段省略；一段都没有时只留名字。
 */
function tokenLine(r: PortfolioRow, opts: { sinceAdd: boolean }): string {
  const e = r.entry;
  const parts: string[] = [`${bold(e.symbol)} · ${escapeHtml(chainRegistry.displayName(e.networkSlug))}`];
  if (r.priceUsd !== undefined) parts.push(formatPrice(r.priceUsd));
  if (r.marketCapUsd !== undefined && r.marketCapUsd > 0) parts.push(`MC ${formatUsdShort(r.marketCapUsd)}`);
  if (opts.sinceAdd && r.sinceAddedPct !== undefined) parts.push(`${changeEmoji(r.sinceAddedPct)} ${pctSigned(r.sinceAddedPct)} add`);
  if (r.change24hPct !== undefined) parts.push(`${changeEmoji(r.change24hPct)} ${pctSigned(r.change24hPct)} 24h`);
  return parts.join(' · ');
}

function pageNote(p: PortfolioPage): string {
  return p.pages > 1 ? ` · page ${p.page}/${p.pages}` : '';
}

export function renderPortfolio(p: PortfolioPage): string {
  const out: string[] = [];
  if (p.total === 0) {
    out.push(section('⭐', 'Watchlist'), '', 'Empty. Tap ⭐ Watchlist on any report to track a token here.');
    return out.join('\n');
  }
  out.push(`${section('⭐', 'Watchlist')}  ${p.total} token${p.total === 1 ? '' : 's'}${pageNote(p)}`, '');
  for (const r of p.rows) out.push(tokenLine(r, { sinceAdd: true }));
  out.push('', '<i>Tap 🔍 to rescan · 🗑 to remove</i>');
  return out.join('\n');
}

/**
 * 分享出去的只读版：标题带主人名字，不含 since add（那是主人的私有信息），每币下面附合约地址方便对方直接扫。
 * inline 消息（群里那条）没有聊天上下文不能翻页：只发第一页，超出的写一行 "+N more · Open in Sonar to see all"；
 * 深链进私聊的版本按页翻。
 */
export function renderWatchlistShare(ownerName: string, p: PortfolioPage, opts: { inline?: boolean } = {}): string {
  const out: string[] = [`${section('⭐', `${ownerName}'s Watchlist`)}  ${p.total} token${p.total === 1 ? '' : 's'}${opts.inline ? '' : pageNote(p)}`, ''];
  for (const r of p.rows) {
    out.push(tokenLine(r, { sinceAdd: false }));
    out.push(code(r.entry.address));
  }
  const rest = p.total - p.rows.length;
  if (opts.inline && rest > 0) out.push('', `<i>+${rest} more · Open in Sonar to see all</i>`);
  out.push('', '<i>Paste any address to the bot for a full report</i>');
  return out.join('\n');
}
