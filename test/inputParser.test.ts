import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { extractCashtag, parseInput, parseLink, parseMessage } from '../src/domain/inputParser.js';

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

test('DexScreener 小写分享链接：Solana 池子地址含 L、TON 地址 eq 前缀，仍认作池子地址', () => {
  // WIF/SOL 池 EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx，DexScreener 的 url 字段就是全小写
  const sol = parseLink('https://dexscreener.com/solana/ep2ib6dydeeqd8mfe2ezhcxx3kp3k2elkkirfpm5eymx');
  assert.deepEqual(sol, { kind: 'address', address: 'ep2ib6dydeeqd8mfe2ezhcxx3kp3k2elkkirfpm5eymx', chainSlug: 'solana', source: 'link', pair: true });
  // NOT/TON 池 EQCaY8Ifl2S6lRBMBJeY35LIuMXPc8JfItWG4tl7lBGrSoR2
  const ton = parseLink('https://dexscreener.com/ton/eqcay8ifl2s6lrbmbjey35liumxpc8jfitwg4tl7lbgrsor2');
  assert.deepEqual(ton, { kind: 'address', address: 'eqcay8ifl2s6lrbmbjey35liumxpc8jfitwg4tl7lbgrsor2', chainSlug: 'ton', source: 'link', pair: true });
  // 消息里带着也一样
  const msg = parseInput('看看这个 https://dexscreener.com/solana/ep2ib6dydeeqd8mfe2ezhcxx3kp3k2elkkirfpm5eymx');
  assert.equal(msg.kind, 'address');
  // 只放宽 DexScreener / GeckoTerminal 分支：裸小写串不算地址
  assert.notEqual(parseInput('ep2ib6dydeeqd8mfe2ezhcxx3kp3k2elkkirfpm5eymx').kind, 'address');
});

test('DexScreener 池子 id 每条链一套格式：链已登记就整段当池子 id，交给 DexScreener 反查', () => {
  const cases: Array<[string, string, string]> = [
    ['https://dexscreener.com/aptos/pcs-1', 'aptos', 'pcs-1'],
    ['https://dexscreener.com/aptos/liquidswap-82', 'aptos', 'liquidswap-82'],
    ['https://dexscreener.com/near/refv1-6458', 'near', 'refv1-6458'],
    ['https://dexscreener.com/near/refv2-17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1:token.rhealab.near:100', 'near', 'refv2-17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1:token.rhealab.near:100'],
    ['https://dexscreener.com/starknet/0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb-0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d-170141183460469235273462165868118016-1000-0x0', 'starknet', '0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb-0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d-170141183460469235273462165868118016-1000-0x0'],
    ['https://dexscreener.com/tron/thu6conqvzpqwqbbrzqhqwqbbrzqhqwqbbrz', 'tron', 'thu6conqvzpqwqbbrzqhqwqbbrzqhqwqbbrz'],
  ];
  for (const [url, slug, id] of cases) {
    const r = parseLink(url);
    assert.deepEqual(r, { kind: 'address', address: id, chainSlug: slug, source: 'link', pair: true }, url);
  }
  // 链没登记：仍要求像地址，页面路径不能被当成池子
  assert.equal(parseLink('https://dexscreener.com/icp/3s6gf-uqaaa-aaaag-qcdlq-cai').kind, 'none');
  assert.equal(parseLink('https://dexscreener.com/solana').kind, 'none');
  assert.equal(parseLink('https://dexscreener.com/new-pairs/solana').kind, 'none');
  assert.equal(parseLink('https://dexscreener.com/').kind, 'none');
});

test('无 scheme 的 DexScreener 链接和 GeckoTerminal 的链名别名', () => {
  const bare = parseInput('看这个 dexscreener.com/solana/ep2ib6dydeeqd8mfe2ezhcxx3kp3k2elkkirfpm5eymx 冲不冲');
  assert.deepEqual(bare, { kind: 'address', address: 'ep2ib6dydeeqd8mfe2ezhcxx3kp3k2elkkirfpm5eymx', chainSlug: 'solana', source: 'link', pair: true });
  assert.equal(parseInput('www.dexscreener.com/base/0xf79478d5a6bae4546f7e489e80b2fc690b558944').kind, 'address');
  const gt = parseLink('https://www.geckoterminal.com/sui-network/pools/0xd978d331772a5b90d5a4781e1232d18afd12019d0c35db79e3674beeda8f9126');
  assert.equal(gt.kind === 'address' && gt.chainSlug, 'sui');
  const avax = parseLink('https://www.geckoterminal.com/avax/pools/0xf79478d5a6bae4546f7e489e80b2fc690b558944');
  assert.equal(avax.kind === 'address' && avax.chainSlug, 'avalanche');
});

test('GeckoTerminal：/pools/ 是池子、/tokens/ 是代币页，语言前缀和链名别名', () => {
  const pool = parseLink('https://www.geckoterminal.com/eth/pools/0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640');
  assert.deepEqual(pool, { kind: 'address', address: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640', chainSlug: 'ethereum', source: 'link', pair: true });
  const token = parseLink('https://www.geckoterminal.com/eth/tokens/0x6982508145454ce325ddbe47a25d4ec3d2311933');
  assert.deepEqual(token, { kind: 'address', address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chainSlug: 'ethereum', source: 'link' });
  const zh = parseLink('https://www.geckoterminal.com/zh/eth/pools/0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640');
  assert.equal(zh.kind === 'address' && zh.chainSlug, 'ethereum');
  assert.equal(zh.kind === 'address' && zh.pair, true);
  const ja = parseLink('https://www.geckoterminal.com/ja/solana/tokens/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm');
  assert.deepEqual(ja, { kind: 'address', address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', chainSlug: 'solana', source: 'link' });
  for (const [id, slug] of [['xdai', 'gnosis'], ['hedera-hashgraph', 'hedera'], ['starknet-alpha', 'starknet'], ['manta-pacific', 'manta'], ['sei-evm', 'sei'], ['polygon_pos', 'polygon'], ['bsc', 'bnb']] as const) {
    const r = parseLink(`https://www.geckoterminal.com/${id}/pools/0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640`);
    assert.equal(r.kind === 'address' && r.chainSlug, slug, id);
  }
  // 没登记的 network：地址还认，链留空
  const unk = parseLink('https://www.geckoterminal.com/movr/pools/0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640');
  assert.equal(unk.kind === 'address' && unk.chainSlug, undefined);
});
