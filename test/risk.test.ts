import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { evaluateRisks, overallRisk } from '../src/domain/risk.js';
import type { TokenCandidate } from '../src/domain/types.js';

const base: TokenCandidate = {
  name: 'Token',
  symbol: 'TKN',
  networkSlug: 'ethereum',
  address: '0x' + '1'.repeat(40),
  liquidityUsd: 500_000,
  cmcId: 1,
  raw: {},
};

test('蜜罐是 danger 级', () => {
  const flags = evaluateRisks({
    primary: base,
    secondaryDeployments: [],
    security: { isHoneypot: true, extra: {}, provider: 'GoPlus' },
    pools: [],
  });
  assert.equal(overallRisk(flags), 'danger');
});

test('Top10 集中度超阈值触发提示', () => {
  const flags = evaluateRisks({
    primary: base,
    secondaryDeployments: [],
    holders: { top10Pct: 72 },
    pools: [],
  });
  assert.ok(flags.some((f) => f.code === 'top10_concentration'));
});

test('单一 LP 占比过高触发提示', () => {
  const flags = evaluateRisks({
    primary: base,
    secondaryDeployments: [],
    pools: [
      { dexName: 'Uniswap V3', liquidityUsd: 950_000 },
      { dexName: 'Sushi', liquidityUsd: 50_000 },
    ],
  });
  assert.ok(flags.some((f) => f.code === 'single_lp'));
});

test('只有一个池子时不判单一 LP（无从比较）', () => {
  const flags = evaluateRisks({
    primary: base,
    secondaryDeployments: [],
    pools: [{ dexName: 'Uniswap V3', liquidityUsd: 950_000 }],
  });
  assert.ok(!flags.some((f) => f.code === 'single_lp'));
});

test('多链同地址给出残留/仿冒提示', () => {
  const flags = evaluateRisks({
    primary: base,
    secondaryDeployments: [{ ...base, networkSlug: 'bnb', liquidityUsd: 1200 }],
    pools: [],
  });
  const flag = flags.find((f) => f.code === 'multi_chain');
  assert.ok(flag?.message.includes('BNB Chain'));
});

test('官方安全字段：cannot_sell_all / self_destruct / hidden_owner 为 danger，未开源为 warn', () => {
  const flags = evaluateRisks({
    primary: base,
    secondaryDeployments: [],
    security: { cannotSellAll: true, selfDestruct: true, hiddenOwner: true, openSource: false, extra: {}, provider: 'GoPlus' },
    pools: [],
  });
  const codes = flags.map((f) => f.code);
  assert.ok(codes.includes('cannot_sell_all'));
  assert.ok(codes.includes('self_destruct'));
  assert.ok(codes.includes('hidden_owner'));
  assert.ok(codes.includes('closed_source'));
  assert.equal(overallRisk(flags), 'danger');
});

test('成交量远超流动性且人均成交额异常 → 刷量提示', () => {
  const flags = evaluateRisks({
    primary: { ...base, volume24hUsd: 176_000_000, liquidityUsd: 1_990_000, traders24h: 1400 },
    secondaryDeployments: [],
    pools: [],
  });
  assert.ok(flags.some((f) => f.code === 'wash_trade'));
});

test('正常盘：成交量 / 流动性比例低不触发刷量', () => {
  const flags = evaluateRisks({
    primary: { ...base, volume24hUsd: 700_000, liquidityUsd: 28_000_000, traders24h: 285 },
    secondaryDeployments: [],
    pools: [],
  });
  assert.ok(!flags.some((f) => f.code === 'wash_trade'));
});

test('Top10 超过 80% 是 danger 且图标一致', () => {
  const flags = evaluateRisks({ primary: base, secondaryDeployments: [], holders: { top10Pct: 98.3 }, pools: [] });
  const f = flags.find((x) => x.code === 'top10_concentration');
  assert.equal(f?.level, 'danger');
  assert.ok(f?.message.startsWith('🚨'));
});
