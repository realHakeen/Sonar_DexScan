import { chainRegistry } from '../domain/chains.js';
import type { PortfolioPage, PortfolioRow } from '../services/portfolioService.js';
import { bold, changeEmoji, code, escapeHtml, formatPrice, formatUsdShort, pctSigned, section, tree } from './format.js';

/**
 * /watchlist 视图，每个代币三行（上限 100、每页 20）：
 *   4STOCK · BNB Chain
 *   ├ $0.043034 · MC $43.0M
 *   └ 🟢 +18% add · 🔴 -28% 24h
 * 第一行只放名字和链（长链名不换行），第二行是量，第三行是变化。缺的段省略；一段都没有时只留第一行。
 * 分享版：第二行 价格 · MC · 24h，第三行合约地址（没有 since add，那是主人的私有信息）。
 */
function tokenBlock(r: PortfolioRow, opts: { sinceAdd: boolean; address: boolean }): string[] {
  const e = r.entry;
  const head = `${bold(e.symbol)} · ${escapeHtml(chainRegistry.displayName(e.networkSlug))}`;
  const amounts: string[] = [];
  if (r.priceUsd !== undefined) amounts.push(formatPrice(r.priceUsd));
  // 有真实流通市值写 MC，没有（CMC 未核实流通量的新币 / 未收录币）退到 FDV，标签跟着口径走
  if (r.marketCapUsd !== undefined && r.marketCapUsd > 0) amounts.push(`MC ${formatUsdShort(r.marketCapUsd)}`);
  else if (r.fdvUsd !== undefined && r.fdvUsd > 0) amounts.push(`FDV ${formatUsdShort(r.fdvUsd)}`);
  const changes: string[] = [];
  if (opts.sinceAdd && r.sinceAddedPct !== undefined) changes.push(`${changeEmoji(r.sinceAddedPct)} ${pctSigned(r.sinceAddedPct)} add`);
  if (r.change24hPct !== undefined) changes.push(`${changeEmoji(r.change24hPct)} ${pctSigned(r.change24hPct)} 24h`);
  const lines: string[] = [];
  if (opts.address) {
    const second = [...amounts, ...changes];
    if (second.length) lines.push(second.join(' · '));
    lines.push(code(e.address));
  } else {
    if (amounts.length) lines.push(amounts.join(' · '));
    if (changes.length) lines.push(changes.join(' · '));
  }
  return [head, ...tree(lines)];
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
  out.push(`${section('⭐', 'Watchlist')}  ${p.total} token${p.total === 1 ? '' : 's'}${pageNote(p)}`);
  for (const r of p.rows) out.push('', ...tokenBlock(r, { sinceAdd: true, address: false }));
  out.push('', '<i>Tap 🔍 to rescan · 🗑 to remove</i>');
  return out.join('\n');
}

/**
 * 分享出去的只读版：标题带主人名字，不含 since add（那是主人的私有信息），每币下面附合约地址方便对方直接扫。
 * inline 消息（群里那条）没有聊天上下文不能翻页：只发第一页，超出的写一行 "+N more · Open in Sonar to see all"；
 * 深链进私聊的版本按页翻。
 */
export function renderWatchlistShare(ownerName: string, p: PortfolioPage, opts: { inline?: boolean } = {}): string {
  const out: string[] = [`${section('⭐', `${ownerName}'s Watchlist`)}  ${p.total} token${p.total === 1 ? '' : 's'}${opts.inline ? '' : pageNote(p)}`];
  for (const r of p.rows) out.push('', ...tokenBlock(r, { sinceAdd: false, address: true }));
  const rest = p.total - p.rows.length;
  if (opts.inline && rest > 0) out.push('', `<i>+${rest} more · Open in Sonar to see all</i>`);
  out.push('', '<i>Paste any address to the bot for a full report</i>');
  return out.join('\n');
}
