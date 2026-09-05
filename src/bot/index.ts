import { Telegraf } from 'telegraf';
import { env } from '../config/env.js';
import { createLogger } from '../infra/logger.js';
import { chainRegistry } from '../domain/chains.js';
import { createServices, type Services } from '../services/index.js';
import type { BotContext } from './context.js';
import { requestContext } from './middlewares/requestContext.js';
import { errorBoundary } from './middlewares/errorBoundary.js';
import { commandHandlers } from './handlers/commands.js';
import { callbackHandlers } from './handlers/callbacks.js';
import { messageHandlers } from './handlers/message.js';

const log = createLogger('bot');

const COMMANDS = [
  { command: 's', description: 'Scan a token (address / name / link)' },
  { command: 'perp', description: 'Perps: OI, funding, liquidations by venue' },
  { command: 'portfolio', description: 'Your starred tokens' },
  { command: 'help', description: 'How to use' },
  { command: 'start', description: 'Start' },
];

export interface BuiltBot {
  bot: Telegraf<BotContext>;
  services: Services;
}

/**
 * 组装 bot。中间件顺序是有意义的：
 * requestContext（注入依赖）→ errorBoundary（兜住后续所有异常）→ handlers。
 * 限流不是全局中间件：只在 handler 确认要扫描时调用 admitScan，闲聊不占额度。
 */
export function buildBot(services: Services = createServices()): BuiltBot {
  const bot = new Telegraf<BotContext>(env.TELEGRAM_BOT_TOKEN, {
    handlerTimeout: 30_000,
  });

  bot.use(requestContext(services));
  bot.use(errorBoundary);

  bot.use(callbackHandlers);
  bot.use(commandHandlers);
  bot.use(messageHandlers);

  return { bot, services };
}

/** 启动前的一次性准备：拉真实链列表校准 slug，注册命令菜单。 */
export async function warmup(built: BuiltBot): Promise<void> {
  // 本地 CMC 收录索引：后台加载，不阻塞启动
  built.services.startIndexRefresh();

  const [networks] = await Promise.allSettled([
    built.services.cmc.dex.networks(),
    built.bot.telegram.setMyCommands(COMMANDS).catch((err) => {
      log.warn('setMyCommands failed', { err: String(err) });
    }),
  ]);

  if (networks.status === 'fulfilled' && networks.value.length > 0) {
    const added = chainRegistry.calibrate(networks.value);
    log.info('chain registry calibrated', { upstream: networks.value.length, added });
  } else {
    log.warn('could not fetch network list, using built-in registry');
  }
}
