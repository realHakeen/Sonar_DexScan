import { toUserMessage } from '../../infra/errors.js';
import { renderPortfolio } from '../../render/portfolio.js';
import { portfolioKeyboard, sharedWatchlistKeyboard } from '../../render/keyboards.js';
import { renderWatchlistShare } from '../../render/portfolio.js';
import { chainRegistry } from '../../domain/chains.js';
import { isGroup, type BotContext } from '../context.js';
import { cachedSnapshot, runScanFlow } from './scanFlow.js';

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };
const UNAVAILABLE = '⭐ Watchlist is unavailable right now (storage not configured).';

/** 群里点 ⭐ 的人是谁，就进谁的 watchlist。（内部命名仍叫 portfolio，用户可见文案统一为 Watchlist） */
function userIdOf(ctx: BotContext): number | undefined {
  return ctx.from?.id;
}

/**
 * ⭐ Watchlist 按钮：优先用卡片渲染缓存里的快照（价格 / 市值 / cid，10 分钟内有效），
 * 缓存过期就重新拉一次 token 详情（1 credit）。只回 toast，不改消息 —— 群里的按钮是大家共用的，不能反映某个人的状态。
 */
export async function handlePortfolioAdd(ctx: BotContext, loc: { networkSlug?: string; address: string; symbol?: string }, messageId?: number): Promise<void> {
  const svc = ctx.services.portfolio;
  const userId = userIdOf(ctx);
  if (!svc || userId === undefined) {
    await ctx.answerCbQuery(UNAVAILABLE, { show_alert: true });
    return;
  }
  const chatId = ctx.chat?.id;
  let snap = chatId !== undefined && messageId !== undefined ? cachedSnapshot(chatId, messageId) : undefined;
  if (!snap || snap.address.toLowerCase() !== loc.address.toLowerCase()) {
    const slug = loc.networkSlug;
    if (!slug) {
      await ctx.answerCbQuery('Could not identify this token. Please rescan and try again.', { show_alert: true });
      return;
    }
    if (svc.has(userId, slug, loc.address)) {
      await ctx.answerCbQuery(`${loc.symbol ?? 'Token'} is already on your watchlist · /watchlist`);
      return;
    }
    const detail = await ctx.services.cmc.dex
      .tokenDetail({ platform: chainRegistry.platformName(slug), address: loc.address, networkSlug: slug })
      .catch(() => null);
    const c = detail?.candidate;
    snap = {
      cmcId: c?.cmcId,
      symbol: c?.symbol ?? loc.symbol ?? loc.address.slice(0, 6),
      name: c?.name ?? loc.symbol ?? '',
      networkSlug: slug,
      address: loc.address,
      priceUsd: c?.priceUsd,
      marketCapUsd: c?.listingMarketCapUsd ?? c?.fdvUsd,
    };
  }

  const result = svc.add({
    userId,
    networkSlug: snap.networkSlug,
    address: snap.address,
    symbol: snap.symbol,
    name: snap.name,
    cmcId: snap.cmcId,
    addedPriceUsd: snap.priceUsd,
    addedMcapUsd: snap.marketCapUsd,
  });
  ctx.log.info('portfolio add', { userId, symbol: snap.symbol, result });
  if (result === 'added') ctx.services.stats?.record({ kind: 'watch_add', userId, chatId: ctx.chat?.id, chatType: ctx.chat?.type, token: `${snap.networkSlug}:${snap.symbol}` });
  const toast =
    result === 'added'
      ? `⭐ Added ${snap.symbol} to your watchlist · /watchlist`
      : result === 'exists'
        ? `${snap.symbol} is already on your watchlist · /watchlist`
        : `Watchlist is full (${svc.size(userId)} tokens). Remove one in /watchlist first.`;
  await ctx.answerCbQuery(toast, { show_alert: result === 'full' });
}

/** /watchlist：群里发到私聊（列表是个人的），私聊直接回。 */
export async function sendPortfolio(ctx: BotContext): Promise<void> {
  const svc = ctx.services.portfolio;
  const userId = userIdOf(ctx);
  if (!svc || userId === undefined) {
    await ctx.reply(UNAVAILABLE);
    return;
  }
  const rows = await svc.listWithQuotes(userId);
  ctx.services.stats?.record({ kind: 'watch_view', userId, chatId: ctx.chat?.id, chatType: ctx.chat?.type });
  const text = renderPortfolio(rows);
  const keyboard = rows.length ? portfolioKeyboard(rows.map((r) => r.entry)) : undefined;
  if (isGroup(ctx)) {
    try {
      await ctx.telegram.sendMessage(userId, text, { ...HTML, ...(keyboard ?? {}) });
      await ctx.reply('⭐ Sent your watchlist in private.', { reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined });
    } catch {
      await ctx.reply(`⭐ Open a private chat with @${ctx.botInfo?.username ?? 'the bot'} and send /start first, then /watchlist works here.`);
    }
    return;
  }
  await ctx.reply(text, { ...HTML, ...(keyboard ?? {}) });
}

