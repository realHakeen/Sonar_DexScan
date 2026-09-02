import { createServer, type Server } from 'node:http';
import { createLogger } from './logger.js';

const log = createLogger('health');

export interface HealthSnapshot {
  ok: boolean;
  uptimeSec: number;
  indexEntries: number;
  indexAgeSec: number | null;
}

/**
 * 极简健康检查端点，给 Railway / 任何平台的 healthcheck 用。
 * 只在注入了 PORT 且非 webhook 模式时启动（webhook 模式下端口归 Telegraf）。
 */
export function startHealthServer(port: number, snapshot: () => HealthSnapshot): Server {
  const server = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      const body = snapshot();
      res.writeHead(body.ok ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, () => log.info('health endpoint listening', { port }));
  return server;
}
