import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CoinIndex } from '../src/domain/coinIndex.js';

const index = new CoinIndex();
index.load([
  { id: 41911, name: 'Teller', symbol: 'DEBIT', slug: 'teller', rank: 467, platform: { name: 'BNB Smart Chain (BEP20)', token_address: '0x66661c7229901f568f16bd1551b3ba826f83ce49' } },
  { id: 24478, name: 'Pepe', symbol: 'PEPE', slug: 'pepe', rank: 49, platform: { name: 'Ethereum', token_address: '0x6982508145454ce325ddbe47a25d4ec3d2311933' } },
  { id: 1, name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', rank: 1, platform: null },
  { id: 99, name: 'Pepe Classic', symbol: 'PEPEC', slug: 'pepe-classic', rank: 3000, platform: { name: 'Ethereum', token_address: '0xpepec' } },
]);

test('名称精确命中：搜 "Teller" 得到 symbol 为 DEBIT 的正主', () => {
  const hits = index.lookup('Teller');
  assert.equal(hits[0]?.symbol, 'DEBIT');
  assert.equal(hits[0]?.networkSlug, 'bnb');
  assert.equal(hits[0]?.address, '0x66661c7229901f568f16bd1551b3ba826f83ce49');
});

test('symbol / slug 也能命中，且按 CMC 排名排序', () => {
  assert.equal(index.lookup('debit')[0]?.cmcId, 41911);
  assert.equal(index.lookup('pepe')[0]?.cmcId, 24478);
  const pepes = index.lookup('pepe');
  assert.deepEqual(pepes.map((h) => h.cmcId), [24478, 99]);
});

test('没有合约地址的原生币不进结果', () => {
  assert.equal(index.lookup('Bitcoin').length, 0);
});

test('地址反查（正版识别）', () => {
  assert.equal(index.byContract('0x6982508145454CE325DDBE47A25D4EC3D2311933')?.cmcId, 24478);
  assert.equal(index.byContract('0xnope'), undefined);
});

test('过短查询返回空', () => {
  assert.equal(index.lookup('p').length, 0);
});
