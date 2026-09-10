import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { openMemoryDatabase } from '../src/infra/db.js';
import { PortfolioService } from '../src/services/portfolioService.js';
import { handlePortfolioAdd, sendPortfolio } from '../src/bot/handlers/portfolio.js';
import type { CmcGateway } from '../src/api/cmc/index.js';

/** 群里点 ⭐ → 私聊 /watchlist：同一个用户 id，列表里必须有刚加的币。 */
test('群里点 ⭐ Watchlist 后，私聊 /watchlist 能看到这个币', async () => {
  const gw = {
    core: { quotesBatch: async () => new Map() },
    dex: { tokenDetail: async () => ({ candidate: { symbol: 'PENIS', name: 'Peniscoin', networkSlug: 'solana', address: 'JE3H', priceUsd: 0.001, fdvUsd: 1e6, raw: {} }, pools: [] }), search: async () => [] },
  } as unknown as CmcGateway;
  const portfolio = new PortfolioService(openMemoryDatabase(), gw);
  const toasts: string[] = [];
  const groupCtx = {
    chat: { id: -100, type: 'supergroup' },
    from: { id: 759436357 },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    answerCbQuery: async (t: string) => (toasts.push(t), true),
    services: { portfolio, cmc: gw, index: { byCmcId: () => undefined }, stats: { record() {} } },
  };
  await handlePortfolioAdd(groupCtx as never, { networkSlug: 'solana', address: 'JE3H', symbol: 'PENIS' }, 57000);
  assert.match(toasts[0]!, /Added PENIS to your watchlist/);
  assert.equal(portfolio.size(759436357), 1);

  const sent: string[] = [];
  const dmCtx = {
    chat: { id: 759436357, type: 'private' },
    from: { id: 759436357 },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    reply: async (t: string) => (sent.push(t), { message_id: 1 }),
    services: { portfolio, cmc: gw, stats: { record() {} } },
  };
  await sendPortfolio(dmCtx as never);
  assert.match(sent[0]!, /Watchlist<\/u><\/b>  1 token/);
  assert.match(sent[0]!, /<b>PENIS<\/b> · Solana/);

  // 群里发 /watchlist：发到私聊；私聊发不出去（没 /start 过）时提示先私聊
  const groupCmdCtx = {
    ...dmCtx,
    chat: { id: -100, type: 'supergroup' },
    message: { message_id: 9 },
    botInfo: { username: 'dexscan_sonar_bot' },
    telegram: { sendMessage: async () => { throw new Error('403: Forbidden: bot can\'t initiate conversation with a user'); } },
  };
  await sendPortfolio(groupCmdCtx as never);
  assert.match(sent.at(-1)!, /Open a private chat with @dexscan_sonar_bot and send \/start first/);
});
