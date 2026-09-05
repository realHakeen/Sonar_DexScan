import { createCmcGateway, type CmcGateway } from '../api/cmc/index.js';
import { COIN_INDEX_REFRESH_MS } from '../config/constants.js';
import { env } from '../config/env.js';
import { openDatabase } from '../infra/db.js';
import { createLogger } from '../infra/logger.js';
import { CoinIndex } from '../domain/coinIndex.js';
import { ChartService } from './chartService.js';
import { PerpService } from './perpService.js';
import { PortfolioService } from './portfolioService.js';
import { ScanService } from './scanService.js';
import { SearchService } from './searchService.js';

export { ScanService } from './scanService.js';
export { SearchService } from './searchService.js';
export type { ScanOptions } from './scanService.js';

const log = createLogger('services');

export interface Services {
  cmc: CmcGateway;
  index: CoinIndex;
  chart: ChartService;
  scan: ScanService;
  search: SearchService;
  perp: PerpService;
  /** 数据库打不开时为 undefined，portfolio 相关入口提示暂不可用。 */
  portfolio?: PortfolioService;
  /** 拉全量 map 建索引。0 credits；失败不影响其它功能，只是名称搜索少一条通路。 */
  refreshIndex(): Promise<void>;
  /** 启动后台定时刷新（unref，不阻塞退出）。 */
  startIndexRefresh(): void;
}

/** 组合根：所有服务在这里装配，handler 只依赖这个接口。 */
export function createServices(cmc: CmcGateway = createCmcGateway()): Services {
  const index = new CoinIndex();
  let timer: NodeJS.Timeout | undefined;
  const db = openDatabase(env.DATA_DIR);

  const refreshIndex = async () => {
    const started = Date.now();
    try {
      const entries = await cmc.core.fullMap();
      index.load(entries);
      log.info('coin index loaded', { entries: index.size, elapsed: Date.now() - started });
    } catch (err) {
      log.warn('coin index refresh failed', { err: String(err) });
    }
  };

  return {
    cmc,
    index,
    chart: new ChartService(cmc),
    scan: new ScanService(cmc, index),
    search: new SearchService(cmc, index),
    perp: new PerpService(cmc, index),
    portfolio: db ? new PortfolioService(db, cmc) : undefined,
    refreshIndex,
    startIndexRefresh() {
      if (timer) return;
      void refreshIndex();
      timer = setInterval(() => void refreshIndex(), COIN_INDEX_REFRESH_MS);
      timer.unref();
    },
  };
}
