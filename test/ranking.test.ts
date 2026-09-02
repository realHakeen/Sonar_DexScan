import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { rankCandidates, splitByChain } from '../src/domain/ranking.js';
import type { TokenCandidate } from '../src/domain/types.js';

function make(p: Partial<TokenCandidate>): TokenCandidate {
  return {
    name: 'X',
    symbol: 'PEPE',
    networkSlug: 'ethereum',
    address: '0x' + Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40),
    raw: {},
    ...p,
  };
}

test('流动性是第一权重，空池仿盘排在后面', () => {
  const real = make({ liquidityUsd: 5_000_000, volume24hUsd: 2_000_000, cmcId: 24478, traders24h: 8000 });
  const fake = make({ liquidityUsd: 120, volume24hUsd: 0 });
  const ranked = rankCandidates([fake, real], 'PEPE');
  assert.equal(ranked[0]?.candidate.address, real.address);
});

test('CMC 官方收录的合约被置顶', () => {
  const listed = make({ liquidityUsd: 100_000, officialVerified: true });
  const bigger = make({ liquidityUsd: 400_000 });
  const ranked = rankCandidates([bigger, listed], 'PEPE');
  assert.equal(ranked[0]?.candidate.officialVerified, true);
});

test('成交量高但交易人数极少会被判为刷量并扣分', () => {
  const wash = make({ liquidityUsd: 200_000, volume24hUsd: 10_000_000, traders24h: 3 });
  const scored = rankCandidates([wash], 'PEPE')[0];
  assert.ok((scored?.breakdown['washTradePenalty'] ?? 0) < 0);
});

test('同链同地址去重，保留流动性更高的一条', () => {
  const addr = '0x' + '1'.repeat(40);
  const ranked = rankCandidates(
    [make({ address: addr, liquidityUsd: 100 }), make({ address: addr, liquidityUsd: 900 })],
    'PEPE',
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.candidate.liquidityUsd, 900);
});

test('多链命中按流动性降序取主链，次链不丢弃', () => {
  const eth = make({ networkSlug: 'ethereum', liquidityUsd: 10_000 });
  const bnb = make({ networkSlug: 'bnb', liquidityUsd: 900_000 });
  const { primary, secondary } = splitByChain([eth, bnb]);
  assert.equal(primary?.networkSlug, 'bnb');
  assert.equal(secondary[0]?.networkSlug, 'ethereum');
});

test('CMC 排名进入打分：同等流动性下排名靠前者胜', () => {
  const ranked = rankCandidates(
    [make({ liquidityUsd: 100_000, cmcRank: 5000 }), make({ liquidityUsd: 100_000, cmcRank: 50 })],
    'X',
  );
  assert.equal(ranked[0]?.candidate.cmcRank, 50);
});
