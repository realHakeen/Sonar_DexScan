import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { concentrationFromHolders, tagDistributionFromHolders } from '../src/domain/holders.js';
import type { HolderEntry } from '../src/domain/types.js';

const entry = (percent: number | undefined, tags: string[] = [], balance?: number): HolderEntry => ({
  percent,
  tags,
  balance,
  raw: {},
});

test('按 percent 累加 Top10/50/100；不足 50 条时 top50 为 undefined', () => {
  const list = Array.from({ length: 20 }, (_, i) => entry(10 - i * 0.4));
  const c = concentrationFromHolders(list);
  assert.equal(c.top10Pct, 82);
  assert.equal(c.top50Pct, undefined);
});

test('percent 已是百分比单位，0.5% 的小户不会被误放大', () => {
  const list = Array.from({ length: 10 }, () => entry(0.5));
  assert.equal(concentrationFromHolders(list).top10Pct, 5);
});

test('无 percent 时用 balance 相对占比估算', () => {
  const list = Array.from({ length: 10 }, (_, i) => entry(undefined, [], i === 0 ? 900 : 100 / 9));
  const c = concentrationFromHolders(list);
  assert.ok(c.top10Pct !== undefined && Math.abs(c.top10Pct - 100) < 0.01);
});

test('从持有人列表的 tags 统计标签分布', () => {
  const t = tagDistributionFromHolders([
    entry(1, ['tag_whale', 'tag_smart_money']),
    entry(1, ['tag_sniper']),
    entry(1, ['tag_whale']),
  ]);
  assert.equal(t?.whale, 2);
  assert.equal(t?.smartMoney, 1);
  assert.equal(t?.sniper, 1);
  assert.equal(t?.dev, undefined);
});

test('空列表不产生任何数据', () => {
  assert.deepEqual(concentrationFromHolders([]), {});
  assert.equal(tagDistributionFromHolders([]), undefined);
});
