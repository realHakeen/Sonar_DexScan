import { toUserMessage } from '../../infra/errors.js';
import { renderPortfolio } from '../../render/portfolio.js';
import { portfolioKeyboard } from '../../render/keyboards.js';
import { chainRegistry } from '../../domain/chains.js';
import { isGroup, type BotContext } from '../context.js';
import { cachedSnapshot, runScanFlow } from './scanFlow.js';

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };
const UNAVAILABLE = '⭐ Portfolio is unavailable right now (storage not configured).';

/** 群里点 ⭐ 的人是谁，就进谁的 portfolio。 */
function userIdOf(ctx: BotContext): number | undefined {
  return ctx.from?.id;
}

/**
 * ⭐ Add to Portfolio：优先用卡片渲染缓存里的快照（价格 / 市值 / cid，10 分钟内有效），
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
      await ctx.answerCbQuery(`${loc.symbol ?? 'Token'} is already in your portfolio · /portfolio`);
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
  const toast =
    result === 'added'
      ? `⭐ Added ${snap.symbol} to your portfolio · /portfolio`
      : result === 'exists'
        ? `${snap.symbol} is already in your portfolio · /portfolio`
        : `Portfolio is full (${svc.size(userId)} tokens). Remove one in /portfolio first.`;
  await ctx.answerCbQuery(toast, { show_alert: result === 'full' });
}

/** /portfolio：群里发到私聊（列表是个人的），私聊直接回。 */
export async function sendPortfolio(ctx: BotContext): Promise<void> {
  const svc = ctx.services.portfolio;
  const userId = userIdOf(ctx);
  if (!svc || userId === undefined) {
    await ctx.reply(UNAVAILABLE);
    return;
  }
  const rows = await svc.listWithQuotes(userId);
  const text = renderPortfolio(rows);
  const keyboard = rows.length ? portfolioKeyboard(rows.map((r) => r.entry)) : undefined;
  if (isGroup(ctx)) {
    try {
      await ctx.telegram.sendMessage(userId, text, { ...HTML, ...(keyboard ?? {}) });
      await ctx.reply('⭐ Sent your portfolio in private.', { reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined });
    } catch {
      await ctx.reply(`⭐ Open a private chat with @${ctx.botInfo?.username ?? 'the bot'} and send /start first, then /portfolio works here.`);
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
    await runScanFlow(ctx, { kind: 'address', address: loc.address, chainSlug: loc.networkSlug, source: 'raw' });
    return;
  }
  if (action === 'port_del') {
    if (!loc.address || !loc.networkSlug) {
      await ctx.answerCbQuery('Incomplete button data.');
      return;
    }
    const removed = svc.remove(userId, loc.networkSlug, loc.address);
    await ctx.answerCbQuery(removed ? `Removed ${loc.symbol ?? ''}`.trim() : 'Not in your portfolio');
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
