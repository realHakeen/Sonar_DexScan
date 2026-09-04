import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { hasEnoughCandles, renderChartSvg, sanitizeCandles } from '../src/render/chart.js';
import type { Candle } from '../src/domain/types.js';

const mk = (i: number, o: number, h: number, l: number, c: number, v = 1000): Candle => ({ open: o, high: h, low: l, close: c, volumeUsd: v, ts: 1_700_000_000_000 + i * 3_600_000 });

test('sanitizeCandles：丢弃 open/close 为 0 的坏根，钳住离群的 low/high', () => {
  const out = sanitizeCandles([mk(0, 10, 11, 9, 10), mk(1, 10, 11, 0, 10), mk(2, 0, 0, 0, 0), mk(3, 10, 9999, 9, 10)]);
  assert.equal(out.length, 3);
  assert.equal(out[1]?.low, 10, 'low=0 被钳到实体');
  assert.equal(out[2]?.high, 10, 'high 离群 50× 被钳到实体');
});

test('renderChartSvg：输出合法 SVG，含 ATH 标注与最新价', () => {
  const candles = Array.from({ length: 24 }, (_, i) => mk(i, 100 + i, 105 + i, 95 + i, 101 + i, 500 + i * 10));
  const svg = renderChartSvg({ symbol: 'TEST', chainName: 'BNB Chain', mode: 'm', intervalLabel: '1h · 24h', candles });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(svg.includes('ATH '));
  assert.ok(svg.includes('TEST'));
  assert.ok(svg.includes('BNB Chain'));
  assert.equal((svg.match(/<rect/g) ?? []).length >= 24 * 2, true, '每根蜡烛有实体 + 成交量两个矩形');
});

test('hasEnoughCandles', () => {
  assert.equal(hasEnoughCandles([]), false);
  assert.equal(hasEnoughCandles(Array.from({ length: 4 }, (_, i) => mk(i, 1, 1, 1, 1))), true);
});
