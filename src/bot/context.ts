import type { Context } from 'telegraf';
import type { Services } from '../services/index.js';
import type { Logger } from '../infra/logger.js';

/** 注入到每个 handler 的上下文，避免 handler 直接 import 单例。 */
export interface BotContext extends Context {
  services: Services;
  log: Logger;
  /** 请求追踪 id，日志串联用。 */
  reqId: string;
}

export function isGroup(ctx: BotContext): boolean {
  const type = ctx.chat?.type;
  return type === 'group' || type === 'supergroup';
}

/** 限流 key：私聊按用户，群聊按群 —— 群里刷屏是群的问题，不是某个人的。 */
export function rateLimitKey(ctx: BotContext): string {
  if (isGroup(ctx)) return `chat:${ctx.chat?.id}`;
  return `user:${ctx.from?.id ?? 'anon'}`;
}
