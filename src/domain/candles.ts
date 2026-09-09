import type { Candle } from './types.js';

const HOUR = 3600e3;

/**
 * 链上 24h 成交量变化：最近 24 根 1h 蜡烛的成交量之和 / 前 24 根之和 − 1（百分比）。
 * DEX token 接口没有这个字段（sts 只有价格变化，主 API 的 volume_change_24h 是全市场口径），
 * 蜡烛的 24h 合计与 token 接口的 24h 成交量误差在 0.3% 内（2026-09-09 用 PEPE / CATE / AGI 实测）。
 * 前一窗口不足 20 根（新币）或成交为 0 时返回 undefined。
 */
export function volumeChange24hPct(candles: Candle[], now = Date.now()): number | undefined {
  const last = candles.filter((c) => c.ts > now - 24 * HOUR && c.ts <= now);
  const prev = candles.filter((c) => c.ts > now - 48 * HOUR && c.ts <= now - 24 * HOUR);
  if (last.length < 20 || prev.length < 20) return undefined;
  const sum = (a: Candle[]) => a.reduce((s, c) => s + (Number.isFinite(c.volumeUsd) ? c.volumeUsd : 0), 0);
  const p = sum(prev);
  if (p <= 0) return undefined;
  return (sum(last) / p - 1) * 100;
}
