import { Markup } from 'telegraf';
import type { InlineKeyboardButton, InlineKeyboardMarkup } from 'telegraf/types';
import { chainRegistry } from '../domain/chains.js';
import type { TokenReport } from '../domain/types.js';
import type { ScoredCandidate } from '../domain/ranking.js';
import { encodeCallback } from '../bot/callbackData.js';
import { formatUsd } from './format.js';

/** 扫描卡片下方的按钮：刷新 + 切链 + 外链。 */
export function scanCardKeyboard(report: TokenReport): Markup.Markup<InlineKeyboardMarkup> {
  const p = report.primary;
  const rows: InlineKeyboardButton[][] = [];

  rows.push([
    Markup.button.callback(
      '🔄 Refresh',
      encodeCallback({ action: 'refresh', networkSlug: p.networkSlug, address: p.address }),
    ),
    Markup.button.url('📈 Trade on DexScan', chainRegistry.dexscanUrl(p.networkSlug, p.address)),
  ]);

  // PRD F1 第 5 步：提供 inline button 供用户切链
  if (report.secondaryDeployments.length > 0) {
    const chainRow = report.secondaryDeployments.slice(0, 3).map((d) =>
      Markup.button.callback(
        `Switch to ${chainRegistry.displayName(d.networkSlug)}`,
        encodeCallback({ action: 'chain', networkSlug: d.networkSlug, address: d.address, symbol: d.symbol }),
      ),
    );
    rows.push(chainRow);
  }

  return Markup.inlineKeyboard(rows);
}

/** PRD F2：重名消歧的候选按钮，标注链名 + 流动性。 */
export function candidateKeyboard(
  candidates: ScoredCandidate[],
): Markup.Markup<InlineKeyboardMarkup> {
  const rows = candidates.map(({ candidate: c }) => [
    Markup.button.callback(
      `${c.officialVerified ? '✅ ' : ''}${c.symbol} · ${chainRegistry.displayName(c.networkSlug)} · ${formatUsd(c.liquidityUsd)}`,
      encodeCallback({ action: 'scan', networkSlug: c.networkSlug, address: c.address, symbol: c.symbol }),
    ),
  ]);
  return Markup.inlineKeyboard(rows);
}
