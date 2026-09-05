import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { aggregatePerpPairs, isDominantCoin } from '../src/domain/derivatives.js';
import { CoinIndex } from '../src/domain/coinIndex.js';
import { renderPerpCard, renderPerpCandidates } from '../src/render/perpCard.js';
import type { PerpView } from '../src/services/perpService.js';
import type { CmcDerivativePair } from '../src/api/cmc/types.js';

test('isDominantCoin：第二名无排名 / 落后 5 倍 / 差 500 名都算占优，否则要消歧', () => {
  assert.equal(isDominantCoin([{ cmcId: 1, rank: 47 }]), true);
  assert.equal(isDominantCoin([{ cmcId: 1, rank: 47 }, { cmcId: 2 }]), true);
  assert.equal(isDominantCoin([{ cmcId: 1, rank: 47 }, { cmcId: 2, rank: 3000 }]), true);
  assert.equal(isDominantCoin([{ cmcId: 1, rank: 900 }, { cmcId: 2, rank: 1500 }]), true);
  assert.equal(isDominantCoin([{ cmcId: 1, rank: 100 }, { cmcId: 2, rank: 300 }]), false);
  assert.equal(isDominantCoin([{ cmcId: 1 }, { cmcId: 2, rank: 5 }]), false);
  assert.equal(isDominantCoin([]), false);
});

