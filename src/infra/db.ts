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
  `CREATE TABLE IF NOT EXISTS calls (
     chat_id INTEGER NOT NULL,
     network_slug TEXT NOT NULL,
     address TEXT NOT NULL,
     symbol TEXT NOT NULL,
     user_id INTEGER NOT NULL,
     username TEXT,
     display_name TEXT NOT NULL,
     message_id INTEGER,
     called_at INTEGER NOT NULL,
     mcap_usd REAL NOT NULL,
     mcap_kind TEXT NOT NULL,
     peak_mcap_usd REAL NOT NULL,
     peak_at INTEGER NOT NULL,
     last_milestone REAL NOT NULL DEFAULT 0,
     PRIMARY KEY (chat_id, network_slug, address)
   )`,
  `CREATE INDEX IF NOT EXISTS calls_chat ON calls(chat_id, called_at)`,
  `CREATE TABLE IF NOT EXISTS shares (
     id TEXT PRIMARY KEY,
     owner_id INTEGER NOT NULL,
     owner_name TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     day INTEGER NOT NULL,
     user_id INTEGER,
     chat_id INTEGER,
     chat_type TEXT,
     kind TEXT NOT NULL,
     trigger TEXT,
     token TEXT,
     elapsed_ms INTEGER,
     degraded INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS events_day ON events(day)`,
  `CREATE INDEX IF NOT EXISTS events_user ON events(user_id, ts)`,
  `CREATE INDEX IF NOT EXISTS events_kind ON events(kind, ts)`,
  `CREATE TABLE IF NOT EXISTS groups (
     chat_id INTEGER PRIMARY KEY,
     title TEXT,
     added_at INTEGER NOT NULL,
     removed_at INTEGER,
     added_by INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS credits (
     day INTEGER PRIMARY KEY,
     used INTEGER NOT NULL DEFAULT 0
   )`,
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
