import { chainRegistry } from '../domain/chains.js';
import type { ScoredCandidate } from '../domain/ranking.js';
import { CMC_LISTING_URL } from '../config/constants.js';
import { bold, escapeHtml, formatUsd, link, shortenAddress } from './format.js';

/** 重名消歧列表。按钮在 keyboards.ts，这里只负责文字说明。 */
export function renderCandidateList(query: string, candidates: ScoredCandidate[]): string {
  const lines = [
    `🔎 ${candidates.length} results for ${bold(escapeHtml(query))}, ranked by liquidity & CMC listing:`,
    '',
  ];

  candidates.forEach(({ candidate: c }, i) => {
    const badge = c.officialVerified ? ` ✅ ${link('CMC listed', CMC_LISTING_URL)}` : '';
    // 带币层的候选：币在前，部署 symbol 括号里（TAO (WTAO) · Ethereum）
    const title = c.coin && c.coin.symbol.toUpperCase() !== c.symbol.toUpperCase() ? `${c.coin.symbol} (${c.symbol})` : c.symbol;
    lines.push(
      `${i + 1}. ${bold(title)}${badge} · ${escapeHtml(chainRegistry.displayName(c.networkSlug))}`,
    );
    lines.push(
      `   Liq ${formatUsd(c.liquidityUsd)} · Vol 24h ${formatUsd(c.volume24hUsd)} · ${escapeHtml(shortenAddress(c.address))}`,
    );
  });

  lines.push('');
  lines.push('<i>Tap a button below for the full report</i>');
  return lines.join('\n');
}
