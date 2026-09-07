import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CoinIndex } from '../src/domain/coinIndex.js';
import { markOfficialContracts } from '../src/domain/verification.js';
import type { TokenCandidate } from '../src/domain/types.js';

function make(p: Partial<TokenCandidate>): TokenCandidate {
  return { name: 'X', symbol: 'AGI', networkSlug: 'bnb', address: '0xabc', raw: {}, ...p };
}

test('map 只有 Ethereum 合约：BSC 版靠 DEX 记录自带的 cid + symbol 一致认定为官方合约；cid 对不上 symbol 的不算', async () => {
  const idx = new CoinIndex();
  idx.load([
    { id: 24007, name: 'Delysium', symbol: 'AGI', slug: 'delysium', rank: 816, platform: { id: 1, name: 'Ethereum', symbol: 'ETH', slug: 'ethereum', token_address: '0x7dA2641000Cbb407C329310C461b2cB9c70C3046' } },
  ] as never);
  const eth = make({ networkSlug: 'ethereum', address: '0x7da2641000cbb407c329310c461b2cb9c70c3046' });
  const bsc = make({ address: '0x818835503f55283cd51a4399f595e295a9338753', cmcId: 24007 });
  const wrongSymbol = make({ symbol: 'AGIX', address: '0x999', cmcId: 24007 });
  const noCid = make({ address: '0x888' });
  const [a, b, c, d] = await markOfficialContracts({} as never, [eth, bsc, wrongSymbol, noCid], idx);
  assert.equal(a?.officialVerified, true);
  assert.equal(a?.cmcId, 24007);
  assert.equal(b?.officialVerified, true);
  assert.equal(b?.cmcRank, 816);
  assert.equal(c?.officialVerified, undefined);
  assert.equal(d?.officialVerified, undefined);
});
