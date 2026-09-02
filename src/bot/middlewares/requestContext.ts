import { randomBytes } from 'node:crypto';
import type { MiddlewareFn } from 'telegraf';
import { createLogger } from '../../infra/logger.js';
import type { Services } from '../../services/index.js';
import type { BotContext } from '../context.js';

const base = createLogger('bot');

/** 把 services 与带 reqId 的 logger 注入 ctx。必须是第一个中间件。 */
export function requestContext(services: Services): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    ctx.services = services;
    ctx.reqId = randomBytes(4).toString('hex');
    ctx.log = {
      ...base,
      debug: (m, e) => base.debug(m, { reqId: ctx.reqId, ...(e as object) }),
      info: (m, e) => base.info(m, { reqId: ctx.reqId, ...(e as object) }),
      warn: (m, e) => base.warn(m, { reqId: ctx.reqId, ...(e as object) }),
      error: (m, e) => base.error(m, { reqId: ctx.reqId, ...(e as object) }),
    };
    return next();
  };
}
