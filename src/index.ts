import { installEnvProxy } from './infra/proxy.js';
installEnvProxy();

import { env, isWebhookMode } from './config/env.js';
import { createLogger } from './infra/logger.js';
import { startHttpServer } from './infra/httpServer.js';
import { buildBot, warmup } from './bot/index.js';

const log = createLogger('main');

async function main(): Promise<void> {
  const built = buildBot();
  await warmup(built);

  const shutdown = (signal: string) => {
    log.info('Shutdown signal received, stopping', { signal });
    built.bot.stop(signal);
    // 给正在处理的请求一点时间收尾
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', { reason: String(reason) });
  });

  if (isWebhookMode) {
    await built.bot.launch({
      webhook: {
        domain: env.TELEGRAM_WEBHOOK_DOMAIN,
        path: env.TELEGRAM_WEBHOOK_PATH,
        port: env.PORT,
      },
    });
    log.info('Bot started (webhook)', {
      domain: env.TELEGRAM_WEBHOOK_DOMAIN,
      path: env.TELEGRAM_WEBHOOK_PATH,
      port: env.PORT,
    });
  } else {
    // launch() 在 polling 模式下不会 resolve，所以不 await
    void built.bot.launch(() => log.info('Bot started (long polling)'));

    // 平台（Railway 等）注入了 PORT 就顺带提供 /health，供 healthcheck 与监控使用
    if (process.env['PORT']) {
      const startedAt = Date.now();
      startHttpServer(env.PORT, {
        health: () => ({
          ok: true,
          uptimeSec: Math.round((Date.now() - startedAt) / 1000),
          indexEntries: built.services.index.size,
          indexAgeSec: built.services.index.isLoaded ? Math.round(built.services.index.ageMs / 1000) : null,
          chartsEnabled: built.services.chart.enabled,
        }),
        chart: (slug, address) => built.services.chart.render(slug, address),
      });
      if (!built.services.chart.enabled) {
        log.warn('charts disabled: set PUBLIC_BASE_URL (or expose the Railway service) to show K-line previews');
      }
    }
  }
}

main().catch((err) => {
  log.error('Startup failed', { err: String(err), stack: (err as Error)?.stack });
  process.exit(1);
});
