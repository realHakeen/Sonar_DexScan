import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { volumeChange24hPct } from '../src/domain/candles.js';
import type { Candle } from '../src/domain/types.js';

const H = 3600e3;
const NOW = 1_700_000_000_000;
const bars = (vols: number[], endTs = NOW): Candle[] => vols.map((v, i) => ({ open: 1, high: 1, low: 1, close: 1, volumeUsd: v, ts: endTs - (vols.length - 1 - i) * H }));

test('最近 24 根对前 24 根：+29.03%', () => {
  const prev = Array(24).fill(1000);
  const last = Array(24).fill(1290.3);
  const v = volumeChange24hPct(bars([...Array(120).fill(5), ...prev, ...last]), NOW);
  assert.ok(Math.abs(v! - 29.03) < 1e-6);
});

test('新币前一窗口不足 20 根、或前 24h 成交为 0 时不给数', () => {
  assert.equal(volumeChange24hPct(bars(Array(30).fill(100)), NOW), undefined);
  assert.equal(volumeChange24hPct(bars([...Array(24).fill(0), ...Array(24).fill(100)]), NOW), undefined);
  assert.equal(volumeChange24hPct([], NOW), undefined);
});

test('未来时间戳的蜡烛不计入', () => {
  const c = bars([...Array(24).fill(100), ...Array(24).fill(200)], NOW);
  c.push({ open: 1, high: 1, low: 1, close: 1, volumeUsd: 1e9, ts: NOW + H });
  assert.ok(Math.abs(volumeChange24hPct(c, NOW)! - 100) < 1e-9);
});
