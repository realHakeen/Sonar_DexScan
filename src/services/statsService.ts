import type { DatabaseSync } from 'node:sqlite';
import { creditMeter } from '../infra/creditMeter.js';
import { createLogger } from '../infra/logger.js';

const log = createLogger('stats');
const DAY_MS = 86_400_000;

/** 事件类型：scan 是出卡；其余是功能使用。 */
export type EventKind =
  | 'scan'
  | 'perp'
  | 'watch_add'
  | 'watch_del'
  | 'watch_view'
  | 'share'
  | 'share_open'
  | 'share_copy'
  | 'ratelimited';

export interface StatsEvent {
  kind: EventKind;
  userId?: number;
  chatId?: number;
  chatType?: string;
  /** 触发方式：address / link / cashtag / name / forward / command / refresh / candidate / chain / back / watchlist / button */
  trigger?: string;
  /** 代币标识 "chain:symbol"。 */
  token?: string;
  elapsedMs?: number;
  degraded?: boolean;
  ts?: number;
}

export interface StatsWindow {
  users: number;
  groups: number;
  newUsers: number;
  newGroups: number;
  scans: number;
  triggers: Record<string, number>;
  watchAdds: number;
  shares: number;
  shareOpens: number;
  shareCopies: number;
  perpCommands: number;
  perpButtons: number;
  avgElapsedMs?: number;
  degradedRate?: number;
  rateLimited: number;
  credits: number;
}

export interface StatsSnapshot {
  generatedAt: number;
  today: StatsWindow;
  d7: StatsWindow;
  d30: StatsWindow;
  /** bot 当前所在的群数。 */
  groupsTotal: number;
  /** 昨天首次出现的用户里今天又来的比例（0–1）；样本 < 5 为 undefined。 */
  retentionD1?: number;
  retentionD7?: number;
  /** 最近 30 天每日：活跃用户、扫描数（含今天，按 UTC 日）。 */
  daily: Array<{ day: number; users: number; scans: number }>;
  topTokens: Array<{ token: string; scans: number }>;
  topGroups: Array<{ chatId: number; title?: string; scans: number }>;
}

const dayOf = (ts: number) => Math.floor(ts / DAY_MS);

/**
 * 使用统计：一张 events 表记所有交互，一张 groups 表记 bot 进出群，一张 credits 表按日累加 CMC 用量。
 * 不存消息正文，只存 id。全部本地 SQLite，零 credit。
 */
export class StatsService {
  private readonly unsubscribe: () => void;

  constructor(private readonly db: DatabaseSync) {
    this.unsubscribe = creditMeter.subscribe((n) => this.addCredits(n));
  }

  close(): void {
    this.unsubscribe();
  }

  record(e: StatsEvent): void {
    const ts = e.ts ?? Date.now();
    try {
      this.db
        .prepare('INSERT INTO events (ts, day, user_id, chat_id, chat_type, kind, trigger, token, elapsed_ms, degraded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(ts, dayOf(ts), e.userId ?? null, e.chatId ?? null, e.chatType ?? null, e.kind, e.trigger ?? null, e.token ?? null, e.elapsedMs ?? null, e.degraded === undefined ? null : e.degraded ? 1 : 0);
    } catch (err) {
      log.warn('event insert failed', { kind: e.kind, err: String(err) });
    }
  }

  /** bot 被拉进群 / 被踢出群。 */
  groupChange(chatId: number, status: 'added' | 'removed', info: { title?: string; by?: number; ts?: number } = {}): void {
    const ts = info.ts ?? Date.now();
    try {
      if (status === 'added') {
        this.db
          .prepare('INSERT INTO groups (chat_id, title, added_at, removed_at, added_by) VALUES (?, ?, ?, NULL, ?) ON CONFLICT(chat_id) DO UPDATE SET title = excluded.title, removed_at = NULL, added_at = CASE WHEN groups.removed_at IS NULL THEN groups.added_at ELSE excluded.added_at END')
          .run(chatId, info.title ?? null, ts, info.by ?? null);
      } else {
        this.db.prepare('UPDATE groups SET removed_at = ? WHERE chat_id = ?').run(ts, chatId);
      }
    } catch (err) {
      log.warn('group change failed', { chatId, status, err: String(err) });
    }
  }

  private addCredits(n: number, now = Date.now()): void {
    try {
      this.db.prepare('INSERT INTO credits (day, used) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET used = used + excluded.used').run(dayOf(now), Math.round(n));
    } catch (err) {
      log.warn('credit meter write failed', { err: String(err) });
    }
  }

  snapshot(now = Date.now()): StatsSnapshot {
    const today = dayOf(now);
    const win = (days: number): StatsWindow => this.window(today - days + 1, now);
    const groupsTotal = Number((this.db.prepare('SELECT COUNT(*) AS n FROM groups WHERE removed_at IS NULL').get() as { n: number }).n);
    return {
      generatedAt: now,
      today: win(1),
      d7: win(7),
      d30: win(30),
      groupsTotal,
      retentionD1: this.retention(today - 1, today),
      retentionD7: this.retention(today - 7, today),
      daily: this.daily(today - 29, today),
      topTokens: this.topTokens(today - 6, 10),
      topGroups: this.topGroups(today - 6, 10),
    };
  }

