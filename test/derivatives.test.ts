import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { CmcDerivativePair } from '../src/api/cmc/types.js';
import { aggregatePerpPairs, normalizeFunding, toLiquidationStats } from '../src/domain/derivatives.js';

// 样例按 2026-09-04 /v5/cryptocurrency/derivatives/market-pairs 真实响应裁剪
function pair(
  slug: string,
  oi: number,
  vol: number,
  funding: number | undefined,
  extra: Partial<CmcDerivativePair> = {},
): CmcDerivativePair {
  return {
    market_pair_symbol: 'ETH/USDT',
    category: 'perpetual',
    outlier_detected: false,
    exclusions: [],
    exchange: { exchange_id: 1, exchange_name: slug, exchange_slug: slug },
    market_pair_base: { crypto_id: 1027, symbol: 'ETH', exchange_symbol: 'ETH' },
    exchange_reported_quotes: [{ convert_symbol: 'USD', price: 2524, open_interest: oi, funding_rate: funding }],
    quotes: [{ convert_symbol: 'USD', price: 2524, volume_24h: vol, open_interest: oi }],
    ...extra,
  };
}

test('白名单外的所不计入，白名单内按 OI 降序求和', () => {
  const s = aggregatePerpPairs([
    pair('binance', 5_850e6, 11_900e6, 0.0000646),
    pair('okx', 1_600e6, 9_500e6, 0.0000666),
    pair('tapbit', 1_360e6, 9_700e6, 0.000065), // 白名单外
    pair('deepcoin', 1_400e6, 12_000e6, 0.00019), // 白名单外
  ]);
  assert.ok(s);
  assert.equal(s.openInterestUsd, 7_450e6);
  assert.equal(s.volume24hUsd, 21_400e6);
  assert.deepEqual(s.venues.map((v) => v.slug), ['binance', 'okx']);
  assert.equal(s.totalPairs, 4);
});

test('outlier_detected / exclusions 非空的合约对被丢弃', () => {
  const s = aggregatePerpPairs([
    pair('binance', 100e6, 200e6, 0.0001),
    pair('okx', 50e6, 100e6, 0.0001, { outlier_detected: true }),
    pair('bybit', 50e6, 100e6, 0.0001, { exclusions: ['price'] }),
  ]);
  assert.ok(s);
  assert.equal(s.openInterestUsd, 100e6);
  assert.deepEqual(s.venues.map((v) => v.slug), ['binance']);
});

test('同所多个合约对合并，费率取该所 OI 最大的一条', () => {
  const s = aggregatePerpPairs([
    pair('binance', 30e6, 10e6, 0.0005, { market_pair_symbol: 'ETH/USDC' }),
    pair('binance', 70e6, 20e6, 0.0001, { market_pair_symbol: 'ETH/USDT' }),
  ]);
  assert.ok(s);
  assert.equal(s.venues.length, 1);
  assert.equal(s.venues[0]!.openInterestUsd, 100e6);
  assert.equal(s.venues[0]!.volume24hUsd, 30e6);
  assert.equal(s.funding?.rate, 0.0001);
});

test('兜底：最大所 OI 超过第二名 20 倍视为抽风剔除（HMSTR 式假 OI）', () => {
  const s = aggregatePerpPairs([
    pair('bingx', 1_400e6, 5e6, 0.0001), // 抽风
    pair('kucoin', 1.1e6, 2e6, 0.0001),
    pair('mexc', 0.5e6, 1e6, 0.0001),
  ]);
  assert.ok(s);
  assert.deepEqual(s.venues.map((v) => v.slug), ['kucoin', 'mexc']);
  assert.equal(s.openInterestUsd, 1.6e6);
  assert.equal(s.funding?.venue, 'KuCoin');
});

test('兜底不误伤：头部所比第二名大 3–4 倍是常态，保留', () => {
  const s = aggregatePerpPairs([pair('binance', 5_850e6, 1, 0.0001), pair('okx', 1_600e6, 1, 0.0001), pair('bybit', 1_200e6, 1, 0.0001)]);
  assert.ok(s);
  assert.equal(s.venues.length, 3);
  assert.equal(s.venues[0]!.slug, 'binance');
});

test('只有一家所时不做倍数兜底', () => {
  const s = aggregatePerpPairs([pair('mexc', 33.7e6, 100e6, 0.0001)]);
  assert.ok(s);
  assert.equal(s.venues.length, 1);
  assert.equal(s.openInterestUsd, 33.7e6);
});

test('费率参考取 OI 最大且带费率的所，并按结算周期折算到 8h', () => {
  const s = aggregatePerpPairs([
    pair('hyperliquid', 900e6, 1, 0.0000125), // 1h 制
    pair('binance', 500e6, 1, undefined), // 无费率
    pair('okx', 400e6, 1, 0.0000668),
  ]);
  assert.ok(s?.funding);
  assert.equal(s.funding.venue, 'Hyperliquid');
  assert.equal(s.funding.intervalH, 1);
  assert.ok(Math.abs(s.funding.rate8h - 0.0001) < 1e-12);
  assert.ok(Math.abs(s.funding.apr - 0.0001 * 3 * 365) < 1e-9);
});

test('normalizeFunding：8h 制原样，4h 制 ×2', () => {
  assert.equal(normalizeFunding('Binance', 0.0001, 8).rate8h, 0.0001);
  assert.equal(normalizeFunding('edgeX', 0.0001, 4).rate8h, 0.0002);
});

test('没有可信合约对 → undefined，空列表 / undefined 也是 undefined', () => {
  assert.equal(aggregatePerpPairs(undefined), undefined);
  assert.equal(aggregatePerpPairs([]), undefined);
  assert.equal(aggregatePerpPairs([pair('tapbit', 1e9, 1e9, 0.0001)]), undefined);
  assert.equal(aggregatePerpPairs([pair('binance', 0, 0, 0.0001)]), undefined);
});

test('toLiquidationStats：取 USD quote，字段对齐', () => {
  const s = toLiquidationStats({
    crypto_id: 1027,
    symbol: 'ETH',
    quotes: [
      {
        symbol: 'USD',
        total_liquidations_1h: 498902.47,
        long_liquidations_1h: 128001.61,
        short_liquidations_1h: 370900.86,
        total_liquidations_4h: 13850325.24,
        long_liquidations_4h: 2335720.5,
        short_liquidations_4h: 11514604.74,
        total_liquidations_24h: 107787835.37,
        long_liquidations_24h: 21709974.9,
        short_liquidations_24h: 86077860.47,
      },
    ],
  });
  assert.ok(s);
  assert.equal(s.total24hUsd, 107787835.37);
  assert.equal(s.long1hUsd, 128001.61);
  assert.equal(s.short4hUsd, 11514604.74);
  assert.equal(toLiquidationStats(undefined), undefined);
  assert.equal(toLiquidationStats({ quotes: [] }), undefined);
});
