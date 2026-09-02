import type { MiddlewareFn } from 'telegraf';
import { env } from '../../config/env.js';
import { RateLimiter } from '../../infra/rateLimiter.js';
import { isGroup, rateLimitKey, type BotContext } from '../context.js';

const limiter = new RateLimiter(60_000);
setInterval(() => limiter.sweep(), 60_000).unref();

/**
 * PRD F4：群内必须有频率限制，避免刷屏。
 * 群聊额外加冷却时间 —— 十个人同时贴地址时只响应第一个。
 */
export const throttle: MiddlewareFn<BotContext> = async (ctx, next) => {
  // 按钮回调不参与限流：用户已经看到卡片了，点刷新应当即时响应
  if (ctx.callbackQuery) return next();

  const group = isGroup(ctx);
  const waitMs = limiter.check(
    rateLimitKey(ctx),
    group ? env.RATE_LIMIT_GROUP_PER_MIN : env.RATE_LIMIT_PRIVATE_PER_MIN,
    group ? env.RATE_LIMIT_GROUP_COOLDOWN_MS : 0,
  );

  if (waitMs > 0) {
    ctx.log.debug('rate limited', { key: rateLimitKey(ctx), waitMs });
    // 群里静默丢弃，否则限流提示本身就是刷屏
    if (!group) {
      await ctx.reply(`🚦 Too many requests. Please wait ${Math.ceil(waitMs / 1000)}s and try again.`);
    }
    return;
  }

  return next();
};
