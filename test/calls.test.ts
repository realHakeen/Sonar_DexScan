import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { crossedMilestone, formatCallAge, formatMultiple, messageLink } from '../src/domain/calls.js';
import { openMemoryDatabase } from '../src/infra/db.js';
import { CallService } from '../src/services/callService.js';
import { renderBannerPng, renderBannerSvg } from '../src/render/banner.js';
import { renderScanCard } from '../src/render/card.js';
import type { TokenReport } from '../src/domain/types.js';

test('crossedMilestone：只报本次新跨过的最高档，已播过的不重复', () => {
  assert.equal(crossedMilestone(1.8, 0), undefined);
  assert.equal(crossedMilestone(2.1, 0), undefined); // 3x 以下不播
  assert.equal(crossedMilestone(3.4, 0), 3);
  assert.equal(crossedMilestone(5.2, 0), 5);
  assert.equal(crossedMilestone(12, 5), 10); // 跳过中间档只报最高的新档
  assert.equal(crossedMilestone(7, 5), undefined);
  assert.equal(crossedMilestone(120, 50), 100);
  assert.equal(crossedMilestone(0.5, 0), undefined);
});

test('formatCallAge / formatMultiple / messageLink', () => {
  const now = 1_000_000_000_000;
  assert.equal(formatCallAge(now - 30_000, now), 'now');
  assert.equal(formatCallAge(now - 12 * 60_000, now), '12m');
  assert.equal(formatCallAge(now - (3 * 60 + 20) * 60_000, now), '3h 20m');
  assert.equal(formatCallAge(now - (37 * 24 + 1) * 3_600_000, now), '37d 1h');
  assert.equal(formatMultiple(10.46), '10.5x');
  assert.equal(formatMultiple(0.42), '0.4x');
  assert.equal(formatMultiple(123.4), '123x');
  assert.equal(messageLink(-1001234567890, 42), 'https://t.me/c/1234567890/42');
  assert.equal(messageLink(-123456, 42), undefined); // 普通群没有链接
  assert.equal(messageLink(-1001234567890, undefined), undefined);
});

const token = { networkSlug: 'bnb', address: '0xFE189E97832DA1573E4E4FF034F4FFC3A15C7777', symbol: 'MARSCOIN' };
const caller = { userId: 9, username: 'aaronseaemcee', displayName: 'Aaron' };

test('CallService：首次创建、后续算倍数与峰值、里程碑 3x 起每档只播一次、按钮回调不创建', () => {
  const svc = new CallService(openMemoryDatabase());
  const t0 = 1_700_000_000_000;
  // 按钮回调（无 caller）不创建
  assert.equal(svc.track({ chatId: -1001, token, mcapUsd: 21.5e6, mcapKind: 'mc', now: t0 }), undefined);
  const first = svc.track({ chatId: -1001, token, mcapUsd: 21.5e6, mcapKind: 'mc', caller, messageId: 77, now: t0 })!;
  assert.equal(first.summary.isNew, true);
  assert.equal(first.summary.multiple, 1);
  assert.equal(first.summary.messageUrl, 'https://t.me/c/1/77');
  assert.equal(first.milestone, undefined);

  const second = svc.track({ chatId: -1001, token: { ...token, address: token.address.toLowerCase() }, mcapUsd: 48e6, mcapKind: 'mc', now: t0 + 3_600_000 })!;
  assert.equal(second.summary.isNew, false);
  assert.ok(Math.abs(second.summary.multiple - 48 / 21.5) < 1e-9);
  assert.equal(second.milestone, undefined); // 2.2x，3x 以下不播
  assert.equal(second.callMessageId, 77);

  const third = svc.track({ chatId: -1001, token, mcapUsd: 120e6, mcapKind: 'mc', now: t0 + 7_200_000 })!;
  assert.equal(third.milestone, 5); // 5.6x
  const fourth = svc.track({ chatId: -1001, token, mcapUsd: 224e6, mcapKind: 'mc', now: t0 + 9_000_000 })!;
  assert.equal(fourth.milestone, 10);
  assert.ok(Math.abs(fourth.summary.peakMultiple - 224 / 21.5) < 1e-9);
  const drop = svc.track({ chatId: -1001, token, mcapUsd: 100e6, mcapKind: 'mc', now: t0 + 10_000_000 })!;
  assert.ok(Math.abs(drop.summary.peakMultiple - 224 / 21.5) < 1e-9); // 峰值不回退
  assert.equal(drop.milestone, undefined);

  // 口径不同（这次只有 FDV）：不算倍数也不播
  const fdv = svc.track({ chatId: -1001, token, mcapUsd: 999e6, mcapKind: 'fdv', now: t0 + 11_000_000 })!;
  assert.ok(Number.isNaN(fdv.summary.multiple));
  assert.equal(fdv.milestone, undefined);

  // 另一个群互不影响
  assert.equal(svc.track({ chatId: -1002, token, mcapUsd: 1e6, mcapKind: 'mc', now: t0 }), undefined);
});

test('renderBannerSvg / Png：文字进图，输出 PNG', () => {
  const svg = renderBannerSvg({ symbol: 'marscoin', multiple: 10.42, calledMcapUsd: 21.53e6, calledAt: Date.now() - 37 * 24 * 3_600_000, callerName: 'aaronseaemcee' });
  assert.match(svg, /\$MARSCOIN/);
  assert.match(svg, />10\.4x</);
  assert.match(svg, /Called at \$21\.5M/);
  assert.match(svg, /aaronseaemcee/);
  const png = renderBannerPng({ symbol: 'X', multiple: 2, calledMcapUsd: 1e6, calledAt: Date.now(), callerName: 'a' });
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.ok(png.length > 10_000);
});

test('卡片 call 行：用户名链接 · 市值 · 倍数 · 时长 · 🔼', () => {
  const report: TokenReport = {
    primary: { name: 'MarsCoin', symbol: 'MARSCOIN', networkSlug: 'bnb', address: '0x' + 'a'.repeat(40), raw: {} },
    secondaryDeployments: [], pools: [], risks: [], degraded: [], generatedAt: 0,
    call: { displayName: 'Aaron', username: 'aaronseaemcee', messageUrl: 'https://t.me/c/1/77', calledAt: Date.now() - 37 * 24 * 3_600_000 - 3_600_000, mcapUsd: 21.53e6, mcapKind: 'mc', multiple: 10.46, peakMultiple: 12, isNew: false },
  };
  const html = renderScanCard(report);
  assert.match(html, /🚀 <a href="https:\/\/t\.me\/aaronseaemcee">aaronseaemcee<\/a> @ \$21\.5M \[10\.5x\] \(37d 1h ago\) <a href="https:\/\/t\.me\/c\/1\/77">🔼<\/a>/);
  const fresh = renderScanCard({ ...report, call: { ...report.call!, isNew: true, multiple: 1, username: undefined, messageUrl: undefined } });
  assert.match(fresh, /\n\n🚀 <b>Aaron<\/b> @ \$21\.5M \[1\.0x\] \(now\)$/);
  const justNow = renderScanCard({ ...report, call: { ...report.call!, isNew: false, calledAt: Date.now() - 20_000, multiple: 1 } });
  assert.match(justNow, /\[1\.0x\] \(now\)/, '一分钟内不写 "now ago"');
  assert.ok(html.indexOf('🚀') > html.indexOf('<code>0x'), 'call 行在合约地址之后（卡片尾部）');
});
