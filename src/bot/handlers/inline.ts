import { Composer } from 'telegraf';
import type { InlineQueryResultArticle } from 'telegraf/types';
import { renderWatchlistShare } from '../../render/portfolio.js';
import { WATCHLIST_INLINE_QUERY, watchlistShareKeyboard } from '../../render/keyboards.js';
import type { BotContext } from '../context.js';

export const inlineHandlers = new Composer<BotContext>();

/**
 * `@bot watchlist`：分享按钮选完聊天后由 Telegram 发起的 inline 查询。返回一条只读版 watchlist 文章，
 * 用户点选即以自己的名义发到那个聊天。需要在 @BotFather 用 /setinline 开启 inline 模式。
 * 其它查询词一律回空结果，不花 credit。
 */
inlineHandlers.on('inline_query', async (ctx) => {
  const query = ctx.inlineQuery.query.trim().toLowerCase();
  if (!query.startsWith(WATCHLIST_INLINE_QUERY)) {
    await ctx.answerInlineQuery([], { cache_time: 300, is_personal: true });
    return;
  }
  const svc = ctx.services.portfolio;
  const from = ctx.inlineQuery.from;
  const owner = from.username ? `@${from.username}` : [from.first_name, from.last_name].filter(Boolean).join(' ');
  if (!svc) {
    await ctx.answerInlineQuery([], { cache_time: 60, is_personal: true, button: { text: 'Watchlist is unavailable right now', start_parameter: 'watchlist' } });
    return;
  }
  const rows = await svc.listWithQuotes(from.id);
  if (rows.length === 0) {
    await ctx.answerInlineQuery([], { cache_time: 10, is_personal: true, button: { text: 'Your watchlist is empty — star a token first', start_parameter: 'watchlist' } });
    return;
  }
  // 每次分享一个新 id（7 天有效）；对方点 "Open in Sonar" 时用它取主人的列表
  const shareId = svc.createShare(from.id, owner);
  const article: InlineQueryResultArticle = {
    type: 'article',
    id: `wl-${shareId}`,
    title: `⭐ Share my watchlist (${rows.length} token${rows.length === 1 ? '' : 's'})`,
    description: rows.map((r) => r.entry.symbol).join(' · '),
    input_message_content: { message_text: renderWatchlistShare(owner, rows), parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
    reply_markup: watchlistShareKeyboard(ctx.botInfo?.username ?? 'sonar', shareId),
  };
  ctx.log.info('watchlist shared', { userId: from.id, tokens: rows.length });
  ctx.services.stats?.record({ kind: 'share', userId: from.id });
  // 行情走 15s 缓存；inline 结果按用户缓存 30s，连续点两次不重复取数
  await ctx.answerInlineQuery([article], { cache_time: 30, is_personal: true });
});
