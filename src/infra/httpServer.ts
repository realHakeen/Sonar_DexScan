import { createServer, type Server } from 'node:http';
import { createLogger } from './logger.js';

const log = createLogger('http');

export interface HealthSnapshot {
  ok: boolean;
  uptimeSec: number;
  indexEntries: number;
  indexAgeSec: number | null;
  chartsEnabled: boolean;
}

export interface HttpHandlers {
  health: () => HealthSnapshot;
  /** 返回 PNG 或 null（404）。 */
  chart?: (networkSlug: string, address: string) => Promise<Buffer | null>;
}

const CHART_RE = /^\/chart\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._:-]+)\.png$/;

/**
 * 极简 HTTP 服务：/health 给平台健康检查，/chart/{chain}/{address}.png 给 Telegram 抓预览图。
 * 只在注入了 PORT 且非 webhook 模式时启动（webhook 模式下端口归 Telegraf）。
 */
export function startHttpServer(port: number, handlers: HttpHandlers): Server {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/health' || url.pathname === '/') {
      const body = handlers.health();
      res.writeHead(body.ok ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }

    const m = CHART_RE.exec(url.pathname);
    if (m && handlers.chart) {
      try {
        const png = await handlers.chart(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!));
        if (!png) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': png.length,
          'Cache-Control': 'public, max-age=300',
        });
        res.end(png);
      } catch (err) {
        log.warn('chart route failed', { path: url.pathname, err: String(err) });
        res.writeHead(500).end();
      }
      return;
    }

    res.writeHead(404).end();
  });
  server.listen(port, () => log.info('http server listening', { port, chart: Boolean(handlers.chart) }));
  return server;
}
