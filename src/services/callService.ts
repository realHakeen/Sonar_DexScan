import type { DatabaseSync } from 'node:sqlite';
import { crossedMilestone, messageLink } from '../domain/calls.js';
import type { CallSummary } from '../domain/types.js';
import { createLogger } from '../infra/logger.js';

const log = createLogger('calls');

export interface CallToken {
  networkSlug: string;
  address: string;
  symbol: string;
}

export interface Caller {
  userId: number;
  username?: string;
  displayName: string;
}

export interface TrackInput {
  chatId: number;
  token: CallToken;
  /** 本次扫描拿到的市值与口径。 */
  mcapUsd: number;
  mcapKind: 'mc' | 'fdv';
  /** 能创建首次 call 时提供（消息触发的群内扫描）；按钮回调只更新、不创建。 */
  caller?: Caller;
  messageId?: number;
  now?: number;
}

export interface TrackResult {
  summary: CallSummary;
  /** 本次新跨过的里程碑（2 / 3 / 5 / 10…），需要播报。 */
  milestone?: number;
  /** 回复目标：原 call 消息。 */
  callMessageId?: number;
  callerUsername?: string;
}

interface Row {
  chat_id: number;
  network_slug: string;
  address: string;
  symbol: string;
  user_id: number;
  username: string | null;
  display_name: string;
  message_id: number | null;
  called_at: number;
  mcap_usd: number;
  mcap_kind: 'mc' | 'fdv';
  peak_mcap_usd: number;
  peak_at: number;
  last_milestone: number;
}

/**
 * 群内首次 call 记录（PRD F3e）：谁第一个在这个群里触发了某个币的卡片，就记下当时市值；
 * 之后每次扫描算倍数、更新峰值，跨过新里程碑就通知调用方发横幅。零额外 credit —— 全部用扫描已拿到的数据。
 */
export class CallService {
  constructor(private readonly db: DatabaseSync) {}

  get(chatId: number, networkSlug: string, address: string): Row | undefined {
    return this.db
      .prepare('SELECT * FROM calls WHERE chat_id = ? AND network_slug = ? AND address = ?')
      .get(chatId, networkSlug, address.toLowerCase()) as unknown as Row | undefined;
  }

  track(input: TrackInput): TrackResult | undefined {
    const now = input.now ?? Date.now();
    const address = input.token.address.toLowerCase();
    let row = this.get(input.chatId, input.token.networkSlug, address);

    if (!row) {
      if (!input.caller || !(input.mcapUsd > 0)) return undefined;
      this.db
        .prepare(
          `INSERT INTO calls (chat_id, network_slug, address, symbol, user_id, username, display_name, message_id, called_at, mcap_usd, mcap_kind, peak_mcap_usd, peak_at, last_milestone)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        )
        .run(
          input.chatId,
          input.token.networkSlug,
          address,
          input.token.symbol,
          input.caller.userId,
          input.caller.username ?? null,
          input.caller.displayName,
          input.messageId ?? null,
          now,
          input.mcapUsd,
          input.mcapKind,
          input.mcapUsd,
          now,
        );
      row = this.get(input.chatId, input.token.networkSlug, address)!;
      log.info('call recorded', { chatId: input.chatId, symbol: input.token.symbol, mcap: input.mcapUsd, by: input.caller.displayName });
      return { summary: this.summary(row, 1, true), callMessageId: row.message_id ?? undefined, callerUsername: row.username ?? undefined };
    }

    // 口径不一致时不比（真实市值 vs FDV 差得远），只显示记录不算倍数
    const comparable = input.mcapKind === row.mcap_kind && input.mcapUsd > 0 && row.mcap_usd > 0;
    const multiple = comparable ? input.mcapUsd / row.mcap_usd : Number.NaN;
    let milestone: number | undefined;
    if (comparable) {
      if (input.mcapUsd > row.peak_mcap_usd) {
        row.peak_mcap_usd = input.mcapUsd;
        row.peak_at = now;
      }
      milestone = crossedMilestone(multiple, row.last_milestone);
      if (milestone !== undefined) row.last_milestone = milestone;
      this.db
        .prepare('UPDATE calls SET peak_mcap_usd = ?, peak_at = ?, last_milestone = ? WHERE chat_id = ? AND network_slug = ? AND address = ?')
        .run(row.peak_mcap_usd, row.peak_at, row.last_milestone, row.chat_id, row.network_slug, row.address);
      if (milestone !== undefined) log.info('call milestone', { chatId: input.chatId, symbol: row.symbol, milestone, multiple: multiple.toFixed(2) });
    }
    return { summary: this.summary(row, multiple, false), milestone, callMessageId: row.message_id ?? undefined, callerUsername: row.username ?? undefined };
  }

  private summary(row: Row, multiple: number, isNew: boolean): CallSummary {
    return {
      displayName: row.display_name,
      username: row.username ?? undefined,
      messageUrl: messageLink(row.chat_id, row.message_id ?? undefined),
      calledAt: row.called_at,
      mcapUsd: row.mcap_usd,
      mcapKind: row.mcap_kind,
      multiple,
      peakMultiple: row.mcap_usd > 0 ? row.peak_mcap_usd / row.mcap_usd : Number.NaN,
      isNew,
    };
  }
}
