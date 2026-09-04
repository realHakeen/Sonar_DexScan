import { Composer } from 'telegraf';
import { message } from 'telegraf/filters';
import type { Message, MessageEntity } from 'telegraf/types';
import { parseMessage } from '../../domain/inputParser.js';
import { looksLikeAddress } from '../../domain/detectChain.js';
import { isGroup, type BotContext } from '../context.js';
import { runScanFlow } from './scanFlow.js';

export const messageHandlers = new Composer<BotContext>();

/**
 * 消息正文：text 消息取 text，photo / video / document 等媒体消息取 caption。
 * 播报频道（Birdshot / TokenScan 转发）几乎都是带 caption 的图片消息，只听 text 会全部漏掉。
 */
function messageBody(msg: Message): { text: string; entities?: MessageEntity[] } | undefined {
  if ('text' in msg && typeof msg.text === 'string') return { text: msg.text, entities: msg.entities };
  if ('caption' in msg && typeof msg.caption === 'string') return { text: msg.caption, entities: msg.caption_entities };
  return undefined;
}

/**
 * PRD F4 群组模式：任意成员发合约地址 / 名称自动触发扫描 —— 获客的核心机制。
 * 但群里不能见字就查，否则聊天全被卡片淹没，所以群内只对
 * 「明确的地址 / 链接」或「@bot 显式触发」响应。
 */
const handleMessage = async (ctx: BotContext, next: () => Promise<void>): Promise<void> => {
  const body = ctx.message ? messageBody(ctx.message) : undefined;
  if (!body) return next();
  const text = body.text;
  if (text.startsWith('/')) return next();

  const mentioned = isMentioningBot(ctx, text);
  const cleaned = mentioned ? stripMention(ctx, text) : text;
  const parsed = parseMessage(cleaned, body.entities);

  if (parsed.kind === 'none') return next();

  if (isGroup(ctx) && !mentioned) {
    // 群里裸名称不触发（"这个 pepe 不错" 不该查询）；地址、链接、$TICKER 才算明确意图
    const isExplicit =
      (parsed.kind === 'address' && (parsed.source === 'link' || looksLikeAddress(parsed.address))) ||
      (parsed.kind === 'query' && parsed.explicit === true);
    if (!isExplicit) return next();
  }

  ctx.log.info('scan triggered', { kind: parsed.kind, chat: ctx.chat?.type, mentioned, viaCaption: !('text' in ctx.message!) });
  await runScanFlow(ctx, parsed);
};

messageHandlers.on(message('text'), handleMessage);
messageHandlers.on(message('caption'), handleMessage);

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
