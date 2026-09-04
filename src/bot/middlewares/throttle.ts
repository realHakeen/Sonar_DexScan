import { env } from '../../config/env.js';
import { RateLimiter } from '../../infra/rateLimiter.js';
import { isGroup, rateLimitKey, type BotContext } from '../context.js';

const limiter = new RateLimiter(60_000);
setInterval(() => limiter.sweep(), 60_000).unref();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * PRD F4：群内必须有频率限制，避免刷屏。
 *
 * 只在「确认要扫描」时调用，闲聊不占额度 —— 否则活跃群里一句闲聊开启的冷却会把紧随其后的地址吞掉。
 * 群聊的冷却是排队而不是丢弃：三个人接连贴地址，三张卡按冷却间隔依次出，窗口内槽位用完才静默丢弃。
 * 私聊无冷却，超限提示等待秒数。按钮回调不经过这里：用户已经看到卡片，点刷新应当即时响应。
 *
 * @returns true 表示已拿到槽位（必要的等待已完成），false 表示被限流，调用方直接返回。
 */
export async function admitScan(ctx: BotContext): Promise<boolean> {
  const group = isGroup(ctx);
  const key = rateLimitKey(ctx);
  const r = limiter.reserve(
    key,
    group ? env.RATE_LIMIT_GROUP_PER_MIN : env.RATE_LIMIT_PRIVATE_PER_MIN,
    group ? env.RATE_LIMIT_GROUP_COOLDOWN_MS : 0,
  );

  if (r.delayMs === undefined) {
    ctx.log.debug('rate limited', { key, retryAfterMs: r.retryAfterMs });
    // 群里静默丢弃，否则限流提示本身就是刷屏
    if (!group) {
      await ctx.reply(`🚦 Too many requests. Please wait ${Math.ceil(r.retryAfterMs / 1000)}s and try again.`);
    }
    return false;
  }

  if (r.delayMs > 0) {
    ctx.log.debug('scan queued', { key, delayMs: r.delayMs });
    await sleep(r.delayMs);
  }
  return true;
}
