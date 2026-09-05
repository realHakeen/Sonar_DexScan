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
  assert.match(html, /OI: <code>\$9\.8B<\/code> · <code>4<\/code> venues/);
  assert.match(html, /Top: Binance <code>60%<\/code> · OKX <code>16%<\/code> · Bybit <code>12%<\/code>/);
  assert.match(html, /Vol: <code>\$38\.2B<\/code> · <code>3\.2×<\/code> spot/);
  assert.match(html, /Funding: 🔴 <code>\+0\.0065%\/8h<\/code> · <code>\+7\.1%<\/code> APR · Binance/);
  assert.match(html, /Liq 24h: <code>\$108\.0M<\/code> · L <code>\$22\.0M<\/code> \/ S <code>\$86\.0M<\/code>/);
  assert.match(html, /Liq 1h: <code>\$500K<\/code>/);
  assert.match(html, /Spot: CEX <code>\$11\.0B<\/code> · DEX <code>\$1\.0B<\/code> · <code>92%<\/code> CEX/);
});

test('无 perp 也无 liquidations 时不出 Perps 区块；只有爆仓也能单独出', () => {
  assert.doesNotMatch(renderScanCard(baseReport()), /Perps/);
  const html = renderScanCard(baseReport({ liquidations: { total24hUsd: 1622, long24hUsd: 1024, short24hUsd: 597 } }));
  assert.match(html, /📈 Perps<\/b>\n└ Liq 24h: <code>\$2K<\/code>/);
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
  assert.match(html, /Funding: 🔴 <code>\+0\.0100%\/8h<\/code> · <code>\+10\.9%<\/code> APR · Hyperliquid \(1h native\)/);
  assert.doesNotMatch(html, /Top:/);
});

test('涨绿跌红：Txns / Flow 用 emoji 色块；负费率标绿', () => {
  const html = renderScanCard(
    baseReport({
      primary: { ...baseReport().primary, buys24h: 9900, sells24h: 9100, buyVolume24hUsd: 1.8e6, sellVolume24hUsd: 1.7e6 },
      perp: {
        openInterestUsd: 1e6, volume24hUsd: 0, totalPairs: 1, countedPairs: 1,
        venues: [{ slug: 'gate', name: 'Gate', kind: 'cex', openInterestUsd: 1e6, volume24hUsd: 0, fundingIntervalH: 8, fundingRate: -0.0002 }],
        funding: { venue: 'Gate', rate: -0.0002, intervalH: 8, rate8h: -0.0002, apr: -0.219 },
      },
    }),
  );
  assert.match(html, /Txns: 🟢 <code>↑9\.9K<\/code> · 🔴 <code>↓9\.1K<\/code>/);
  assert.match(html, /Flow: 🟢 <code>\+\$1\.8M<\/code> \/ 🔴 <code>−\$1\.7M<\/code> · <code>51%<\/code> buy/);
  assert.match(html, /Funding: 🟢 <code>-0\.0200%\/8h<\/code> · <code>-21\.9%<\/code> APR · Gate/);
});

test('Pools：名字链接到浏览器的 LP 合约页，锁仓 / 销毁用分隔符；Tags 每行两个', () => {
  const html = renderScanCard(
    baseReport({
      primary: { ...baseReport().primary, networkSlug: 'bnb' },
      pools: [
        { dexName: 'PancakeSwap v2', quoteSymbol: 'WBNB', liquidityUsd: 1.4e6, pairAddress: '0x' + 'a'.repeat(40), lockedRatePct: 100, raw: {} },
        { dexName: 'PancakeSwap v3', quoteSymbol: 'USDT', liquidityUsd: 87e3, pairAddress: '0x' + 'b'.repeat(40), raw: {} },
      ],
      tags: { sniper: 1, dev: 1, whale: 500, bot: 2800, smartMoney: 9, kol: 57, holdingPct: { whale: 56, bot: 1.0 } },
    }),
  );
  assert.match(html, /Pancake v2 \/ WBNB · <a href="https:\/\/bscscan\.com\/address\/0xa{40}">\$1\.4M<\/a> \(<code>94%<\/code>\) · 🔒 100%/);
  assert.match(html, /Pancake v3 \/ USDT · <a href="https:\/\/bscscan\.com\/address\/0xb{40}">\$87K<\/a>$/m);
  assert.match(html, /Tags: 🎯 <code>1<\/code> · 🧑‍💻 <code>1<\/code>\n├ 🐳 <code>500<\/code> \(<code>56%<\/code>\) · 🤖 <code>2\.8K<\/code> \(<code>1\.0%<\/code>\)\n└ 🧠 <code>9<\/code> · 📣 <code>57<\/code>/);
});

test('Holders 头部带 24h 变化；✅ 与 circ. 链接到 CMC 帮助中心', () => {
  const html = renderScanCard(
    baseReport({
      primary: { ...baseReport().primary, officialVerified: true, fdvUsd: 19.4e6 },
      core: { cmcId: 1027, categories: [], marketCapUsd: 18.7e6, fdvUsd: 19.4e6 },
      holders: { totalHolders: 100402, change24h: 103, change24hPct: 0.1027 },
    }),
  );
  assert.match(html, /<b>ETH<\/b> <a href="https:\/\/support\.coinmarketcap\.com\/hc\/en-us\/articles\/16945563933723-CMC-Priority-CMCP">✅<\/a> · Ethereum/);
  assert.match(html, /MC: <code>\$18\.7M<\/code> · <code>96%<\/code> <a href="https:\/\/support\.coinmarketcap\.com\/hc\/en-us\/articles\/360043396252-Supply-Circulating-Total-Max">circ\.<\/a>/);
  assert.match(html, /👥 Holders<\/b>  <code>100\.4K<\/code> 🟢 <code>\+0\.10%<\/code> 24h/);
  const flat = renderScanCard(baseReport({ holders: { totalHolders: 5, change24h: 0, change24hPct: 0 } }));
  assert.match(flat, /👥 Holders<\/b>  <code>5<\/code>(\n|$)/);
});
