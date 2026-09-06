import { Markup } from 'telegraf';
import type { InlineKeyboardButton, InlineKeyboardMarkup } from 'telegraf/types';
import { chainRegistry } from '../domain/chains.js';
import type { TokenReport } from '../domain/types.js';
import type { ScoredCandidate } from '../domain/ranking.js';
import { encodeCallback } from '../bot/callbackData.js';
import { formatUsd } from './format.js';

/** 扫描卡片下方的按钮：刷新 + 切链 + 外链。 */
export function scanCardKeyboard(report: TokenReport, portfolioEnabled = true): Markup.Markup<InlineKeyboardMarkup> {
  const p = report.primary;
  const rows: InlineKeyboardButton[][] = [];

  const first: InlineKeyboardButton[] = [
    Markup.button.callback('🔄 Refresh', encodeCallback({ action: 'refresh', networkSlug: p.networkSlug, address: p.address })),
    Markup.button.url('📈 Trade', chainRegistry.dexscanUrl(p.networkSlug, p.address)),
  ];
  // 有合约数据的币给一个展开按钮，原地切到 /perp 视图；带代币定位，视图里的 Back 用它回来
  if (report.perp && p.cmcId) {
    first.push(Markup.button.callback('⚡ Perps', encodeCallback({ action: 'perp', networkSlug: p.networkSlug, address: p.address, symbol: p.symbol })));
  }
  rows.push(first);
  if (portfolioEnabled) {
    rows.push([Markup.button.callback('⭐ Watchlist', encodeCallback({ action: 'port_add', networkSlug: p.networkSlug, address: p.address, symbol: p.symbol }))]);
  }

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

/** 分享按钮：Telegram 原生选聊天面板，选中后以用户名义在那个聊天里发 `@bot watchlist`，由 inline 处理器渲染只读版。 */
export const WATCHLIST_INLINE_QUERY = 'watchlist';

/**
 * /watchlist 列表：一行放两个代币（🔍 SYMBOL · 🗑 · 🔍 SYMBOL · 🗑），省一半高度；末行 Refresh + Share。
 */
export function portfolioKeyboard(
  entries: Array<{ networkSlug: string; address: string; symbol: string }>,
): Markup.Markup<InlineKeyboardMarkup> {
  const pair = (e: { networkSlug: string; address: string; symbol: string }): InlineKeyboardButton[] => [
    Markup.button.callback(`🔍 ${e.symbol}`, encodeCallback({ action: 'port_scan', networkSlug: e.networkSlug, address: e.address, symbol: e.symbol })),
    Markup.button.callback('🗑', encodeCallback({ action: 'port_del', networkSlug: e.networkSlug, address: e.address, symbol: e.symbol })),
  ];
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < entries.length; i += 2) {
    rows.push([...pair(entries[i]!), ...(entries[i + 1] ? pair(entries[i + 1]!) : [])]);
  }
  rows.push([
    Markup.button.callback('🔄 Refresh', encodeCallback({ action: 'port_refresh' })),
    {
      text: '📤 Share',
      switch_inline_query_chosen_chat: { query: WATCHLIST_INLINE_QUERY, allow_user_chats: true, allow_group_chats: true, allow_channel_chats: true, allow_bot_chats: false },
    },
  ]);
  return Markup.inlineKeyboard(rows);
}

/**
 * 分享出去的只读版下面的两个增长入口（inline 消息里没有聊天上下文，回调按钮不能用，只能是链接）：
 * - 🤖 Open in Sonar：深链 start=wl_<id>，对方一点就 /start 了 bot 并在私聊拿到可交互版；
 * - ➕ Add Sonar to group：startgroup，把 bot 拉进对方所在的群。
 */
export function watchlistShareKeyboard(botUsername: string, shareId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        Markup.button.url('🤖 Open in Sonar', `https://t.me/${botUsername}?start=wl_${shareId}`),
        Markup.button.url('➕ Add Sonar to group', `https://t.me/${botUsername}?startgroup=true`),
      ],
    ],
  };
}

/** 通过深链进来看到的别人 watchlist：每币一个 🔍 扫描按钮（一行两个），末行一键复制。 */
export function sharedWatchlistKeyboard(entries: Array<{ networkSlug: string; address: string; symbol: string }>, shareId: string): Markup.Markup<InlineKeyboardMarkup> {
  const buttons = entries.map((e) => Markup.button.callback(`🔍 ${e.symbol}`, encodeCallback({ action: 'port_scan', networkSlug: e.networkSlug, address: e.address, symbol: e.symbol })));
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push([Markup.button.callback('⭐ Add all to my watchlist', encodeCallback({ action: 'port_copy', address: shareId }))]);
  return Markup.inlineKeyboard(rows);
}
