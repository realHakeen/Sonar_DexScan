import { CALL_MILESTONES } from '../config/constants.js';

/**
 * 倍数跨过了哪一档新里程碑。只返回本次新跨过的最高档（从 1.8x 直接跳到 5.2x 报 5x，不补 2x / 3x）；
 * 没有新档返回 undefined。lastMilestone 是已播过的最高档。
 */
export function crossedMilestone(multiple: number, lastMilestone: number, milestones: readonly number[] = CALL_MILESTONES): number | undefined {
  let hit: number | undefined;
  for (const m of milestones) if (multiple >= m && m > lastMilestone) hit = m;
  return hit;
}

/** call 距今的时长："now" / "12m" / "3h 20m" / "37d 1h"。 */
export function formatCallAge(calledAt: number, now = Date.now()): string {
  const ms = Math.max(0, now - calledAt);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** 倍数显示：[10.5x]，小于 10 保留一位小数，大于等于 100 取整。 */
export function formatMultiple(x: number): string {
  if (!Number.isFinite(x) || x <= 0) return '—';
  return x >= 100 ? `${Math.round(x)}x` : `${x.toFixed(1)}x`;
}

/**
 * 超级群消息链接：chat id 形如 -100xxxxxxxxxx，去掉 -100 前缀即内部 id。普通群没有消息链接。
 */
export function messageLink(chatId: number, messageId: number | undefined): string | undefined {
  if (messageId === undefined) return undefined;
  const s = String(chatId);
  if (!s.startsWith('-100')) return undefined;
  return `https://t.me/c/${s.slice(4)}/${messageId}`;
}

export function userLink(username: string | undefined): string | undefined {
  return username ? `https://t.me/${username}` : undefined;
}
