import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { openMemoryDatabase } from '../src/infra/db.js';
import { PortfolioService } from '../src/services/portfolioService.js';
import { renderPortfolio } from '../src/render/portfolio.js';
import { decodeCallback, encodeCallback } from '../src/bot/callbackData.js';
import { portfolioKeyboard, sharedWatchlistKeyboard, watchlistShareKeyboard } from '../src/render/keyboards.js';
import { renderWatchlistShare } from '../src/render/portfolio.js';
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
  assert.match(renderPortfolio([]), /⭐ <b><u>Watchlist<\/u><\/b>\n\nEmpty\./);
  const html = renderPortfolio([
    { entry: { ...PEPE, addedAt: 0 }, priceUsd: 0.000012, sinceAddedPct: 20, change24hPct: -5.1, marketCapUsd: 5e9 },
    { entry: { userId: 7, networkSlug: 'bnb', address: '0xd', symbol: 'NOQUOTE', addedAt: 0 } },
  ]);
  assert.match(html, /⭐ <b><u>Watchlist<\/u><\/b>  2 tokens/);
  assert.match(html, /<b>PEPE<\/b> · Ethereum\n├ <code>Price  <\/code> \$0\.0₄1200\n├ <code>MC     <\/code> \$5\.0B\n├ \+20\.00% since add 🟢\n└ -5\.10% 24h 🔴/);
  assert.match(html, /<b>NOQUOTE<\/b> · BNB Chain\n\n<i>Tap/);
});

test('portfolio 回调码往返，port_refresh 不带地址也能解码', () => {
  for (const action of ['port_add', 'port_del', 'port_scan'] as const) {
    const data = encodeCallback({ action, networkSlug: 'bnb', address: '0x' + 'a'.repeat(40), symbol: 'PEPE' });
    assert.ok(Buffer.byteLength(data) <= 64);
    assert.equal(decodeCallback(data)?.action, action);
  }
  assert.deepEqual(decodeCallback(encodeCallback({ action: 'port_refresh' })), { action: 'port_refresh', networkSlug: undefined, address: undefined, symbol: undefined });
});

test('watchlist 键盘：一行两个代币四个按钮，末行 Refresh + Share（选聊天分享）', () => {
  const entries = ['A', 'B', 'C'].map((sym, i) => ({ networkSlug: 'bnb', address: '0x' + String(i).repeat(40), symbol: sym }));
  const kb = portfolioKeyboard(entries).reply_markup.inline_keyboard;
  assert.equal(kb.length, 3);
  assert.deepEqual(kb[0]!.map((b) => b.text), ['🔍 A', '🗑', '🔍 B', '🗑']);
  assert.deepEqual(kb[1]!.map((b) => b.text), ['🔍 C', '🗑']);
  assert.deepEqual(kb[2]!.map((b) => b.text), ['🔄 Refresh', '📤 Share']);
  const share = kb[2]![1] as { switch_inline_query_chosen_chat?: { query: string; allow_group_chats?: boolean } };
  assert.equal(share.switch_inline_query_chosen_chat?.query, 'watchlist');
  assert.equal(share.switch_inline_query_chosen_chat?.allow_group_chats, true);
  const shared = watchlistShareKeyboard('sonar_bot', 'abc123').inline_keyboard;
  assert.deepEqual(shared[0]!.map((b) => ('url' in b ? b.url : '')), ['https://t.me/sonar_bot?start=wl_abc123', 'https://t.me/sonar_bot?startgroup=true']);
  const viewer = sharedWatchlistKeyboard(entries, 'abc123').reply_markup.inline_keyboard;
  assert.deepEqual(viewer.map((r) => r.map((b) => b.text)), [['🔍 A', '🔍 B'], ['🔍 C'], ['⭐ Add all to my watchlist']]);
  assert.equal(decodeCallback((viewer[2]![0] as { callback_data: string }).callback_data)?.address, 'abc123');
});

test('renderWatchlistShare：带主人名字，不含 since add，附合约地址', () => {
  const html = renderWatchlistShare('@hakeen', [
    { entry: { ...PEPE, addedAt: 0 }, priceUsd: 0.000012, sinceAddedPct: 20, change24hPct: -5.1, marketCapUsd: 5e9 },
  ]);
  assert.match(html, /⭐ <b><u>@hakeen's Watchlist<\/u><\/b>  1 token\n/);
  assert.match(html, /<b>PEPE<\/b> · Ethereum\n├ <code>Price  <\/code> \$0\.0₄1200\n├ <code>MC     <\/code> \$5\.0B\n├ -5\.10% 24h 🔴\n└ <code>0x6982508145454CE325DDBE47A25D4EC3D2311933<\/code>/); // 夹具地址未经 add 归一，保持原样
  assert.doesNotMatch(html, /since add/);
});

test('分享 id：创建 / 解析 / 7 天过期；copyFrom 跳过已有、尊重上限、用当前价做加入价', () => {
  const svc = new PortfolioService(openMemoryDatabase(), stubGateway({}), 3);
  const t0 = 1_700_000_000_000;
  svc.add({ ...PEPE, addedAt: t0 });
  svc.add({ userId: 7, networkSlug: 'bnb', address: '0x' + 'b'.repeat(40), symbol: 'B', addedAt: t0 + 1 });
  const id = svc.createShare(7, '@hakeen', t0);
  assert.match(id, /^[A-Za-z0-9]{6,10}$/);
  assert.deepEqual(svc.resolveShare(id, t0 + 1000), { ownerId: 7, ownerName: '@hakeen' });
  assert.equal(svc.resolveShare(id, t0 + 8 * 24 * 3_600_000), undefined);
  assert.equal(svc.resolveShare('nope', t0), undefined);

  // 用户 8 已有 B，还有 2 个位子；主人有 PEPE + B → 加 1 跳 1
  svc.add({ userId: 8, networkSlug: 'bnb', address: '0x' + 'b'.repeat(40), symbol: 'B' });
  const r = svc.copyFrom(7, 8, new Map([['ethereum:' + PEPE.address.toLowerCase(), { priceUsd: 0.00002, marketCapUsd: 9e9 }]]));
  assert.deepEqual(r, { added: 1, skipped: 1, full: 0 });
  const copied = svc.list(8).find((e) => e.symbol === 'PEPE')!;
  assert.equal(copied.addedPriceUsd, 0.00002);
  assert.equal(copied.cmcId, 24478);

  // 上限 3：主人补到 3 个；用户 9 已占 1 个位子 → 复制进 2 个，第 3 个满
  svc.add({ userId: 7, networkSlug: 'bnb', address: '0x' + 'c'.repeat(40), symbol: 'C' });
  svc.add({ userId: 9, networkSlug: 'bnb', address: '0x' + 'e'.repeat(40), symbol: 'E' });
  assert.deepEqual(svc.copyFrom(7, 9), { added: 2, skipped: 0, full: 1 });
});
