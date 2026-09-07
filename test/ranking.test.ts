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

test('$AGI：ticker 精确命中且 CMC 收录（#816）的 Delysium 压过流动性更高的前缀匹配 AGIX', () => {
  const delysium = make({ symbol: 'AGI', name: 'Delysium', liquidityUsd: 10_000, volume24hUsd: 0, cmcId: 24007, cmcRank: 816, officialVerified: true });
  const agix = make({ symbol: 'AGIX', name: 'SingularityNET', liquidityUsd: 250_000, volume24hUsd: 7_000, traders24h: 55, cmcId: 2424, cmcRank: 4668, officialVerified: true });
  const agialpha = make({ symbol: 'AGIALPHA', liquidityUsd: 60_000, cmcId: 35482, cmcRank: 2534, officialVerified: true });
  const ranked = rankCandidates([agix, agialpha, delysium], 'AGI');
  assert.equal(ranked[0]?.candidate.symbol, 'AGI');
  assert.ok((ranked[0]?.breakdown['listedTicker'] ?? 0) > 0);
  assert.ok((ranked[1]?.breakdown['symbolMismatch'] ?? 0) < 0);
});

test('没有精确 symbol 候选时（按名称搜 Teller → DEBIT）不扣 symbol 不一致分', () => {
  const debit = make({ symbol: 'DEBIT', name: 'Teller', liquidityUsd: 100_000 });
  const ranked = rankCandidates([debit], 'Teller');
  assert.equal(ranked[0]?.breakdown['symbolMismatch'], undefined);
});

test('未收录 / 排名靠后的精确 symbol 候选没有 listedTicker 加成', () => {
  const frog = make({ symbol: 'AGI', name: 'AGI Frog', liquidityUsd: 800_000 });
  const deep = make({ symbol: 'AGI', name: 'AGI deep', liquidityUsd: 800_000, officialVerified: true, cmcRank: 5000 });
  for (const s of rankCandidates([frog, deep], 'AGI')) assert.equal(s.breakdown['listedTicker'], undefined);
});

test('ticker 精确匹配是硬性第一档：流动性再大的前缀匹配也排在精确匹配后面', () => {
  const tiny = make({ symbol: 'AGI', name: 'AGI', liquidityUsd: 3_000 });
  const huge = make({ symbol: 'AGIX', name: 'SingularityNET', liquidityUsd: 50_000_000, volume24hUsd: 5_000_000, traders24h: 9000, cmcId: 2424, cmcRank: 200, officialVerified: true });
  const ranked = rankCandidates([huge, tiny], 'AGI');
  assert.equal(ranked[0]?.candidate.symbol, 'AGI');
  assert.equal(ranked[1]?.candidate.symbol, 'AGIX');
});
