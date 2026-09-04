import { createHash } from 'node:crypto';
import { env, publicBaseUrl } from '../config/env.js';
import type { CmcGateway, TokenLocator } from '../api/cmc/index.js';
import { TtlCache } from '../infra/cache.js';
import { createLogger } from '../infra/logger.js';
import { chainRegistry } from '../domain/chains.js';
import type { KlineInterval, TokenCandidate } from '../domain/types.js';
import { hasEnoughCandles, renderChartPng, sanitizeCandles } from '../render/chart.js';

const log = createLogger('chart');

interface ChartMeta {
  symbol: string;
  platform: string;
  fdvUsd?: number;
  priceUsd?: number;
  liquidityUsd?: number;
}

/**
 * 图表服务：给卡片提供一个公网 PNG 链接，Telegram 抓取时按需渲染。
 * - URL 里只放链 slug + 地址 + 5 分钟时间桶（让 Telegram 的预览缓存跟着失效）
 * - 元数据（symbol / FDV…）在扫描时登记，Telegram 回来抓图时直接用；进程重启后退回再查一次 token 接口
 */
export class ChartService {
  private readonly meta = new TtlCache<ChartMeta>(30 * 60 * 1000, 5000);
  private readonly png = new TtlCache<Buffer>(env.CACHE_TTL_CHART_MS, 500);

  constructor(private readonly cmc: CmcGateway) {}

  get enabled(): boolean {
    return Boolean(publicBaseUrl);
  }

  /** 扫描完成时调用：登记元数据并返回图片 URL（未配置公网地址时返回 undefined）。 */
  register(c: TokenCandidate): string | undefined {
    if (!publicBaseUrl) return undefined;
    this.meta.set(this.metaKey(c.networkSlug, c.address), {
      symbol: c.symbol,
      platform: c.platform ?? chainRegistry.platformName(c.networkSlug),
      fdvUsd: c.fdvUsd,
      priceUsd: c.priceUsd,
      liquidityUsd: c.liquidityUsd,
    });
    const bucket = Math.floor(Date.now() / env.CACHE_TTL_CHART_MS);
    return `${publicBaseUrl}/chart/${encodeURIComponent(c.networkSlug)}/${encodeURIComponent(c.address)}.png?v=${bucket}`;
  }

  /** 失败（上游抖动 / 数据不足）只缓存 30 秒，别让一次 5xx 把这个币的图封 5 分钟。 */
  private readonly failed = new TtlCache<true>(30_000, 500);

  /**
   * HTTP 路由调用：返回 PNG，画不出来返回 null（路由回 404，Telegram 静默不显示预览）。
   * 任何异常都在这里吞掉并记日志 —— 图是锦上添花，绝不能让卡片受影响。
   */
  async render(networkSlug: string, address: string, interval: KlineInterval = '1h'): Promise<Buffer | null> {
    const key = `${networkSlug}:${address.toLowerCase()}:${interval}`;
    if (this.failed.get(key)) return null;
    const cached = this.png.get(key);
    if (cached) return cached;

    try {
      const png = await this.build(networkSlug, address, interval);
      if (png) this.png.set(key, png);
      else this.failed.set(key, true);
      return png;
    } catch (err) {
      log.warn('chart build failed', { networkSlug, address, err: String(err) });
      this.failed.set(key, true);
      return null;
    }
  }

  private async build(networkSlug: string, address: string, interval: KlineInterval): Promise<Buffer | null> {
    const meta = await this.resolveMeta(networkSlug, address);
    if (!meta) return null;
    const loc: TokenLocator = { platform: meta.platform, address, networkSlug };

    let candles = sanitizeCandles(await this.cmc.dex.klineCandles(loc, { interval, limit: 168, pm: 'm' }));
    let label = '1h · 7d';
    if (!hasEnoughCandles(candles) && interval === '1h') {
      candles = sanitizeCandles(await this.cmc.dex.klineCandles(loc, { interval: '15min', limit: 96, pm: 'm' }));
      label = '15m · 24h';
    }
    if (!hasEnoughCandles(candles)) {
      log.debug('not enough candles', { networkSlug, address, n: candles.length });
      return null;
    }

    const started = Date.now();
    const png = renderChartPng({
      symbol: meta.symbol,
      chainName: chainRegistry.displayName(networkSlug),
      mode: 'm',
      intervalLabel: label,
      candles,
      fdvUsd: meta.fdvUsd,
      priceUsd: meta.priceUsd,
      liquidityUsd: meta.liquidityUsd,
    });
    log.debug('chart rendered', { networkSlug, address, candles: candles.length, bytes: png.length, elapsed: Date.now() - started });
    return png;
  }

  private metaKey(networkSlug: string, address: string): string {
    return createHash('sha1').update(`${networkSlug}:${address.toLowerCase()}`).digest('hex');
  }

  private async resolveMeta(networkSlug: string, address: string): Promise<ChartMeta | undefined> {
    const cached = this.meta.get(this.metaKey(networkSlug, address));
    if (cached) return cached;
    // 进程重启后 Telegram 可能还会来抓旧链接：补查一次
    const platform = chainRegistry.platformName(networkSlug);
    const detail = await this.cmc.dex.tokenDetail({ platform, address, networkSlug }).catch(() => null);
    if (!detail) return undefined;
    const c = detail.candidate;
    // 注意：token 接口返回的 plt 是长名（"BNB Smart Chain (BEP20)"），k-line 端点不认；
    // 这里必须用注册表的规范名（"BSC"），不能用 c.platform
    const meta: ChartMeta = { symbol: c.symbol, platform, fdvUsd: c.fdvUsd, priceUsd: c.priceUsd, liquidityUsd: c.liquidityUsd };
    this.meta.set(this.metaKey(networkSlug, address), meta);
    return meta;
  }
}
