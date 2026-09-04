import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { extractCashtag, parseInput, parseMessage } from '../src/domain/inputParser.js';

const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

test('DexScan 链接直接解析出链和地址，零 API 消耗', () => {
  const r = parseInput(`https://dex.coinmarketcap.com/token/ethereum/${USDT}`);
  assert.equal(r.kind, 'address');
  assert.equal(r.kind === 'address' && r.chainSlug, 'ethereum');
  assert.equal(r.kind === 'address' && r.address, USDT);
  assert.equal(r.kind === 'address' && r.source, 'link');
});

test('DexScreener 的 chain id 映射到 CMC network_slug', () => {
  const r = parseInput(`https://dexscreener.com/bsc/${USDT}`);
  assert.equal(r.kind === 'address' && r.chainSlug, 'bnb');
});

test('区块浏览器链接按域名定链', () => {
  const r = parseInput(`看看这个 https://bscscan.com/token/${USDT} 怎么样`);
  assert.equal(r.kind === 'address' && r.chainSlug, 'bnb');
});

test('裸地址混在句子里也能提取', () => {
  const r = parseInput(`ca ${USDT} 冲不冲`);
  assert.equal(r.kind === 'address' && r.address, USDT);
});

test('$ 前缀的 ticker 当作名称搜索', () => {
  const r = parseInput('$PEPE');
  assert.equal(r.kind, 'query');
  assert.equal(r.kind === 'query' && r.query, 'PEPE');
});

test('长句子不当作查询，避免群里误触发', () => {
  assert.equal(parseInput('今天行情怎么样大家怎么看').kind, 'none');
});

test('$TICKER cashtag：单独或混在句子里都识别，并标记 explicit', () => {
  const a = parseInput('$marscoin');
  assert.equal(a.kind, 'query');
  assert.equal(a.kind === 'query' && a.query, 'marscoin');
  assert.equal(a.kind === 'query' && a.explicit, true);
  const b = parseInput('大家看看 $PEPE 怎么样');
  assert.equal(b.kind === 'query' && b.query, 'PEPE');
  assert.equal(b.kind === 'query' && b.explicit, true);
});

test('cashtag 不误判金额', () => {
  assert.equal(extractCashtag('US$100 million'), undefined);
  assert.equal(extractCashtag('costs $5'), undefined);
  assert.equal(extractCashtag('$1inch'), undefined, '首字符必须是字母');
});

const SOL = 'AMC1qwR9KhiyrQBRPrxnfo4JfMeMZqEBvt5tgTytNNoc';

test('text_link entity 里隐藏的 DexScreener 链接能被解析', () => {
  const r = parseMessage('GME · 10x\nDEX · DEF · GT', [
    { type: 'bold', offset: 0, length: 3 },
    { type: 'text_link', offset: 10, length: 3, url: 'https://x.com/share/abc' },
    { type: 'text_link', offset: 16, length: 3, url: `https://dexscreener.com/solana/${SOL}` },
  ]);
  assert.equal(r.kind, 'address');
  assert.equal(r.kind === 'address' && r.address, SOL);
  assert.equal(r.kind === 'address' && r.chainSlug, 'solana');
  assert.equal(r.kind === 'address' && r.source, 'link');
});

test('优先级：可见地址 > 隐藏链接地址 > 可见名称查询', () => {
  const hidden = [{ type: 'text_link', offset: 0, length: 2, url: `https://dexscreener.com/solana/${SOL}` }];
  const visibleWins = parseMessage(`ca ${USDT}`, hidden);
  assert.equal(visibleWins.kind === 'address' && visibleWins.address, USDT);
  const hiddenBeatsQuery = parseMessage('$PEPE', hidden);
  assert.equal(hiddenBeatsQuery.kind === 'address' && hiddenBeatsQuery.address, SOL);
  const noEntities = parseMessage('$PEPE', undefined);
  assert.equal(noEntities.kind === 'query' && noEntities.query, 'PEPE');
  assert.equal(parseMessage('what do you think', []).kind, 'none');
});

test('Birdshot 式 caption：地址与 DexScreener 链接混在长文里', () => {
  const caption = `#AMC\n✅ Now Verified on Moonshot\n\nToken\n✧ AMC Entertainment\n✧ ${SOL}\n\nStats\n✧ MC 1.47B\n\nhttps://dexscreener.com/solana/${SOL}`;
  const r = parseMessage(caption, []);
  assert.equal(r.kind === 'address' && r.address, SOL);
  assert.equal(r.kind === 'address' && r.chainSlug, 'solana');
});
