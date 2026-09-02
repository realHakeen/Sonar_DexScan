import { Composer } from 'telegraf';
import { message } from 'telegraf/filters';
import { parseInput } from '../../domain/inputParser.js';
import { looksLikeAddress } from '../../domain/detectChain.js';
import { isGroup, type BotContext } from '../context.js';
import { runScanFlow } from './scanFlow.js';

export const messageHandlers = new Composer<BotContext>();

/**
 * PRD F4 群组模式：任意成员发合约地址 / 名称自动触发扫描 —— 获客的核心机制。
 * 但群里不能见字就查，否则聊天全被卡片淹没，所以群内只对
 * 「明确的地址 / 链接」或「@bot 显式触发」响应。
 */
messageHandlers.on(message('text'), async (ctx, next) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return next();

  const mentioned = isMentioningBot(ctx, text);
  const cleaned = mentioned ? stripMention(ctx, text) : text;
  const parsed = parseInput(cleaned);

  if (parsed.kind === 'none') return next();

  if (isGroup(ctx) && !mentioned) {
    // 群里裸名称不触发（"这个 pepe 不错" 不该查询），必须是地址或链接
    const isExplicit =
      parsed.kind === 'address' && (parsed.source === 'link' || looksLikeAddress(parsed.address));
    if (!isExplicit) return next();
  }

  ctx.log.info('scan triggered', { kind: parsed.kind, chat: ctx.chat?.type, mentioned });
  await runScanFlow(ctx, parsed);
});

function isMentioningBot(ctx: BotContext, text: string): boolean {
  const username = ctx.botInfo?.username;
  if (!username) return false;
  return text.toLowerCase().includes(`@${username.toLowerCase()}`);
}

function stripMention(ctx: BotContext, text: string): string {
  const username = ctx.botInfo?.username;
  if (!username) return text;
  return text.replace(new RegExp(`@${username}`, 'gi'), '').trim();
}
