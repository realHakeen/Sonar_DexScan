import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { openMemoryDatabase } from '../src/infra/db.js';
import { PortfolioService } from '../src/services/portfolioService.js';
import { renderPortfolio } from '../src/render/portfolio.js';
import { decodeCallback, encodeCallback } from '../src/bot/callbackData.js';
import type { CmcGateway } from '../src/api/cmc/index.js';

/** 只实现 portfolio 用到的两条通路。 */
function stubGateway(opts: { quotes?: Map<number, { priceUsd?: number; change24hPct?: number; marketCapUsd?: number }>; dexPrice?: number }): CmcGateway {
  return {
    core: { quotesBatch: async () => opts.quotes ?? new Map() },
    dex: {
      tokenDetail: async () => ({ candidate: { priceUsd: opts.dexPrice, priceChange24hPct: -3, fdvUsd: 5e6, name: 'x', symbol: 'X', networkSlug: 'bnb', address: '0x', raw: {} }, pools: [] }),
      search: async () => [],
    },
  } as unknown as CmcGateway;
}

const PEPE = { userId: 7, networkSlug: 'ethereum', address: '0x6982508145454CE325DDBE47A25D4EC3D2311933', symbol: 'PEPE', name: 'Pepe', cmcId: 24478, addedPriceUsd: 0.00001 };

test('add / has / list / remove；地址大小写归一；重复加返回 exists；满员返回 full', () => {
  const svc = new PortfolioService(openMemoryDatabase(), stubGateway({}), 2);
  assert.equal(svc.add(PEPE), 'added');
  assert.equal(svc.add({ ...PEPE, address: PEPE.address.toLowerCase() }), 'exists');
  assert.equal(svc.has(7, 'ethereum', PEPE.address), true);
  assert.equal(svc.add({ ...PEPE, address: '0x' + 'b'.repeat(40), symbol: 'B', cmcId: undefined }), 'added');
  assert.equal(svc.add({ ...PEPE, address: '0x' + 'c'.repeat(40), symbol: 'C' }), 'full');
  assert.equal(svc.size(7), 2);
  assert.equal(svc.size(8), 0); // 别的用户看不到
  assert.deepEqual(svc.list(7).map((e) => e.symbol), ['B', 'PEPE']); // 新加的在前
  assert.equal(svc.remove(7, 'ethereum', PEPE.address.toLowerCase()), true);
  assert.equal(svc.remove(7, 'ethereum', PEPE.address), false);
  assert.equal(svc.size(7), 1);
});

test('listWithQuotes：有 cid 走批量行情并算自加入以来涨跌；无 cid 走 token 详情', async () => {
  const quotes = new Map([[24478, { priceUsd: 0.000012, change24hPct: 4.2, marketCapUsd: 5e9 }]]);
  const svc = new PortfolioService(openMemoryDatabase(), stubGateway({ quotes, dexPrice: 2 }));
  svc.add(PEPE);
  svc.add({ userId: 7, networkSlug: 'bnb', address: '0x' + 'd'.repeat(40), symbol: 'DEXONLY', addedPriceUsd: 1 });
  const rows = await svc.listWithQuotes(7);
  const pepe = rows.find((r) => r.entry.symbol === 'PEPE')!;
  assert.ok(Math.abs(pepe.sinceAddedPct! - 20) < 1e-9);
  assert.equal(pepe.change24hPct, 4.2);
  const dex = rows.find((r) => r.entry.symbol === 'DEXONLY')!;
  assert.equal(dex.priceUsd, 2);
  assert.ok(Math.abs(dex.sinceAddedPct! - 100) < 1e-9);
  assert.equal(dex.change24hPct, -3);
});

test('renderPortfolio：空列表提示；有行情时显示价格、自加入涨跌与 24h', () => {
  assert.match(renderPortfolio([]), /⭐ <b><u>Portfolio<\/u><\/b>\n\nEmpty\./);
  const html = renderPortfolio([
    { entry: { ...PEPE, addedAt: 0 }, priceUsd: 0.000012, sinceAddedPct: 20, change24hPct: -5.1, marketCapUsd: 5e9 },
    { entry: { userId: 7, networkSlug: 'bnb', address: '0xd', symbol: 'NOQUOTE', addedAt: 0 } },
  ]);
  assert.match(html, /⭐ <b><u>Portfolio<\/u><\/b>  2 tokens/);
  assert.match(html, /├ PEPE · Ethereum  \$0\.0₄1200 · 🟢 \+20\.00% since add · 🔴 -5\.10% 24h/);
  assert.match(html, /└ NOQUOTE · BNB Chain$/m);
  assert.match(html, /MC PEPE \$5\.0B/);
});

test('portfolio 回调码往返，port_refresh 不带地址也能解码', () => {
  for (const action of ['port_add', 'port_del', 'port_scan'] as const) {
    const data = encodeCallback({ action, networkSlug: 'bnb', address: '0x' + 'a'.repeat(40), symbol: 'PEPE' });
    assert.ok(Buffer.byteLength(data) <= 64);
    assert.equal(decodeCallback(data)?.action, action);
  }
  assert.deepEqual(decodeCallback(encodeCallback({ action: 'port_refresh' })), { action: 'port_refresh', networkSlug: undefined, address: undefined, symbol: undefined });
});
