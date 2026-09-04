import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { formatAge, formatPercent, formatPrice, formatUsd, formatUsdShort, pctShort, shortDex } from '../src/render/format.js';

test('极小价格用下标压缩写法，不会显示成 $0.00', () => {
  assert.equal(formatPrice(0.000000001234), '$0.0₈1234');
  assert.equal(formatPrice(1234.5678), '$1,234.5678');
  assert.equal(formatPrice(undefined), '—');
});

test('大额金额按 K/M/B 压缩', () => {
  assert.equal(formatUsd(1_234_000_000), '$1.23B');
  assert.equal(formatUsd(45_600_000), '$45.60M');
  assert.equal(formatUsd(12_340), '$12.3K');
});

test('百分比入参已是百分比数值（mapper 里对 pc24h 做过 ×100）', () => {
  assert.equal(formatPercent(12.3456), '+12.35%');
  assert.equal(formatPercent(-4), '-4.00%');
});

test('上线时长', () => {
  const now = Date.UTC(2026, 0, 10);
  assert.equal(formatAge(now - 90 * 60_000, now), '1h');
  assert.equal(formatAge(now - 5 * 86400_000, now), '5d');
  assert.equal(formatAge(undefined, now), '—');
});

test('DEX 名缩写并去掉链名后缀', () => {
  assert.equal(shortDex('PancakeSwap v4 CLAMM(BSC)'), 'Pancake v4 CLAMM');
  assert.equal(shortDex('Uniswap v3 (Ethereum)'), 'Uni v3');
  assert.equal(shortDex('Raydium (CLMM)'), 'Raydium');
  assert.equal(shortDex('Orca'), 'Orca');
});

test('紧凑百分比与紧凑金额', () => {
  assert.equal(pctShort(33.73), '34%');
  assert.equal(pctShort(9.64), '9.6%');
  assert.equal(formatUsdShort(130_200_000), '$130.2M');
  assert.equal(formatUsdShort(801_000), '$801K');
});
