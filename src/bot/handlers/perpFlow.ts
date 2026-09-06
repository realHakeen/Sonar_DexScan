import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import { InvalidInputError, NotFoundError, toUserMessage } from '../../infra/errors.js';
import { escapeHtml } from '../../render/format.js';
import { renderPerpCandidates, renderPerpCard } from '../../render/perpCard.js';
import { encodeCallback } from '../callbackData.js';
import type { BotContext } from '../context.js';

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };
const PERP_PLACEHOLDER = '⏳ Loading perps…';

/** 从扫描卡进入时的代币定位；有它才能画「◀ Back to report」。 */
export interface PerpOrigin {
  networkSlug?: string;
  address: string;
  symbol?: string;
}

export interface PerpFlowInput {
  /** 命令参数：symbol / 名称 / 地址。 */
  query?: string;
  /** 按钮回调已解析出的 cid。 */
  cmcId?: number;
  /** 从扫描卡进入：按合约地址解析 cid（索引命中 0 credit），并保留 Back。 */
  origin?: PerpOrigin;
}

export interface PerpFlowOptions {
  /** 原地编辑这条消息；不传则回复一条新消息（/perp 命令）。 */
  editMessageId?: number;
  /** 原地编辑时的即时反馈：keep 保留正文只换按钮（文案见 busyButton）；replace 整条换成占位文案。 */
  busyMode?: 'keep' | 'replace';
  /** keep 模式下按钮上的文字，默认「⏳ Refreshing…」。 */
  busyButton?: string;
  /** 统计：command / button / refresh / pick。 */
  trigger?: string;
  /** 占位文案里的上下文，如 "PEPE"。 */
  busyLabel?: string;
}

/** 进行中的 perp 请求，key = chatId:messageId。 */
const inflight = new Set<string>();

export function isPerpInflight(chatId: number, messageId: number): boolean {
  return inflight.has(`${chatId}:${messageId}`);
}

/**
 * /perp 链路：即时反馈 → 解析 cid（歧义时给候选按钮）→ 三路并发 → 编辑成视图。
 * 扫描卡上的 Perps detail 原地切换到这个视图，Back 按钮回卡片（scanFlow.restoreCard）。
 */
export async function runPerpFlow(ctx: BotContext, input: PerpFlowInput, opts: PerpFlowOptions = {}): Promise<void> {
  const chatId = ctx.chat!.id;
  let messageId = opts.editMessageId;
  const key = messageId !== undefined ? `${chatId}:${messageId}` : undefined;
  if (key && inflight.has(key)) return;
  if (key) inflight.add(key);

  try {
    // 先给用户看得见的反馈，再去取数
    if (messageId !== undefined) {
      await showBusy(ctx, messageId, opts).catch(() => undefined);
    } else {
      const sent = await ctx.reply(PERP_PLACEHOLDER, ctx.message ? { reply_parameters: { message_id: ctx.message.message_id } } : {});
      messageId = sent.message_id;
    }
    const edit = (text: string, keyboard?: Markup.Markup<InlineKeyboardMarkup>) =>
      ctx.telegram.editMessageText(chatId, messageId!, undefined, text, { ...HTML, ...(keyboard ?? {}) });

    try {
      let cmcId = input.cmcId;
      let fallback: { symbol: string; name: string } | undefined;
      if (cmcId === undefined) {
        const query = input.origin?.address ?? input.query ?? '';
        const res = await ctx.services.perp.resolve(query);
        if (res.kind === 'none') throw new NotFoundError(query);
        if (res.kind === 'ambiguous') {
          await edit(renderPerpCandidates(res.query, res.candidates), perpCandidateKeyboard(res.candidates));
          return;
        }
        cmcId = res.cmcId;
        fallback = { symbol: res.symbol, name: res.name };
      }
      const view = await ctx.services.perp.view(cmcId, fallback);
      await edit(renderPerpCard(view), perpKeyboard(cmcId, view.symbol, input.origin));
      ctx.services.stats?.record({ kind: 'perp', userId: ctx.from?.id, chatId, chatType: ctx.chat?.type, trigger: opts.trigger ?? 'command', token: view.symbol });
    } catch (err) {
      // 出错也要能回到卡片
      await edit(toUserMessage(err), input.origin ? backOnlyKeyboard(input.origin) : undefined).catch(() => undefined);
      if (!(err instanceof InvalidInputError)) throw err;
    }
  } finally {
    if (key) inflight.delete(key);
  }
}

async function showBusy(ctx: BotContext, messageId: number, opts: PerpFlowOptions): Promise<void> {
  const chatId = ctx.chat!.id;
  if (opts.busyMode === 'keep') {
    await ctx.telegram.editMessageReplyMarkup(chatId, messageId, undefined, {
      inline_keyboard: [[Markup.button.callback(opts.busyButton ?? '⏳ Refreshing…', encodeCallback({ action: 'noop' }))]],
    });
    return;
  }
  const text = opts.busyLabel ? `⏳ Loading ${escapeHtml(opts.busyLabel)} perps…` : PERP_PLACEHOLDER;
  await ctx.telegram.editMessageText(chatId, messageId, undefined, text, { ...HTML, reply_markup: { inline_keyboard: [] } });
}

/**
 * 视图按钮：Refresh（+ Back）。
 * 从卡片进来的，Refresh 也带代币定位而不是 cid，这样刷新后 Back 仍然在；cid 在点击时由索引免费解析。
 */
function perpKeyboard(cmcId: number, symbol: string, origin?: PerpOrigin): Markup.Markup<InlineKeyboardMarkup> {
  const refresh = Markup.button.callback(
    '🔄 Refresh',
    origin
      ? encodeCallback({ action: 'perp_refresh', networkSlug: origin.networkSlug, address: origin.address, symbol })
      : encodeCallback({ action: 'perp_refresh', address: String(cmcId), symbol }),
  );
  return Markup.inlineKeyboard([origin ? [refresh, backButton(origin)] : [refresh]]);
}

function backOnlyKeyboard(origin: PerpOrigin): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([[backButton(origin)]]);
}

function backButton(origin: PerpOrigin) {
  return Markup.button.callback('◀ Back to report', encodeCallback({ action: 'back', networkSlug: origin.networkSlug, address: origin.address, symbol: origin.symbol }));
}

function perpCandidateKeyboard(hits: Array<{ cmcId: number; symbol: string; name: string; rank?: number }>): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard(
    hits.map((h) => [
      Markup.button.callback(
        `${h.symbol} · ${h.name}${h.rank ? ` · #${h.rank}` : ''}`,
        encodeCallback({ action: 'perp_pick', address: String(h.cmcId), symbol: h.symbol }),
      ),
    ]),
  );
}