/** 列表内的按钮：🗑 移除 / 🔄 刷新 → 原地重绘；🔍 → 新消息出卡片。 */
export async function handlePortfolioCallback(
  ctx: BotContext,
  action: 'port_del' | 'port_scan' | 'port_refresh',
  loc: { networkSlug?: string; address?: string; symbol?: string },
  messageId?: number,
): Promise<void> {
  const svc = ctx.services.portfolio;
  const userId = userIdOf(ctx);
  if (!svc || userId === undefined) {
    await ctx.answerCbQuery(UNAVAILABLE, { show_alert: true });
    return;
  }
  if (action === 'port_scan') {
    if (!loc.address) {
      await ctx.answerCbQuery('Incomplete button data.');
      return;
    }
    await ctx.answerCbQuery('Scanning…');
    await runScanFlow(ctx, { kind: 'address', address: loc.address, chainSlug: loc.networkSlug, source: 'raw' }, { trigger: 'watchlist' });
    return;
  }
  if (action === 'port_del') {
    if (!loc.address || !loc.networkSlug) {
      await ctx.answerCbQuery('Incomplete button data.');
      return;
    }
    const removed = svc.remove(userId, loc.networkSlug, loc.address);
    if (removed) ctx.services.stats?.record({ kind: 'watch_del', userId, chatId: ctx.chat?.id, chatType: ctx.chat?.type });
    await ctx.answerCbQuery(removed ? `Removed ${loc.symbol ?? ''}`.trim() : 'Not on your watchlist');
  } else {
    await ctx.answerCbQuery('Refreshing…');
  }
  if (messageId === undefined || ctx.chat === undefined) return;
  try {
    const rows = await svc.listWithQuotes(userId);
    await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, renderPortfolio(rows), {
      ...HTML,
      ...(rows.length ? portfolioKeyboard(rows.map((r) => r.entry)) : { reply_markup: { inline_keyboard: [] } }),
    });
  } catch (err) {
    // 内容没变时 Telegram 会报 "message is not modified"，忽略
    if (!/not modified/i.test(String(err))) {
      await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, toUserMessage(err)).catch(() => undefined);
      throw err;
    }
  }
}

/** 深链 /start wl_<id>：把分享者的 watchlist 以可交互版发给新来的用户。 */
export async function openSharedWatchlist(ctx: BotContext, shareId: string): Promise<boolean> {
  const svc = ctx.services.portfolio;
  if (!svc) return false;
  const share = svc.resolveShare(shareId);
  if (!share) {
    await ctx.reply('⭐ This watchlist link has expired (links last 7 days). Ask the owner to share it again.');
    return true;
  }
  const rows = await svc.listWithQuotes(share.ownerId);
  if (rows.length === 0) {
    await ctx.reply(`⭐ ${share.ownerName}'s watchlist is empty now.`);
    return true;
  }
  ctx.log.info('shared watchlist opened', { shareId, ownerId: share.ownerId, viewer: ctx.from?.id });
  ctx.services.stats?.record({ kind: 'share_open', userId: ctx.from?.id, chatId: ctx.chat?.id, chatType: ctx.chat?.type });
  await ctx.reply(renderWatchlistShare(share.ownerName, rows), { ...HTML, ...sharedWatchlistKeyboard(rows.map((r) => r.entry), shareId) });
  return true;
}

/** ⭐ Add all to my watchlist：复制分享者的列表，加入价用当前行情。 */
export async function handlePortfolioCopy(ctx: BotContext, shareId: string): Promise<void> {
  const svc = ctx.services.portfolio;
  const userId = userIdOf(ctx);
  if (!svc || userId === undefined) {
    await ctx.answerCbQuery(UNAVAILABLE, { show_alert: true });
    return;
  }
  const share = svc.resolveShare(shareId);
  if (!share) {
    await ctx.answerCbQuery('This share link has expired.', { show_alert: true });
    return;
  }
  if (share.ownerId === userId) {
    await ctx.answerCbQuery('This is already your watchlist.');
    return;
  }
  const rows = await svc.listWithQuotes(share.ownerId);
  const prices = new Map(rows.map((r) => [`${r.entry.networkSlug}:${r.entry.address.toLowerCase()}`, { priceUsd: r.priceUsd, marketCapUsd: r.marketCapUsd }]));
  const res = svc.copyFrom(share.ownerId, userId, prices);
  ctx.log.info('watchlist copied', { shareId, viewer: userId, ...res });
  ctx.services.stats?.record({ kind: 'share_copy', userId, chatId: ctx.chat?.id, chatType: ctx.chat?.type });
  const parts = [`⭐ Added ${res.added}`];
  if (res.skipped) parts.push(`${res.skipped} already there`);
  if (res.full) parts.push(`${res.full} skipped (limit ${svc.size(userId)})`);
  await ctx.answerCbQuery(`${parts.join(' · ')} · /watchlist`, { show_alert: res.full > 0 });
}
