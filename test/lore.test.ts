import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { extractMetaDescription, extractProseFromScript, extractVisibleText } from '../src/domain/webText.js';
import { LoreService, buildPrompt, launchpadOf, profileMatches } from '../src/services/loreService.js';
import { renderLore } from '../src/bot/handlers/lore.js';
import { openMemoryDatabase } from '../src/infra/db.js';
import type { CmcGateway } from '../src/api/cmc/index.js';
import { parseProfile } from '../src/api/dexscreener.js';

test('extractVisibleText：去 script / style，剥标签，解实体，压空白，截断', () => {
  const html = '<html><head><title>X</title><style>.a{}</style><script>var a=1</script><meta name="description" content="Cat &amp; mining game"></head><body><h1>Project Mars</h1><p>Plant   rigs,&nbsp;collect ore.</p><div>Tokenomics &#8212; 3.5M</div><noscript>no js</noscript></body></html>';
  assert.equal(extractVisibleText(html), 'Project Mars\nPlant rigs, collect ore.\nTokenomics — 3.5M');
  assert.equal(extractMetaDescription(html), 'Cat & mining game');
  assert.equal(extractVisibleText('<p>' + 'a'.repeat(50) + '</p>', 10), 'aaaaaaaaaa');
  assert.equal(extractMetaDescription('<meta name="description" content="short">'), undefined);
});

function gateway(over: { website?: string; cmcId?: number; description?: string } = {}): CmcGateway {
  return {
    dex: {
      tokenDetail: async () => ({
        candidate: { symbol: 'DRILL', name: 'Project Mars', networkSlug: 'robinhood', address: '0xD9d674B04A72AFfe00E06385535Eaac10B988fCa', website: over.website, twitter: 'https://x.com/projectmars_rh', cmcId: over.cmcId, listedAt: Date.UTC(2026, 8, 7), raw: {} },
        pools: [],
      }),
    },
    core: { info: async () => (over.description ? { id: over.cmcId, name: 'x', symbol: 'x', description: over.description } : undefined) },
  } as unknown as CmcGateway;
}

test('LoreService：抓官网正文 + 喂模型 + 写缓存；第二次命中缓存不再调模型；地址大小写归一', async () => {
  const calls: string[] = [];
  const gen = async (_s: string, user: string) => {
    calls.push(user);
    return { text: 'Project Mars is a mining game.', inputTokens: 10, outputTokens: 5 };
  };
  const kwSeen: string[][] = [];
  const fetchText = async (url: string, keywords?: string[]) => (kwSeen.push(keywords ?? []), { url, text: 'Explore 5,000 plots across 5 regions. Plant rigs, collect $DRILL and ore.', meta: undefined, kind: 'html' as const });
  const svc = new LoreService(gateway({ website: 'https://project-mars.app/docs' }), gen, openMemoryDatabase(), fetchText, 60_000, async () => ({ header: 'https://cdn.dexscreener.com/h.png', websites: ['https://project-mars.app/docs'], socials: [] }));
  assert.equal(svc.enabled, true);
  const a = await svc.forToken({ networkSlug: 'robinhood', address: '0xd9d674b04a72affe00e06385535eaac10b988fca' });
  assert.equal(a.text, 'Project Mars is a mining game.');
  assert.deepEqual(a.sources, ['website']);
  assert.equal(a.cached, false);
  assert.equal(a.headerImage, 'https://cdn.dexscreener.com/h.png');
  assert.deepEqual(kwSeen[0], ['DRILL', 'Project Mars'], '抓官网时把符号和名字当裁剪关键词传下去');
  assert.match(calls[0]!, /Token: DRILL \(Project Mars\)\. Contract scanned on Robinhood Chain/);
  assert.match(calls[0]!, /Not listed on CoinMarketCap/);
  assert.match(calls[0]!, /Project website text \(https:\/\/project-mars\.app\/docs\):\nExplore 5,000 plots/);
  assert.match(calls[0]!, /First DEX pool was created on 2026-09-07/);
  const b = await svc.forToken({ networkSlug: 'robinhood', address: '0xD9D674B04A72AFFE00E06385535EAAC10B988FCA' });
  assert.equal(b.cached, true);
  assert.equal(b.text, a.text);
  assert.equal(b.headerImage, 'https://cdn.dexscreener.com/h.png', '横幅一起缓存');
  assert.equal(calls.length, 1);
});

