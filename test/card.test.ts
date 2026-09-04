import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderScanCard } from '../src/render/card.js';
import type { TokenReport } from '../src/domain/types.js';

function baseReport(over: Partial<TokenReport> = {}): TokenReport {
  return {
    primary: {
      cmcId: 1027,
      name: 'Ethereum',
      symbol: 'ETH',
      networkSlug: 'ethereum',
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      priceUsd: 2524,
      volume24hUsd: 500e6,
      liquidityUsd: 1e9,
      raw: {},
    },
    secondaryDeployments: [],
    pools: [],
    risks: [],
    degraded: [],
    generatedAt: 0,
    ...over,
  };
}

test('Perps 区块：OI / Top / Vol / Funding / Liq 各一行', () => {
  const html = renderScanCard(
    baseReport({
      core: { cmcId: 1027, categories: [], spotVolume24hUsd: 12e9, cexVolume24hUsd: 11e9, dexVolume24hUsd: 1e9 },
      perp: {
        openInterestUsd: 9.8e9,
        volume24hUsd: 38.2e9,
        totalPairs: 197,
        venues: [
          { slug: 'binance', name: 'Binance', kind: 'cex', openInterestUsd: 5.9e9, volume24hUsd: 1, fundingIntervalH: 8, fundingRate: 0.0000646 },
          { slug: 'okx', name: 'OKX', kind: 'cex', openInterestUsd: 1.6e9, volume24hUsd: 1, fundingIntervalH: 8 },
          { slug: 'bybit', name: 'Bybit', kind: 'cex', openInterestUsd: 1.2e9, volume24hUsd: 1, fundingIntervalH: 8 },
          { slug: 'gate', name: 'Gate', kind: 'cex', openInterestUsd: 1.1e9, volume24hUsd: 1, fundingIntervalH: 8 },
        ],
        funding: { venue: 'Binance', rate: 0.0000646, intervalH: 8, rate8h: 0.0000646, apr: 0.0707 },
      },
      liquidations: { total24hUsd: 108e6, long24hUsd: 22e6, short24hUsd: 86e6, total1hUsd: 0.5e6, long1hUsd: 0.1e6, short1hUsd: 0.4e6 },
    }),
  );
  assert.match(html, /📈 Perps<\/b>  197 pairs/);
  assert.match(html, /OI\s*<\/code> \$9\.8B · 4 venues/);
  assert.match(html, /Top\s*<\/code> Binance 60% · OKX 16% · Bybit 12%/);
  assert.match(html, /Vol\s*<\/code> \$38\.2B \(3\.2× spot\)/);
  assert.match(html, /Funding<\/code> \+0\.0065%\/8h · \+7\.1% APR · Binance/);
  assert.match(html, /Liq 24h<\/code> \$108\.0M · L \$22\.0M \/ S \$86\.0M/);
  assert.match(html, /Liq 1h\s*<\/code> \$500K/);
  assert.match(html, /Spot\s*<\/code> CEX \$11\.0B · DEX \$1\.0B · 92% CEX/);
});

test('无 perp 也无 liquidations 时不出 Perps 区块；只有爆仓也能单独出', () => {
  assert.doesNotMatch(renderScanCard(baseReport()), /Perps/);
  const html = renderScanCard(baseReport({ liquidations: { total24hUsd: 1622, long24hUsd: 1024, short24hUsd: 597 } }));
  assert.match(html, /📈 Perps<\/b>\n└ <code>Liq 24h<\/code> \$2K/);
});

test('1h 制费率标注 native 周期', () => {
  const html = renderScanCard(
    baseReport({
      perp: {
        openInterestUsd: 1e6,
        volume24hUsd: 0,
        totalPairs: 1,
        venues: [{ slug: 'hyperliquid', name: 'Hyperliquid', kind: 'dex', openInterestUsd: 1e6, volume24hUsd: 0, fundingIntervalH: 1, fundingRate: 0.0000125 }],
        funding: { venue: 'Hyperliquid', rate: 0.0000125, intervalH: 1, rate8h: 0.0001, apr: 0.1095 },
      },
    }),
  );
  assert.match(html, /Funding<\/code> \+0\.0100%\/8h · \+10\.9% APR · Hyperliquid \(1h native\)/);
  assert.doesNotMatch(html, /Top\s*<\/code>/);
});
