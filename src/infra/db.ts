import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLogger } from './logger.js';

const log = createLogger('db');

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS portfolio (
     user_id INTEGER NOT NULL,
     network_slug TEXT NOT NULL,
     address TEXT NOT NULL,
     symbol TEXT NOT NULL,
     name TEXT,
     cmc_id INTEGER,
     added_at INTEGER NOT NULL,
     added_price_usd REAL,
     added_mcap_usd REAL,
     PRIMARY KEY (user_id, network_slug, address)
   )`,
  `CREATE INDEX IF NOT EXISTS portfolio_user ON portfolio(user_id, added_at)`,
];

/**
 * 进程内 SQLite（Node 内置 node:sqlite，无原生依赖）。单实例 bot 够用；
 * 文件放在 DATA_DIR 下，Railway 上把 Volume 挂到 /data 即可跨部署保留。
 * 打不开（目录不可写、只读文件系统）返回 undefined，调用方把依赖它的功能降级，绝不影响扫描主链路。
 */
export function openDatabase(dir: string, file = 'sonar.db'): DatabaseSync | undefined {
  try {
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(join(dir, file));
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 3000');
    for (const sql of MIGRATIONS) db.exec(sql);
    log.info('database ready', { path: join(dir, file) });
    return db;
  } catch (err) {
    log.warn('database unavailable, persistence features disabled', { dir, err: String(err) });
    return undefined;
  }
}

/** 测试用：内存库。 */
export function openMemoryDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const sql of MIGRATIONS) db.exec(sql);
  return db;
}
