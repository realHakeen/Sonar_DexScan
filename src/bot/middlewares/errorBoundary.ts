import type { MiddlewareFn } from 'telegraf';
import { AppError, toUserMessage } from '../../infra/errors.js';
import type { BotContext } from '../context.js';

/**
 * 兜底错误边界。任何 handler 抛错都在这里转成用户可读文案，
 * 保证 bot 进程不会因为单条消息挂掉。
 */
export const errorBoundary: MiddlewareFn<BotContext> = async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    const expected = err instanceof AppError;
    ctx.log[expected ? 'warn' : 'error']('handler error', {
      err: expected ? err.message : String(err),
      stack: expected ? undefined : (err as Error)?.stack,
    });

    const text = toUserMessage(err);
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery(text.slice(0, 200), { show_alert: true });
      } else {
        await ctx.reply(text);
      }
    } catch (replyErr) {
      ctx.log.error('failed to send error reply', { err: String(replyErr) });
    }
  }
};
