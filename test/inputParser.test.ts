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

test('DexScreener 的 chain id 映射到 CMC network_slug，并标记为池子地址', () => {
  const r = parseInput(`https://dexscreener.com/bsc/${USDT}`);
  assert.equal(r.kind === 'address' && r.chainSlug, 'bnb');
  assert.equal(r.kind === 'address' && r.pair, true);
  const raw = parseInput(USDT);
  assert.equal(raw.kind === 'address' && raw.pair, undefined);
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
  assert.equal(extractCashtag('$1inch'), '1inch', '整条消息形态：任何字符都算');
  assert.equal(extractCashtag('paid $1inch worth'), undefined, '句子里数字开头当金额');
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

test('单字符 / 数字 / 中文 cashtag：整条消息形态一律触发；句子里的金额不触发', () => {
  for (const [text, q] of [['$4', '4'], ['$M', 'M'], ['$牛来', '牛来'], [' $PEPE ', 'PEPE'], ['$100k', '100k']] as const) {
    const r = parseInput(text);
    assert.equal(r.kind, 'query', text);
    assert.equal(r.kind === 'query' && r.query, q);
    assert.equal(r.kind === 'query' && r.explicit, true);
  }
  const cjk = parseInput('$牛来 冲不冲');
  assert.equal(cjk.kind === 'query' && cjk.query, '牛来');
  assert.equal(cjk.kind === 'query' && cjk.explicit, true);
  for (const text of ['it costs $5 for gas', 'raised US$100k today', 'up $4 since yesterday']) {
    const r = parseInput(text);
    assert.notEqual(r.kind === 'query' && r.explicit, true, text);
  }
});

test('不认识的域名（padre / gmgn）：从路径段取链名；消息里同时有 $TICKER 时记为 fallbackQuery', () => {
  const r = parseInput('$ZCAT\n\nhttps://trade.padre.gg/trade/solana/BTccxxTFi7a9xJTE1exKn38Jgie35s6gNeRxd8DM61Rc');
  assert.equal(r.kind, 'address');
  assert.equal(r.kind === 'address' && r.chainSlug, 'solana');
  assert.equal(r.kind === 'address' && r.address, 'BTccxxTFi7a9xJTE1exKn38Jgie35s6gNeRxd8DM61Rc');
  assert.equal(r.kind === 'address' && r.fallbackQuery, 'ZCAT');
  assert.equal(r.kind === 'address' && r.pair, undefined);
  const g = parseInput(`https://gmgn.ai/bsc/token/${USDT}`);
  assert.equal(g.kind === 'address' && g.chainSlug, 'bnb');
  assert.equal(g.kind === 'address' && g.fallbackQuery, undefined);
  const raw = parseInput(`ca ${USDT} $USDT`);
  assert.equal(raw.kind === 'address' && raw.fallbackQuery, 'USDT');
});