test('索引 lookup 默认过滤原生币，includeNative 时 BTC 也能查到', () => {
  const idx = new CoinIndex();
  idx.load([
    { id: 1, name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', rank: 1, platform: null },
    { id: 24478, name: 'Pepe', symbol: 'PEPE', slug: 'pepe', rank: 47, platform: { name: 'Ethereum', token_address: '0x6982508145454ce325ddbe47a25d4ec3d2311933' } },
  ]);
  assert.equal(idx.lookup('BTC').length, 0);
  assert.equal(idx.lookup('BTC', 5, { includeNative: true })[0]?.cmcId, 1);
  assert.equal(idx.lookup('pepe', 5, { includeNative: true })[0]?.cmcId, 24478);
});

function pair(slug: string, oi: number, vol: number, funding: number, basis: number): CmcDerivativePair {
  return {
    category: 'perpetual',
    outlier_detected: false,
    exclusions: [],
    exchange: { exchange_slug: slug, exchange_name: slug },
    exchange_reported_quotes: [{ convert_symbol: 'USD', open_interest: oi, funding_rate: funding, index_basis: basis }],
    quotes: [{ convert_symbol: 'USD', volume_24h: vol, open_interest: oi }],
  };
}

test('aggregatePerpPairs 记录基差与进入统计的合约对数；脏基差丢弃；totalPairs 取上游总数', () => {
  const s = aggregatePerpPairs(
    [
      pair('binance', 100e6, 300e6, 0.0001, 0.0003),
      pair('hyperliquid', 50e6, 100e6, 0.0000125, 0.0012),
      pair('kraken', 10e6, 1e6, 0.0001, 0.36), // Kraken XBT/USD 实测报过 +36%
      pair('tapbit', 999e6, 999e6, 0.0001, 0), // 白名单外
    ],
    { totalPairs: 202 },
  );
  assert.ok(s);
  assert.equal(s.countedPairs, 3);
  assert.equal(s.totalPairs, 202);
  assert.equal(s.venues[0]!.basis, 0.0003);
  assert.equal(s.venues[1]!.basis, 0.0012);
  assert.equal(s.venues[2]!.basis, undefined);
});

test('基差全为负时只出 Discount 行，不出 Premium', () => {
  const html = renderPerpCard({
    cmcId: 1, symbol: 'X', name: 'X', degraded: [],
    perp: {
      openInterestUsd: 2, volume24hUsd: 0, totalPairs: 2, countedPairs: 2,
      venues: [
        { slug: 'binance', name: 'Binance', kind: 'cex', openInterestUsd: 1, volume24hUsd: 0, fundingIntervalH: 8, basis: -0.0016 },
        { slug: 'mexc', name: 'MEXC', kind: 'cex', openInterestUsd: 1, volume24hUsd: 0, fundingIntervalH: 8, basis: -0.0001 },
      ],
    },
  });
  assert.match(html, /Discount: <code>-0\.16%<\/code> Binance/);
  assert.doesNotMatch(html, /Premium|Range/);
});

test('renderPerpCard：头部比值、按所行、基差、爆仓、脚注', () => {
  const view: PerpView = {
    cmcId: 24478,
    symbol: 'PEPE',
    name: 'Pepe',
    degraded: [],
    core: { cmcId: 24478, categories: [], marketCapUsd: 1.5e9, spotVolume24hUsd: 450e6 },
    perp: {
      openInterestUsd: 122e6,
      volume24hUsd: 505e6,
      totalPairs: 70,
      countedPairs: 8,
      venues: [
        { slug: 'binance', name: 'Binance', kind: 'cex', openInterestUsd: 71e6, volume24hUsd: 334e6, fundingIntervalH: 8, fundingRate: 0.0001, basis: 0.0005 },
        { slug: 'mexc', name: 'MEXC', kind: 'cex', openInterestUsd: 34e6, volume24hUsd: 90e6, fundingIntervalH: 8, fundingRate: 0.00005, basis: -0.0002 },
        { slug: 'hyperliquid', name: 'Hyperliquid', kind: 'dex', openInterestUsd: 17e6, volume24hUsd: 81e6, fundingIntervalH: 1, fundingRate: 0.0000125, basis: 0.0011 },
      ],
      funding: { venue: 'Binance', rate: 0.0001, intervalH: 8, rate8h: 0.0001, apr: 0.1095 },
    },
    liquidations: { total1hUsd: 4000, long1hUsd: 0, short1hUsd: 4000, total4hUsd: 70e3, long4hUsd: 29e3, short4hUsd: 41e3, total24hUsd: 2.7e6, long24hUsd: 0.8e6, short24hUsd: 1.9e6 },
  };
  const html = renderPerpCard(view);
  assert.match(html, /📈 PEPE Perps<\/b> · 3 venues · 70 pairs/);
  assert.match(html, /OI: <code>\$122\.0M<\/code> · <code>8%<\/code> of MC/);
  assert.match(html, /Vol 24h: <code>\$505\.0M<\/code> · <code>1\.1×<\/code> spot/);
  assert.match(html, /CEX\/DEX: <code>\$105\.0M<\/code> \/ <code>\$17\.0M<\/code> OI/);
  assert.match(html, /Funding: 🔴 <code>\+0\.0100%\/8h<\/code> · <code>\+10\.9%<\/code> APR/);
  assert.match(html, /🔴 <code>Binance      \$71\.0M \$334\.0M \+0\.0100%<\/code>/);
  assert.match(html, /🔴 <code>Hyperliquid  \$17\.0M  \$81\.0M \+0\.0100%<\/code>/); // 1h 制 ×8
  assert.match(html, /Premium: <code>\+0\.11%<\/code> Hyperliquid/);
  assert.match(html, /Discount: <code>-0\.02%<\/code> MEXC/);
  assert.match(html, /1h: <code>\$4K<\/code> · <code>\$0<\/code> \/ <code>\$4K<\/code>/);
  assert.match(html, /24h: <code>\$2\.7M<\/code> · <code>\$800K<\/code> \/ <code>\$1\.9M<\/code>/);
  assert.match(html, /62 pairs on unlisted venues excluded · funding normalised to 8h · liquidations cover 9 venues/);
});

test('renderPerpCard：无合约也无爆仓时给出说明；候选列表带排名', () => {
  const html = renderPerpCard({ cmcId: 1, symbol: 'XYZ', name: 'Xyz', degraded: [] });
  assert.match(html, /No perpetual markets tracked for <b>XYZ<\/b>/);
  const list = renderPerpCandidates('pepe', [
    { cmcId: 1, symbol: 'PEPE', name: 'Pepe', slug: 'pepe', rank: 47 },
    { cmcId: 2, symbol: 'PEPE', name: 'Pepe 2.0', slug: 'pepe-2' },
  ]);
  assert.match(list, /1\. <b>PEPE<\/b> · Pepe · #47\n2\. <b>PEPE<\/b> · Pepe 2\.0$/);
});
