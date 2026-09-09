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
  // 带币层的卡片：按钮带上币的 cid，重扫 / 切链后仍是 NEAR Protocol 而不是 WNEAR
  const native = p.coin?.cmcId;

  const first: InlineKeyboardButton[] = [
    Markup.button.callback('🔄 Refresh', encodeCallback({ action: 'refresh', networkSlug: p.networkSlug, address: p.address, native })),
    Markup.button.url('📈 Trade', chainRegistry.dexscanUrl(p.networkSlug, p.address)),
  ];
  // 有合约数据的币给一个展开按钮，原地切到 /perp 视图；带代币定位，视图里的 Back 用它回来
  if (report.perp && p.cmcId) {
    first.push(Markup.button.callback('⚡ Perps', encodeCallback({ action: 'perp', networkSlug: p.networkSlug, address: p.address, symbol: p.symbol, native })));
  }
  rows.push(first);
  if (portfolioEnabled) {
    rows.push([Markup.button.callback('⭐ Watchlist', encodeCallback({ action: 'port_add', networkSlug: p.networkSlug, address: p.address, symbol: p.symbol, native }))]);
  }

  // PRD F1 第 5 步：提供 inline button 供用户切链
  if (report.secondaryDeployments.length > 0) {
    const chainRow = report.secondaryDeployments.slice(0, 3).map((d) =>
      // 部署 symbol 与卡片不同时标出来（TAO 卡切到 Solana 的 TAO / WTAO 卡切到 Solana 的 TAO）
      Markup.button.callback(
        `Switch to ${chainRegistry.displayName(d.networkSlug)}${d.symbol.toUpperCase() !== p.symbol.toUpperCase() ? ` (${d.symbol})` : ''}`,
        encodeCallback({ action: 'chain', networkSlug: d.networkSlug, address: d.address, symbol: d.symbol, native }),
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
      `${c.officialVerified ? '✅ ' : ''}${c.coin ? `${c.coin.symbol} (${c.symbol})` : c.symbol} · ${chainRegistry.displayName(c.networkSlug)} · ${formatUsd(c.liquidityUsd)}`,
      encodeCallback({ action: 'scan', networkSlug: c.networkSlug, address: c.address, symbol: c.symbol, native: c.coin?.cmcId }),
    ),
  ]);
  return Markup.inlineKeyboard(rows);
}

/** 分享按钮：Telegram 原生选聊天面板，选中后以用户名义在那个聊天里发 `@bot watchlist`，由 inline 处理器渲染只读版。 */
export const WATCHLIST_INLINE_QUERY = 'watchlist';

/** 翻页行：◀ 页码 ▶。只有一页时不出。 */
function pageRow(page: number, pages: number, target: (p: number) => string): InlineKeyboardButton[] | undefined {
  if (pages <= 1) return undefined;
  return [
    Markup.button.callback('◀', page > 1 ? target(page - 1) : encodeCallback({ action: 'noop' })),
    Markup.button.callback(`${page}/${pages}`, encodeCallback({ action: 'noop' })),
    Markup.button.callback('▶', page < pages ? target(page + 1) : encodeCallback({ action: 'noop' })),
  ];
}

/**
 * /watchlist 列表（当页）。一行两个币，按钮才有半行宽（一行四个时 symbol 会被截成 "...CK"）：
 * - 普通模式：`🔍 SYMBOL` 扫描；多页时加翻页行；末行 Refresh · Remove · Share。
 * - 删除模式（点 Remove 进入）：同样位置变成 `🗑 SYMBOL`，点一个删一个可以连删；末行只有 Done 回普通模式。
 * 所有回调带当前页码，操作完留在这一页。
 */
export function portfolioKeyboard(
  entries: Array<{ networkSlug: string; address: string; symbol: string }>,
  page = 1,
  pages = 1,
  mode: 'scan' | 'remove' = 'scan',
): Markup.Markup<InlineKeyboardMarkup> {
  const button = (e: { networkSlug: string; address: string; symbol: string }): InlineKeyboardButton =>
    mode === 'remove'
      ? Markup.button.callback(`🗑 ${e.symbol}`, encodeCallback({ action: 'port_rm', networkSlug: e.networkSlug, address: e.address, symbol: e.symbol, page }))
      : Markup.button.callback(`🔍 ${e.symbol}`, encodeCallback({ action: 'port_scan', networkSlug: e.networkSlug, address: e.address, symbol: e.symbol }));
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < entries.length; i += 2) rows.push(entries.slice(i, i + 2).map(button));
  if (mode === 'remove') {
    rows.push([Markup.button.callback('✅ Done', encodeCallback({ action: 'port_page', page }))]);
    return Markup.inlineKeyboard(rows);
  }
  const nav = pageRow(page, pages, (p) => encodeCallback({ action: 'port_page', page: p }));
  if (nav) rows.push(nav);
  rows.push([
    Markup.button.callback('🔄 Refresh', encodeCallback({ action: 'port_refresh', page })),
    Markup.button.callback('🗑 Remove', encodeCallback({ action: 'port_edit', page })),
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

/** 通过深链进来看到的别人 watchlist（当页）：每币一个 🔍 扫描按钮（一行两个），多页时加翻页行，末行一键复制（复制的是全部）。 */
export function sharedWatchlistKeyboard(
  entries: Array<{ networkSlug: string; address: string; symbol: string }>,
  shareId: string,
  page = 1,
  pages = 1,
): Markup.Markup<InlineKeyboardMarkup> {
  const buttons = entries.map((e) => Markup.button.callback(`🔍 ${e.symbol}`, encodeCallback({ action: 'port_scan', networkSlug: e.networkSlug, address: e.address, symbol: e.symbol })));
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  const nav = pageRow(page, pages, (p) => encodeCallback({ action: 'port_spage', address: shareId, page: p }));
  if (nav) rows.push(nav);
  rows.push([Markup.button.callback('⭐ Add all to my watchlist', encodeCallback({ action: 'port_copy', address: shareId }))]);
  return Markup.inlineKeyboard(rows);
}
