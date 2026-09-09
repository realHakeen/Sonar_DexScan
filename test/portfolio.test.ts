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
function stubGateway(opts: { quotes?: Map<number, { priceUsd?: number; change24hPct?: number; marketCapUsd?: number; fdvUsd?: number }>; dexPrice?: number }): CmcGateway {
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
  assert.equal(dex.marketCapUsd, undefined);
  assert.equal(dex.fdvUsd, 5e6, '未收录币没有流通市值，带 FDV 给渲染层兜底');
  assert.ok(Math.abs(dex.sinceAddedPct! - 100) < 1e-9);
  assert.equal(dex.change24hPct, -3);
});

const pageOf = (rows: Parameters<typeof renderPortfolio>[0]['rows'], over: Partial<Parameters<typeof renderPortfolio>[0]> = {}) => ({ rows, page: 1, pages: 1, total: rows.length, ...over });

test('renderPortfolio：空列表提示；三行排版（名字·链 / 价格·MC / 自加入·24h）；多页时标题带页码', () => {
  assert.match(renderPortfolio(pageOf([])), /⭐ <b><u>Watchlist<\/u><\/b>\n\nEmpty\./);
  const html = renderPortfolio(pageOf([
    { entry: { ...PEPE, addedAt: 0 }, priceUsd: 0.000012, sinceAddedPct: 20, change24hPct: -5.1, marketCapUsd: 5e9 },
    { entry: { userId: 7, networkSlug: 'bnb', address: '0xd', symbol: 'NOQUOTE', addedAt: 0 } },
  ]));
  assert.match(html, /⭐ <b><u>Watchlist<\/u><\/b>  2 tokens\n\n/);
  assert.match(html, /<b>PEPE<\/b> · Ethereum\n├ \$0\.0₄1200 · MC \$5\.0B\n└ 🟢 \+20% add · 🔴 -5\.1% 24h\n\n<b>NOQUOTE<\/b> · BNB Chain\n\n<i>Tap/);
  const paged = renderPortfolio(pageOf([{ entry: { ...PEPE, addedAt: 0 } }], { page: 2, pages: 5, total: 87 }));
  assert.match(paged, /87 tokens · page 2\/5/);
  // 没有 MC（CMC 给 0 或未收录）退到 FDV，标签换成 FDV；两个都没有就不出这一段
  const fdv = renderPortfolio(pageOf([{ entry: { ...PEPE, addedAt: 0 }, priceUsd: 1, fdvUsd: 44.4e6 }, { entry: { ...PEPE, addedAt: 0 }, priceUsd: 1, marketCapUsd: 0, fdvUsd: 3e3 }]));
  assert.match(fdv, /└ \$1 · FDV \$44\.4M\n/);
  assert.match(fdv, /└ \$1 · FDV \$3K\n/);
  assert.doesNotMatch(fdv, /MC /);
});

test('listPage：只给当页拉行情，页码越界钳位；上限 100', async () => {
  const quotes = new Map([[24478, { priceUsd: 0.000012 }]]);
  let dexCalls = 0;
  const gw = stubGateway({ quotes, dexPrice: 2 });
  const inner = gw.dex.tokenDetail;
  gw.dex.tokenDetail = ((...a: unknown[]) => { dexCalls += 1; return (inner as (...x: unknown[]) => unknown)(...a); }) as typeof gw.dex.tokenDetail;
  const svc = new PortfolioService(openMemoryDatabase(), gw);
  for (let i = 0; i < 45; i++) svc.add({ userId: 7, networkSlug: 'bnb', address: '0x' + i.toString(16).padStart(40, '0'), symbol: `T${i}`, addedAt: i });
  assert.equal(svc.add({ ...PEPE, userId: 7 }), 'added');
  assert.equal(svc.size(7), 46);
  const p1 = await svc.listPage(7, 1);
  assert.deepEqual([p1.page, p1.pages, p1.total, p1.rows.length], [1, 3, 46, 20]);
  assert.equal(p1.rows[0]!.entry.symbol, 'PEPE'); // 新加的在前，cid 走批量
  assert.equal(dexCalls, 19);
  const p3 = await svc.listPage(7, 3);
  assert.deepEqual([p3.page, p3.rows.length], [3, 6]);
  const clamped = await svc.listPage(7, 99);
  assert.equal(clamped.page, 3);
  const zero = await svc.listPage(8, 1);
  assert.deepEqual([zero.page, zero.pages, zero.total, zero.rows.length], [1, 1, 0, 0]);
});