test('LoreService：没官网正文也没 CMC 描述时 sources 为空，prompt 明说素材不足；有 CMC 描述时带上', async () => {
  const seen: string[] = [];
  const gen = async (_s: string, user: string) => (seen.push(user), { text: 'Thin.' });
  const none = new LoreService(gateway(), gen, openMemoryDatabase(), async () => undefined, 60_000, async () => undefined);
  const r = await none.forToken({ networkSlug: 'robinhood', address: '0xd9d6' });
  assert.deepEqual(r.sources, []);
  assert.match(seen[0]!, /website text: unavailable/);
  // 素材为空不缓存：再调一次会重新生成
  const again = await none.forToken({ networkSlug: 'robinhood', address: '0xd9d6' });
  assert.equal(again.cached, false);
  const listed = new LoreService(gateway({ cmcId: 24007, description: 'Delysium (AGI) is a cryptocurrency launched in 2021.' }), gen, undefined, async () => undefined, 60_000, async () => undefined);
  const r2 = await listed.forToken({ networkSlug: 'robinhood', address: '0xd9d6' });
  assert.deepEqual(r2.sources, ['cmc']);
  assert.match(seen[2]!, /CoinMarketCap description:\nDelysium/);
});

test('LoreService：未配置 key 时 enabled=false 且 forToken 抛错', async () => {
  const svc = new LoreService(gateway(), undefined, undefined, async () => undefined, 60_000, async () => undefined);
  assert.equal(svc.enabled, false);
  await assert.rejects(() => svc.forToken({ networkSlug: 'robinhood', address: '0x1' }), /not configured/);
});

test('renderLore：头部 · 正文，不带来源脚注；素材为空时才补一行链接；HTML 转义', () => {
  const html = renderLore({ symbol: 'DRILL', name: 'Project <Mars>', networkSlug: 'robinhood', address: '0x1', text: 'Plant rigs & collect ore.', sources: ['website', 'cmc'], links: { website: 'https://project-mars.app/docs', twitter: 'https://x.com/projectmars_rh' }, cached: false });
  assert.equal(html, ['📖 <b>DRILL</b> · Project &lt;Mars&gt; · Robinhood Chain', '', 'Plant rigs &amp; collect ore.'].join('\n'));
  const thin = renderLore({ symbol: 'X', name: 'X', networkSlug: 'solana', address: 's', text: 'Sources are thin.', sources: [], links: { website: 'https://x.example', twitter: 'https://x.com/x' }, cached: true });
  assert.match(thin, /Sources are thin\.\n\n<a href="https:\/\/x\.example">Website<\/a> · <a href="https:\/\/x\.com\/x">X<\/a>$/);
  const bare = renderLore({ symbol: 'X', name: 'X', networkSlug: 'solana', address: 's', text: 't', sources: [], links: {}, cached: true });
  assert.equal(bare, '📖 <b>X</b> · X · Solana\n\nt');
});

test('buildPrompt 不含 undefined 字样', () => {
  const p = buildPrompt({ symbol: 'X', name: 'X', networkSlug: 'solana', address: 's', raw: {} }, undefined, undefined);
  assert.doesNotMatch(p, /undefined/);
  assert.match(p, /Website: -\. X: -\. Telegram: -\./);
});

test('extractProseFromScript：从编译后的 Vue 渲染函数里挖文案，跳过库报错、tailwind 类名、代码；超长先丢短句', () => {
  const js = 'var a="Expected instance of class";b(m("p",null,"Plant rigs, collect ore.",-1),P(" and build up your plots.",-1),m("i",{class:"tw:bg-card tw:flex tw:gap-6"},"$DRILL"),x("translateY(50%) rotate(90deg)"),y("https://x.com/a b c"),z("token-unit"),w("Explore 5,000 plots across 5 regions, then upgrade each plot to level 20 by burning ore."),q("Approve token spending for this action, then try again."))';
  const t = extractProseFromScript(js);
  assert.match(t, /Plant rigs, collect ore\.\nand build up your plots\./);
  assert.match(t, /Explore 5,000 plots across 5 regions/);
  assert.doesNotMatch(t, /Expected instance|tw:bg-card|translateY|https:|token-unit/);
  const short = extractProseFromScript(js, 90);
  assert.match(short, /Explore 5,000 plots/);
  assert.doesNotMatch(short, /and build up/);
  // 带关键词：提到代币的短句优先于不提的长句
  const kw = extractProseFromScript(js + ';P("Swap ETH for $DRILL first.",-1)', 60, ['DRILL']);
  assert.match(kw, /Swap ETH for \$DRILL first\./);
  assert.doesNotMatch(kw, /Explore 5,000 plots/);
});