  private window(fromDay: number, now: number): StatsWindow {
    const q = <T>(sql: string, ...args: unknown[]) => this.db.prepare(sql).get(...(args as never[])) as T;
    const users = q<{ n: number }>('SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE day >= ? AND user_id IS NOT NULL', fromDay).n;
    const groups = q<{ n: number }>("SELECT COUNT(DISTINCT chat_id) AS n FROM events WHERE day >= ? AND chat_type IN ('group','supergroup')", fromDay).n;
    const newUsers = q<{ n: number }>('SELECT COUNT(*) AS n FROM (SELECT user_id, MIN(day) AS d FROM events WHERE user_id IS NOT NULL GROUP BY user_id) WHERE d >= ?', fromDay).n;
    const newGroups = q<{ n: number }>('SELECT COUNT(*) AS n FROM groups WHERE added_at >= ?', fromDay * DAY_MS).n;
    const scans = q<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE day >= ? AND kind = 'scan'", fromDay).n;
    const triggers: Record<string, number> = {};
    for (const r of this.db.prepare("SELECT trigger, COUNT(*) AS n FROM events WHERE day >= ? AND kind = 'scan' GROUP BY trigger").all(fromDay) as Array<{ trigger: string | null; n: number }>) {
      triggers[r.trigger ?? 'other'] = Number(r.n);
    }
    const count = (kind: string, trigger?: string) =>
      Number(
        (trigger
          ? q<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE day >= ? AND kind = ? AND trigger = ?', fromDay, kind, trigger)
          : q<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE day >= ? AND kind = ?', fromDay, kind)
        ).n,
      );
    const perf = q<{ avg: number | null; deg: number | null; n: number }>("SELECT AVG(elapsed_ms) AS avg, AVG(degraded) AS deg, COUNT(*) AS n FROM events WHERE day >= ? AND kind = 'scan' AND elapsed_ms IS NOT NULL", fromDay);
    const credits = q<{ n: number | null }>('SELECT SUM(used) AS n FROM credits WHERE day >= ?', fromDay).n ?? 0;
    return {
      users: Number(users),
      groups: Number(groups),
      newUsers: Number(newUsers),
      newGroups: Number(newGroups),
      scans: Number(scans),
      triggers,
      watchAdds: count('watch_add'),
      shares: count('share'),
      shareOpens: count('share_open'),
      shareCopies: count('share_copy'),
      perpCommands: count('perp', 'command'),
      perpButtons: count('perp', 'button'),
      avgElapsedMs: perf.n > 0 && perf.avg !== null ? Math.round(Number(perf.avg)) : undefined,
      degradedRate: perf.n > 0 && perf.deg !== null ? Number(perf.deg) : undefined,
      rateLimited: count('ratelimited'),
      credits: Number(credits),
    };
  }

  /** cohortDay 首次出现的用户里，activeDay 还活跃的比例。样本不足 5 人不算。 */
  private retention(cohortDay: number, activeDay: number): number | undefined {
    const cohort = (this.db.prepare('SELECT user_id FROM (SELECT user_id, MIN(day) AS d FROM events WHERE user_id IS NOT NULL GROUP BY user_id) WHERE d = ?').all(cohortDay) as Array<{ user_id: number }>).map((r) => r.user_id);
    if (cohort.length < 5) return undefined;
    const placeholders = cohort.map(() => '?').join(',');
    const back = Number((this.db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE day = ? AND user_id IN (${placeholders})`).get(activeDay, ...cohort) as { n: number }).n);
    return back / cohort.length;
  }

  private daily(fromDay: number, toDay: number): StatsSnapshot['daily'] {
    const rows = this.db
      .prepare("SELECT day, COUNT(DISTINCT user_id) AS users, SUM(CASE WHEN kind = 'scan' THEN 1 ELSE 0 END) AS scans FROM events WHERE day BETWEEN ? AND ? GROUP BY day")
      .all(fromDay, toDay) as Array<{ day: number; users: number; scans: number }>;
    const byDay = new Map(rows.map((r) => [Number(r.day), r]));
    const out: StatsSnapshot['daily'] = [];
    for (let d = fromDay; d <= toDay; d++) {
      const r = byDay.get(d);
      out.push({ day: d, users: Number(r?.users ?? 0), scans: Number(r?.scans ?? 0) });
    }
    return out;
  }

  private topTokens(fromDay: number, limit: number): StatsSnapshot['topTokens'] {
    return (this.db.prepare("SELECT token, COUNT(*) AS scans FROM events WHERE day >= ? AND kind = 'scan' AND token IS NOT NULL GROUP BY token ORDER BY scans DESC LIMIT ?").all(fromDay, limit) as Array<{ token: string; scans: number }>).map((r) => ({ token: r.token, scans: Number(r.scans) }));
  }

  private topGroups(fromDay: number, limit: number): StatsSnapshot['topGroups'] {
    return (
      this.db
        .prepare("SELECT e.chat_id AS chatId, g.title AS title, COUNT(*) AS scans FROM events e LEFT JOIN groups g ON g.chat_id = e.chat_id WHERE e.day >= ? AND e.kind = 'scan' AND e.chat_type IN ('group','supergroup') GROUP BY e.chat_id ORDER BY scans DESC LIMIT ?")
        .all(fromDay, limit) as Array<{ chatId: number; title: string | null; scans: number }>
    ).map((r) => ({ chatId: Number(r.chatId), title: r.title ?? undefined, scans: Number(r.scans) }));
  }
}