test('portfolio 回调码往返，port_refresh 不带地址也能解码；页码走第 6 段', () => {
  for (const action of ['port_add', 'port_del', 'port_rm', 'port_scan'] as const) {
    const data = encodeCallback({ action, networkSlug: 'bnb', address: '0x' + 'a'.repeat(40), symbol: 'PEPE' });
    assert.ok(Buffer.byteLength(data) <= 64);
    assert.equal(decodeCallback(data)?.action, action);
  }
  assert.deepEqual(decodeCallback(encodeCallback({ action: 'port_refresh' })), { action: 'port_refresh', networkSlug: undefined, address: undefined, symbol: undefined });
  assert.equal(encodeCallback({ action: 'port_refresh', page: 3 }), 'wr|||||3');
  assert.deepEqual(decodeCallback('wr|||||3'), { action: 'port_refresh', networkSlug: undefined, address: undefined, symbol: undefined, page: 3 });
  const del = encodeCallback({ action: 'port_del', networkSlug: 'solana', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONKBONK', page: 4 });
  assert.ok(Buffer.byteLength(del) <= 64);
  assert.equal(decodeCallback(del)?.page, 4, '塞不下时丢 symbol 保页码');
  assert.deepEqual(decodeCallback(encodeCallback({ action: 'port_spage', address: 'abc123', page: 2 })), { action: 'port_spage', networkSlug: undefined, address: 'abc123', symbol: undefined, page: 2 });
});

test('watchlist 键盘：一行两个 🔍；多页时加 ◀ 页码 ▶；末行 Refresh · Remove · Share；删除模式换成 🗑 SYMBOL + Done', () => {
  const entries = ['A', 'B', 'C'].map((sym, i) => ({ networkSlug: 'bnb', address: '0x' + String(i).repeat(40), symbol: sym }));
  const cb = (b: unknown) => decodeCallback((b as { callback_data: string }).callback_data);
  const kb = portfolioKeyboard(entries).reply_markup.inline_keyboard;
  assert.deepEqual(kb.map((r) => r.map((b) => b.text)), [['🔍 A', '🔍 B'], ['🔍 C'], ['🔄 Refresh', '🗑 Remove', '📤 Share']]);
  assert.equal(cb(kb[0]![0])?.action, 'port_scan');
  assert.deepEqual([cb(kb[2]![1])?.action, cb(kb[2]![1])?.page], ['port_edit', 1]);
  const share = kb[2]![2] as { switch_inline_query_chosen_chat?: { query: string; allow_group_chats?: boolean } };
  assert.equal(share.switch_inline_query_chosen_chat?.query, 'watchlist');
  assert.equal(share.switch_inline_query_chosen_chat?.allow_group_chats, true);
  // 多页：翻页行在末行之上，Refresh / Remove 带当前页
  const paged = portfolioKeyboard(entries, 2, 3).reply_markup.inline_keyboard;
  assert.deepEqual(paged[2]!.map((b) => b.text), ['◀', '2/3', '▶']);
  assert.deepEqual([cb(paged[2]![0])?.page, cb(paged[2]![1])?.action, cb(paged[2]![2])?.page], [1, 'noop', 3]);
  assert.deepEqual([cb(paged[3]![0])?.page, cb(paged[3]![1])?.page], [2, 2]);
  assert.equal(cb(portfolioKeyboard(entries, 1, 3).reply_markup.inline_keyboard[2]![0])?.action, 'noop');
  // 删除模式：🗑 SYMBOL（port_rm 带页码），没有翻页行，末行只有 Done（port_page 回当页）
  const rm = portfolioKeyboard(entries, 2, 3, 'remove').reply_markup.inline_keyboard;
  assert.deepEqual(rm.map((r) => r.map((b) => b.text)), [['🗑 A', '🗑 B'], ['🗑 C'], ['✅ Done']]);
  assert.deepEqual([cb(rm[0]![0])?.action, cb(rm[0]![0])?.page, cb(rm[0]![0])?.address], ['port_rm', 2, '0x' + '0'.repeat(40)]);
  assert.deepEqual([cb(rm[2]![0])?.action, cb(rm[2]![0])?.page], ['port_page', 2]);
  const shared = watchlistShareKeyboard('sonar_bot', 'abc123').inline_keyboard;
  assert.deepEqual(shared[0]!.map((b) => ('url' in b ? b.url : '')), ['https://t.me/sonar_bot?start=wl_abc123', 'https://t.me/sonar_bot?startgroup=true']);
  const viewer = sharedWatchlistKeyboard(entries, 'abc123').reply_markup.inline_keyboard;
  assert.deepEqual(viewer.map((r) => r.map((b) => b.text)), [['🔍 A', '🔍 B'], ['🔍 C'], ['⭐ Add all to my watchlist']]);
  assert.equal(cb(viewer[2]![0])?.address, 'abc123');
  const viewerPaged = sharedWatchlistKeyboard(entries, 'abc123', 1, 2).reply_markup.inline_keyboard;
  assert.deepEqual(viewerPaged[2]!.map((b) => b.text), ['◀', '1/2', '▶']);
  assert.deepEqual([cb(viewerPaged[2]![2])?.action, cb(viewerPaged[2]![2])?.address, cb(viewerPaged[2]![2])?.page], ['port_spage', 'abc123', 2]);
});

test('renderWatchlistShare：带主人名字，不含 since add，附合约地址；inline 版超出第一页提示 Open in Sonar', () => {
  const rows = [{ entry: { ...PEPE, addedAt: 0 }, priceUsd: 0.000012, sinceAddedPct: 20, change24hPct: -5.1, marketCapUsd: 5e9 }];
  const html = renderWatchlistShare('@hakeen', pageOf(rows));
  assert.match(html, /⭐ <b><u>@hakeen's Watchlist<\/u><\/b>  1 token\n\n/);
  assert.match(html, /<b>PEPE<\/b> · Ethereum\n├ \$0\.0₄1200 · MC \$5\.0B · 🔴 -5\.1% 24h\n└ <code>0x6982508145454CE325DDBE47A25D4EC3D2311933<\/code>/); // 夹具地址未经 add 归一，保持原样
  assert.doesNotMatch(html, /since add|add ·/);
  const inline = renderWatchlistShare('@hakeen', pageOf(rows, { pages: 3, total: 47 }), { inline: true });
  assert.match(inline, /47 tokens\n/);
  assert.doesNotMatch(inline, /page 1\/3/);
  assert.match(inline, /<i>\+46 more · Open in Sonar to see all<\/i>/);
  const deep = renderWatchlistShare('@hakeen', pageOf(rows, { page: 2, pages: 3, total: 47 }));
  assert.match(deep, /47 tokens · page 2\/3/);
  assert.doesNotMatch(deep, /more · Open/);
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
