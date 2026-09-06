import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { openMemoryDatabase } from '../src/infra/db.js';
import { StatsService } from '../src/services/statsService.js';
import { renderStatsPng, renderStatsSvg, renderStatsText } from '../src/render/stats.js';
import { creditMeter } from '../src/infra/creditMeter.js';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000; // 固定"现在"，UTC 日边界可预期
const dayStart = Math.floor(NOW / DAY) * DAY;

function seed(svc: StatsService) {
  // 昨天：用户 1、2、3、4、5 首次出现（各扫 1 次），群 -100 活跃
  for (const u of [1, 2, 3, 4, 5]) svc.record({ kind: 'scan', userId: u, chatId: -1001, chatType: 'supergroup', trigger: 'address', token: 'bnb:A', elapsedMs: 2000, degraded: false, ts: dayStart - DAY + 1000 });
  // 今天：1、2 回来了（留存 40%），新用户 6 在私聊，7 天前的用户 9 今天也回来
  svc.record({ kind: 'scan', userId: 1, chatId: -1001, chatType: 'supergroup', trigger: 'cashtag', token: 'bnb:A', elapsedMs: 3000, degraded: true, ts: dayStart + 1000 });
  svc.record({ kind: 'scan', userId: 2, chatId: -1002, chatType: 'group', trigger: 'link', token: 'sol:B', elapsedMs: 1000, degraded: false, ts: dayStart + 2000 });
  svc.record({ kind: 'scan', userId: 6, chatId: 6, chatType: 'private', trigger: 'command', token: 'bnb:A', elapsedMs: 1500, degraded: false, ts: dayStart + 3000 });
  svc.record({ kind: 'watch_add', userId: 6, chatId: 6, chatType: 'private', token: 'bnb:A', ts: dayStart + 3500 });
  svc.record({ kind: 'share', userId: 6, ts: dayStart + 4000 });
  svc.record({ kind: 'share_open', userId: 7, chatId: 7, chatType: 'private', ts: dayStart + 5000 });
  svc.record({ kind: 'perp', userId: 1, chatId: -1001, chatType: 'supergroup', trigger: 'button', token: 'A', ts: dayStart + 6000 });
  svc.record({ kind: 'ratelimited', userId: 3, chatId: -1001, chatType: 'supergroup', ts: dayStart + 7000 });
  for (const u of [9, 10, 11, 12, 13]) svc.record({ kind: 'scan', userId: u, chatId: u, chatType: 'private', trigger: 'address', ts: dayStart - 7 * DAY + 100 });
  svc.record({ kind: 'scan', userId: 9, chatId: 9, chatType: 'private', trigger: 'address', ts: dayStart + 8000 });
  svc.groupChange(-1001, 'added', { title: 'Alpha', ts: dayStart - 10 * DAY });
  svc.groupChange(-1002, 'added', { title: 'Beta', ts: dayStart + 100 });
  svc.groupChange(-1003, 'added', { title: 'Gone', ts: dayStart - 3 * DAY });
  svc.groupChange(-1003, 'removed', { ts: dayStart - DAY });
}

test('snapshot：DAU / 新用户 / 群 / 扫描触发方式 / 功能计数 / 健康 / 留存 / 日序列', () => {
  const svc = new StatsService(openMemoryDatabase());
  seed(svc);
  const s = svc.snapshot(NOW);
  // 今天活跃：1、2、6、7、3(限流事件)、9、1(perp) → 去重 1,2,3,6,7,9 = 6
  assert.equal(s.today.users, 6);
  assert.equal(s.today.groups, 2);
  assert.equal(s.today.newUsers, 2); // 6 和 7
  assert.equal(s.today.newGroups, 1); // Beta
  assert.equal(s.today.scans, 4);
  assert.deepEqual(s.today.triggers, { cashtag: 1, link: 1, command: 1, address: 1 });
  assert.equal(s.today.watchAdds, 1);
  assert.equal(s.today.shares, 1);
  assert.equal(s.today.shareOpens, 1);
  assert.equal(s.today.perpButtons, 1);
  assert.equal(s.today.rateLimited, 1);
  assert.equal(s.today.avgElapsedMs, Math.round((3000 + 1000 + 1500) / 3));
  assert.ok(Math.abs(s.today.degradedRate! - 1 / 3) < 1e-9);
  assert.equal(s.d7.users, 8); // 1..6, 7, 9 （9 今天回来）
  assert.equal(s.d30.scans, 4 + 5 + 5); // 今天 4（含 9 的回访）+ 昨天 5 + 7 天前 5
  assert.equal(s.groupsTotal, 2);
  assert.ok(Math.abs(s.retentionD1! - 0.6) < 1e-9); // 1,2 回来扫描 + 3 被限流也算活跃 / 1..5
  assert.ok(Math.abs(s.retentionD7! - 0.2) < 1e-9); // 9 / 9..13
  assert.equal(s.daily.length, 30);
  assert.deepEqual(s.daily.at(-1), { day: Math.floor(NOW / DAY), users: 6, scans: 4 });
  assert.deepEqual(s.daily.at(-2), { day: Math.floor(NOW / DAY) - 1, users: 5, scans: 5 });
  assert.deepEqual(s.topTokens[0], { token: 'bnb:A', scans: 7 });
  assert.equal(s.topGroups[0]?.title, 'Alpha');
  svc.close();
});

test('credits：客户端计量通过 creditMeter 按日累加', () => {
  const svc = new StatsService(openMemoryDatabase());
  creditMeter.add(9);
  creditMeter.add(3);
  creditMeter.add(undefined);
  const s = svc.snapshot();
  assert.equal(s.today.credits, 12);
  svc.close();
  creditMeter.add(100); // 已退订，不再计入
  assert.equal(svc.snapshot().today.credits, 12);
});

test('renderStatsText / Svg / Png', () => {
  const svc = new StatsService(openMemoryDatabase());
  seed(svc);
  const s = svc.snapshot(NOW);
  const text = renderStatsText(s, 2_000_000);
  assert.match(text, /📊 <b><u>Stats<\/u><\/b>  today · 7d · 30d \(UTC\)/);
  assert.match(text, /Users\s*<\/code> 6 · 8 · 12/);
  assert.match(text, /Groups\s*<\/code> 2 · 2 · 2  \(in 2\)/);
  assert.match(text, /Retain\s*<\/code> D1 60% · D7 20%/);
  assert.match(text, /Share\s*<\/code> 1 → opened 1 → copied 0 \(30d\)/);
  assert.match(text, /Top 7d: A 7/);
  assert.ok(text.length < 1024, 'caption 上限 1024');
  const svg = renderStatsSvg(s);
  assert.match(svg, /Watchlist share funnel/);
  assert.match(svg, /<polyline/);
  const png = renderStatsPng(s);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  svc.close();
});
