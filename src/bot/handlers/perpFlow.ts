import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import { PLACEHOLDER_TEXT } from '../../config/constants.js';
import { InvalidInputError, NotFoundError, toUserMessage } from '../../infra/errors.js';
import { renderPerpCandidates, renderPerpCard } from '../../render/perpCard.js';
import { encodeCallback } from '../callbackData.js';
import type { BotContext } from '../context.js';

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

export interface PerpFlowInput {
  /** 命令参数：symbol / 名称 / 地址。 */
  query?: string;
  /** 按钮回调已解析出的 cid。 */
  cmcId?: number;
}

/**
 * /perp 链路：占位 → 解析 cid（歧义时给候选按钮）→ 三路并发 → 编辑成视图。
 * 与扫描卡分开，因为它不需要链和合约地址，也不出 K 线。
 */
export async function runPerpFlow(ctx: BotContext, input: PerpFlowInput, editMessageId?: number): Promise<void> {
  const chatId = ctx.chat!.id;
  const messageId =
    editMessageId ??
    (await ctx.reply(PLACEHOLDER_TEXT, { reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined })).message_id;
  const edit = (text: string, keyboard?: Markup.Markup<InlineKeyboardMarkup>) =>
    ctx.telegram.editMessageText(chatId, messageId, undefined, text, { ...HTML, ...(keyboard ?? {}) });

  try {
    let cmcId = input.cmcId;
    let fallback: { symbol: string; name: string } | undefined;
    if (cmcId === undefined) {
      const res = await ctx.services.perp.resolve(input.query ?? '');
      if (res.kind === 'none') throw new NotFoundError(input.query ?? '');
      if (res.kind === 'ambiguous') {
        await edit(renderPerpCandidates(res.query, res.candidates), perpCandidateKeyboard(res.candidates));
        return;
      }
      cmcId = res.cmcId;
      fallback = { symbol: res.symbol, name: res.name };
    }
    const view = await ctx.services.perp.view(cmcId, fallback);
    await edit(renderPerpCard(view), perpKeyboard(cmcId, view.symbol));
  } catch (err) {
    await edit(toUserMessage(err)).catch(() => undefined);
    if (!(err instanceof InvalidInputError)) throw err;
  }
}

function perpKeyboard(cmcId: number, symbol: string): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh', encodeCallback({ action: 'perp', address: String(cmcId), symbol }))]]);
}

function perpCandidateKeyboard(hits: Array<{ cmcId: number; symbol: string; name: string; rank?: number }>): Markup.Markup<InlineKeyboardMarkup> {
  return Markup.inlineKeyboard(
    hits.map((h) => [
      Markup.button.callback(
        `${h.symbol} · ${h.name}${h.rank ? ` · #${h.rank}` : ''}`,
        encodeCallback({ action: 'perp', address: String(h.cmcId), symbol: h.symbol }),
      ),
    ]),
  );
}
