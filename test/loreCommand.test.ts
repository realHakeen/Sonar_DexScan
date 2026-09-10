import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { runLoreCommand } from '../src/bot/handlers/lore.js';

/** 最小假 ctx：reply 返回占位消息，editMessageText 记录调用。 */
function fakeCtx(forToken: () => Promise<unknown>) {
  const edits: string[] = [];
  const ctx = {
    chat: { id: -100 },
    message: { message_id: 1 },
    from: { id: 7 },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    reply: async () => ({ message_id: 2 }),
    replyWithPhoto: async () => ({ message_id: 3 }),
    telegram: { editMessageText: async (_c: number, _m: number, _i: undefined, text: string) => (edits.push(text), true), deleteMessage: async () => true },
    services: {
      lore: { enabled: true, forToken },
      cmc: { dex: { search: async () => [] } },
      scan: { scanByAddress: async () => ({ primary: { networkSlug: 'solana', address: 'JE3H' } }) },
      search: { searchByName: async () => [] },
      stats: { record() {} },
    },
  };
  return { ctx: ctx as never, edits };
}

test('/lore：占位消息发出后 handler 立即返回，生成在后台完成后再编辑占位消息（不受 handlerTimeout 影响）', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { ctx, edits } = fakeCtx(async () => {
    await gate;
    return { symbol: 'PENIS', name: 'Peniscoin', networkSlug: 'solana', address: 'JE3H', text: 'A Solana memecoin.', sources: ['skill'], links: {}, cached: false };
  });
  const t0 = Date.now();
  await runLoreCommand(ctx, 'JE3HT7SbCgXDQWV6xp3oiiAisDzq4HyZ8wyEVBDCs45Z');
  assert.ok(Date.now() - t0 < 500, 'handler 不等生成');
  assert.equal(edits.length, 0);
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(edits.length, 1);
  assert.match(edits[0]!, /<b>PENIS<\/b> · Peniscoin · Solana\n\nA Solana memecoin\./);
});

test('/lore：后台生成抛错时编辑占位消息为用户可读文案，不向上抛', async () => {
  const { ctx, edits } = fakeCtx(async () => {
    throw new Error('gemini 503');
  });
  await runLoreCommand(ctx, 'JE3HT7SbCgXDQWV6xp3oiiAisDzq4HyZ8wyEVBDCs45Z');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(edits, ['❌ Something went wrong. Please try again later.']);
});
