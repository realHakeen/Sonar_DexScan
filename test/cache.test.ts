import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TtlCache } from '../src/infra/cache.js';

test('TtlCache.wrap：shouldCache 为 false 的结果不落缓存，下次重新加载', async () => {
  const cache = new TtlCache<string | null>(60_000);
  let calls = 0;
  const loader = async () => (++calls === 1 ? null : 'ok');
  const first = await cache.wrap('k', loader, 60_000, (v) => v !== null);
  const second = await cache.wrap('k', loader, 60_000, (v) => v !== null);
  const third = await cache.wrap('k', loader, 60_000, (v) => v !== null);
  assert.equal(first, null);
  assert.equal(second, 'ok');
  assert.equal(third, 'ok');
  assert.equal(calls, 2, 'null 没被缓存，第二次重新加载；ok 被缓存，第三次不再加载');
});

test('TtlCache.wrap：并发同 key 只放行一个 loader', async () => {
  const cache = new TtlCache<number>(60_000);
  let calls = 0;
  const loader = () => new Promise<number>((r) => setTimeout(() => r(++calls), 10));
  const [a, b] = await Promise.all([cache.wrap('k', loader), cache.wrap('k', loader)]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(calls, 1);
});