test('parseProfile：取指定链上带 header / imageUrl 的第一条 pair 的资料；没资料的返回 undefined', () => {
  const data = { pairs: [
    { chainId: 'bsc', info: { header: 'https://cdn/bsc.png' } },
    { chainId: 'robinhood', info: {} },
    { chainId: 'robinhood', info: { header: 'https://cdn/h.png', imageUrl: 'https://cdn/i.png', websites: [{ url: 'https://project-mars.app/docs', label: 'Docs' }], socials: [{ type: 'twitter', url: 'https://x.com/projectmars_rh' }] } },
  ] };
  assert.deepEqual(parseProfile(data, 'robinhood'), { header: 'https://cdn/h.png', imageUrl: 'https://cdn/i.png', websites: ['https://project-mars.app/docs'], socials: [{ type: 'twitter', url: 'https://x.com/projectmars_rh' }] });
  assert.equal(parseProfile(data, 'solana'), undefined);
  assert.equal(parseProfile(data)?.header, 'https://cdn/bsc.png');
  assert.equal(parseProfile({ pairs: [{ chainId: 'solana' }] }), undefined);
  assert.equal(parseProfile(null), undefined);
});

test('LoreService：缓存行带 prompt 版本，旧版本（无前缀）的缓存不命中', async () => {
  const db = openMemoryDatabase();
  // 夹具 gateway 的 tokenDetail 固定返回 DRILL 的地址，预置的旧缓存行要用同一个地址（小写）
  const addr = '0xd9d674b04a72affe00e06385535eaac10b988fca';
  db.prepare("INSERT INTO lore (network_slug, address, text, sources, header, created_at) VALUES ('robinhood', ?, 'old blurb', 'website', NULL, ?)").run(addr, Date.now());
  let calls = 0;
  const svc = new LoreService(gateway({ website: 'https://x.example' }), async () => (calls++, { text: 'new blurb' }), db, async (url) => ({ url, text: 'Some readable project text that is long enough to count as a source.', kind: 'html' as const }), 60_000, async () => undefined);
  const r = await svc.forToken({ networkSlug: 'robinhood', address: addr.toUpperCase() });
  assert.equal(r.cached, false);
  assert.equal(r.text, 'new blurb');
  assert.equal(calls, 1);
  const row = db.prepare('SELECT sources FROM lore WHERE address = ?').get(addr) as { sources: string };
  assert.equal(row.sources, 'v2:website');
  assert.equal((await svc.forToken({ networkSlug: 'robinhood', address: addr })).cached, true);
});

test('profileMatches：DexScreener 资料的链接要和 CMC 登记的官网 / X 对得上，否则横幅不用（4STOCK 拿到 Superstables 的图）', () => {
  const links = { website: 'https://project-mars.app/docs', twitter: 'https://x.com/projectmars_rh' };
  assert.equal(profileMatches({ header: 'h', websites: ['https://www.project-mars.app/'], socials: [] }, links), true);
  assert.equal(profileMatches({ header: 'h', websites: [], socials: [{ type: 'twitter', url: 'https://twitter.com/ProjectMars_RH' }] }, links), true);
  assert.equal(profileMatches({ header: 'h', websites: [], socials: [] }, links), false);
  assert.equal(profileMatches({ header: 'h', websites: ['https://superstables.xyz'], socials: [{ type: 'twitter', url: 'https://x.com/superstables' }] }, links), false);
  assert.equal(profileMatches({ header: 'h', websites: ['https://cate.meme/'], socials: [] }, { website: 'https://cate.meme', twitter: 'https://twitter.com/i/communities/2004330768022004131' }), true);
});

test('launchpadOf 与 buildPrompt：官网是 four.meme / pump.fun 这类发射平台时在 prompt 里说明', () => {
  assert.equal(launchpadOf('https://four.meme'), 'four.meme');
  assert.equal(launchpadOf('https://www.pump.fun/coin/x'), 'pump.fun');
  assert.equal(launchpadOf('https://project-mars.app/docs'), undefined);
  assert.equal(launchpadOf(undefined), undefined);
  const p = buildPrompt({ symbol: '4STOCK', name: '4Stock', networkSlug: 'bnb', address: '0x', website: 'https://four.meme', raw: {} }, undefined, '4Stock (4Stock) is a cryptocurrency and operates on the BNB Smart Chain (BEP20) platform.');
  assert.match(p, /points to the four\.meme launchpad/);
  assert.match(p, /CoinMarketCap description:\n4Stock/);
});
