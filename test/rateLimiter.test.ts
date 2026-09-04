import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { RateLimiter } from '../src/infra/rateLimiter.js';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

test('群聊：冷却期内的请求排队而不是丢弃，槽位按冷却间隔顺序分配', () => {
  const c = clock();
  const rl = new RateLimiter(60_000, c.now);
  assert.deepEqual(rl.reserve('chat:1', 6, 3000), { delayMs: 0 });
  c.tick(500);
  assert.deepEqual(rl.reserve('chat:1', 6, 3000), { delayMs: 2500 }); // 第 2 个排在第 1 个 +3s
  c.tick(500);
  assert.deepEqual(rl.reserve('chat:1', 6, 3000), { delayMs: 5000 }); // 第 3 个排在第 2 个 +3s
});

test('冷却结束后再来的请求立即执行', () => {
  const c = clock();
  const rl = new RateLimiter(60_000, c.now);
  rl.reserve('chat:1', 6, 3000);
  c.tick(10_000);
  assert.deepEqual(rl.reserve('chat:1', 6, 3000), { delayMs: 0 });
});

test('窗口内槽位用完才丢弃，并给出重试等待时间', () => {
  const c = clock();
  const rl = new RateLimiter(60_000, c.now);
  for (let i = 0; i < 6; i++) assert.ok(rl.reserve('chat:1', 6, 3000).delayMs !== undefined);
  const r = rl.reserve('chat:1', 6, 3000);
  assert.equal(r.delayMs, undefined);
  assert.equal(r.delayMs === undefined && r.retryAfterMs, 60_000);
  c.tick(60_000);
  assert.deepEqual(rl.reserve('chat:1', 6, 3000), { delayMs: 0 });
});

test('私聊无冷却：窗口内每次都立即执行；不同 key 互不影响', () => {
  const c = clock();
  const rl = new RateLimiter(60_000, c.now);
  for (let i = 0; i < 20; i++) assert.deepEqual(rl.reserve('user:1', 20, 0), { delayMs: 0 });
  assert.equal(rl.reserve('user:1', 20, 0).delayMs, undefined);
  assert.deepEqual(rl.reserve('user:2', 20, 0), { delayMs: 0 });
  assert.deepEqual(rl.reserve('chat:9', 6, 3000), { delayMs: 0 });
});

test('sweep 回收过期窗口后 key 从头计数', () => {
  const c = clock();
  const rl = new RateLimiter(60_000, c.now);
  for (let i = 0; i < 6; i++) rl.reserve('chat:1', 6, 3000);
  c.tick(61_000);
  rl.sweep();
  assert.deepEqual(rl.reserve('chat:1', 6, 3000), { delayMs: 0 });
});
