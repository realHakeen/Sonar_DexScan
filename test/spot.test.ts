import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { CmcMarketPair } from '../src/api/cmc/types.js';
import { aggregateSpotPairs, spotPremiumPct } from '../src/domain/spot.js';

function pair(slug: string, vol: number, extra: Partial<CmcMarketPair> = {}): CmcMarketPair {
  return { market_pair: 'X/USDT', category: 'spot', outlier_detected: false, exclusions: [], exchange: { slug, name: slug }, quote: { USD: { price: 1, volume_24h: vol } }, ...extra };
}

test('现货占比只算白名单所，刷量所不计入；同所多对合并；按成交量降序', () => {
  const s = aggregateSpotPairs(
    [pair('binance', 30e6), pair('binance', 10e6, { market_pair: 'X/USDC' }), pair('okx', 15e6), pair('whitebit', 14e6), pair('uzx', 9e6), pair('bybit', 5e6)],
    100,
  );
  assert.ok(s);
  assert.deepEqual(s.venues.map((v) => [v.slug, v.volume24hUsd]), [['binance', 40e6], ['okx', 15e6], ['bybit', 5e6]]);
  assert.equal(s.whitelistVolumeUsd, 60e6);
  assert.equal(s.returnedPairs, 6);
  assert.equal(s.complete, true);
});

test('outlier / exclusions 丢弃；返回条数等于上限时 complete=false；无可信数据返回 undefined', () => {
  const s = aggregateSpotPairs([pair('binance', 1, { outlier_detected: true }), pair('okx', 1, { exclusions: ['volume'] }), pair('kraken', 2)], 3);
  assert.ok(s);
  assert.deepEqual(s.venues.map((v) => v.slug), ['kraken']);
  assert.equal(s.complete, false);
  assert.equal(aggregateSpotPairs([pair('whitebit', 1)], 100), undefined);
  assert.equal(aggregateSpotPairs([], 100), undefined);
});

test('spotPremiumPct：参考价对池子价；缺失 / 非正 / 离谱返回 undefined', () => {
  assert.ok(Math.abs(spotPremiumPct(1.02, 1)! - 2) < 1e-9);
  assert.ok(Math.abs(spotPremiumPct(0.98, 1)! + 2) < 1e-9);
  assert.equal(spotPremiumPct(undefined, 1), undefined);
  assert.equal(spotPremiumPct(1, 0), undefined);
  assert.equal(spotPremiumPct(2, 1), undefined);
});
