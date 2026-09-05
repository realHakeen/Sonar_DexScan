/** 地址格式所属的「链系」。EVM 系需要二次反查才能定到具体链。 */
export type ChainFamily = 'evm' | 'solana' | 'tron' | 'ton' | 'sui' | 'aptos' | 'cosmos' | 'bitcoin' | 'unknown';

export interface ChainSpec {
  /** 链注册表 key，同时是 v4 端点的 network_slug。 */
  slug: string;
  name: string;
  family: ChainFamily;
  /** v1 端点的 platform 参数值（实测大小写不敏感）。缺省用 name。 */
  platform?: string;
  /** dex.coinmarketcap.com/token/{dexscanSlug}/{address} 里用的段。缺省用 slug。 */
  dexscanSlug?: string;
  /** 文本里代替 ⛓ 的配色圆点（正文放不了 logo，这是不买 Fragment 自定义 emoji 前的近似）。 */
  emoji?: string;
  /** 平台原生币在 CMC 的 coin id（search 的 plti），用于取链 logo。 */
  platformCryptoId?: number;
  /** 区块浏览器地址页模板，{address} 会被替换。 */
  explorer?: string;
  /** DexScreener 链接里使用的 chain id，用于 F5 反解析。 */
  dexscreenerId?: string;
}

/**
 * 链注册表。slug 以 CMC network_slug 为准；
 * 启动时可用 DexApi.networks() 校准（见 chainRegistry.calibrate）。
 */
const CHAINS: ChainSpec[] = [
  { slug: 'ethereum', name: 'Ethereum', family: 'evm', emoji: '🔷', platformCryptoId: 1027, explorer: 'https://etherscan.io/token/{address}', dexscreenerId: 'ethereum' },
  { slug: 'bnb', name: 'BNB Chain', family: 'evm', emoji: '🟡', platformCryptoId: 1839, platform: 'BSC', dexscanSlug: 'bsc', explorer: 'https://bscscan.com/token/{address}', dexscreenerId: 'bsc' },
  { slug: 'base', name: 'Base', family: 'evm', emoji: '🔵', platformCryptoId: 27716, explorer: 'https://basescan.org/token/{address}', dexscreenerId: 'base' },
  { slug: 'arbitrum', name: 'Arbitrum', family: 'evm', emoji: '🔵', platformCryptoId: 11841, explorer: 'https://arbiscan.io/token/{address}', dexscreenerId: 'arbitrum' },
  { slug: 'polygon', name: 'Polygon', family: 'evm', emoji: '🟪', platformCryptoId: 28321, explorer: 'https://polygonscan.com/token/{address}', dexscreenerId: 'polygon' },
  { slug: 'optimism', name: 'Optimism', family: 'evm', emoji: '🔴', platformCryptoId: 11840, explorer: 'https://optimistic.etherscan.io/token/{address}', dexscreenerId: 'optimism' },
  { slug: 'avalanche', name: 'Avalanche', family: 'evm', emoji: '🔺', platformCryptoId: 5805, explorer: 'https://snowscan.xyz/token/{address}', dexscreenerId: 'avalanche' },
  { slug: 'linea', name: 'Linea', family: 'evm', emoji: '⬛', platformCryptoId: 27657, explorer: 'https://lineascan.build/token/{address}', dexscreenerId: 'linea' },
  { slug: 'scroll', name: 'Scroll', family: 'evm', emoji: '🟠', platformCryptoId: 26998, explorer: 'https://scrollscan.com/token/{address}', dexscreenerId: 'scroll' },
  { slug: 'blast', name: 'Blast', family: 'evm', emoji: '🟨', platformCryptoId: 28480, explorer: 'https://blastscan.io/token/{address}', dexscreenerId: 'blast' },
  { slug: 'zksync', name: 'zkSync Era', family: 'evm', emoji: '⬜', platformCryptoId: 24091, explorer: 'https://era.zksync.network/token/{address}', dexscreenerId: 'zksync' },
  { slug: 'mantle', name: 'Mantle', family: 'evm', emoji: '⬛', platformCryptoId: 27075, explorer: 'https://mantlescan.xyz/token/{address}', dexscreenerId: 'mantle' },
  { slug: 'sonic', name: 'Sonic', family: 'evm', emoji: '🟠', platformCryptoId: 32684, explorer: 'https://sonicscan.org/token/{address}', dexscreenerId: 'sonic' },
  { slug: 'berachain', name: 'Berachain', family: 'evm', emoji: '🟤', platformCryptoId: 24647, explorer: 'https://berascan.com/token/{address}', dexscreenerId: 'berachain' },
  { slug: 'hyperevm', name: 'HyperEVM', family: 'evm', emoji: '🟢', platformCryptoId: 32196, explorer: 'https://hyperevmscan.io/token/{address}', dexscreenerId: 'hyperevm' },
  { slug: 'unichain', name: 'Unichain', family: 'evm', emoji: '🩷', platformCryptoId: 7083, explorer: 'https://uniscan.xyz/token/{address}', dexscreenerId: 'unichain' },
  { slug: 'cronos', name: 'Cronos', family: 'evm', explorer: 'https://cronoscan.com/token/{address}', dexscreenerId: 'cronos' },
  { slug: 'fantom', name: 'Fantom', family: 'evm', explorer: 'https://ftmscan.com/token/{address}', dexscreenerId: 'fantom' },
  { slug: 'pulsechain', name: 'PulseChain', family: 'evm', explorer: 'https://scan.pulsechain.com/token/{address}', dexscreenerId: 'pulsechain' },
  { slug: 'solana', name: 'Solana', family: 'solana', emoji: '🟣', platformCryptoId: 5426, explorer: 'https://solscan.io/token/{address}', dexscreenerId: 'solana' },
  { slug: 'tron', name: 'Tron', family: 'tron', emoji: '🔴', platformCryptoId: 1958, explorer: 'https://tronscan.org/#/token20/{address}', dexscreenerId: 'tron' },
  { slug: 'ton', name: 'TON', family: 'ton', emoji: '💎', platformCryptoId: 11419, explorer: 'https://tonviewer.com/{address}', dexscreenerId: 'ton' },
  { slug: 'sui', name: 'Sui', family: 'sui', emoji: '🌊', platformCryptoId: 20947, explorer: 'https://suiscan.xyz/mainnet/coin/{address}', dexscreenerId: 'sui' },
  { slug: 'aptos', name: 'Aptos', family: 'aptos', emoji: '⚫', platformCryptoId: 21794, explorer: 'https://explorer.aptoslabs.com/coin/{address}', dexscreenerId: 'aptos' },
  { slug: 'injective', name: 'Injective', family: 'cosmos', explorer: 'https://explorer.injective.network/asset/{address}', dexscreenerId: 'injective' },
  { slug: 'osmosis', name: 'Osmosis', family: 'cosmos', explorer: 'https://www.mintscan.io/osmosis/assets', dexscreenerId: 'osmosis' },
  { slug: 'sei', name: 'Sei', family: 'cosmos', platform: 'Sei v2', explorer: 'https://seitrace.com/token/{address}', dexscreenerId: 'seiv2' },
  // —— 以下来自 2026-09-02 search 返回的 plt 清单，只登记名称与链系，浏览器地址不确定的留空 ——
  { slug: 'robinhood', name: 'Robinhood Chain', family: 'evm', emoji: '🟢', platformCryptoId: 40670, platform: 'Robinhood', dexscreenerId: 'robinhood' },
  { slug: 'monad', name: 'Monad', family: 'evm', emoji: '🟣', platformCryptoId: 30495, dexscreenerId: 'monad' },
  { slug: 'abstract', name: 'Abstract', family: 'evm', emoji: '🟢', platformCryptoId: 35634, platform: 'Abstract Chain', explorer: 'https://abscan.org/token/{address}', dexscreenerId: 'abstract' },
  { slug: 'soneium', name: 'Soneium', family: 'evm', explorer: 'https://soneium.blockscout.com/token/{address}', dexscreenerId: 'soneium' },
  { slug: 'ink', name: 'Ink', family: 'evm', explorer: 'https://explorer.inkonchain.com/token/{address}', dexscreenerId: 'ink' },
  { slug: 'megaeth', name: 'MegaETH', family: 'evm', dexscreenerId: 'megaeth' },
  { slug: 'katana', name: 'Katana', family: 'evm', dexscreenerId: 'katana' },
  { slug: 'plasma', name: 'Plasma', family: 'evm', dexscreenerId: 'plasma' },
  { slug: 'world-chain', name: 'World Chain', family: 'evm', platform: 'World Chain Mainnet', explorer: 'https://worldscan.org/token/{address}', dexscreenerId: 'worldchain' },
  { slug: 'gnosis', name: 'Gnosis', family: 'evm', explorer: 'https://gnosisscan.io/token/{address}', dexscreenerId: 'gnosischain' },
  { slug: 'celo', name: 'Celo', family: 'evm', explorer: 'https://celoscan.io/token/{address}', dexscreenerId: 'celo' },
  { slug: 'ronin', name: 'Ronin', family: 'evm', explorer: 'https://app.roninchain.com/token/{address}', dexscreenerId: 'ronin' },
  { slug: 'boba', name: 'Boba Network', family: 'evm', platform: 'Boba Network', explorer: 'https://bobascan.com/token/{address}', dexscreenerId: 'boba' },
  { slug: 'aurora', name: 'Aurora', family: 'evm', explorer: 'https://explorer.aurora.dev/token/{address}', dexscreenerId: 'aurora' },
  { slug: 'metis', name: 'Metis', family: 'evm', explorer: 'https://explorer.metis.io/token/{address}', dexscreenerId: 'metis' },
  { slug: 'flare', name: 'Flare', family: 'evm', explorer: 'https://flarescan.com/token/{address}', dexscreenerId: 'flare' },
  { slug: 'manta', name: 'Manta Pacific', family: 'evm', platform: 'Manta Pacific', explorer: 'https://pacific-explorer.manta.network/token/{address}', dexscreenerId: 'manta' },
  { slug: 'taiko', name: 'Taiko', family: 'evm', explorer: 'https://taikoscan.io/token/{address}', dexscreenerId: 'taiko' },
  { slug: 'x-layer', name: 'X Layer', family: 'evm', platform: 'X Layer', explorer: 'https://www.oklink.com/xlayer/token/{address}', dexscreenerId: 'xlayer' },
  { slug: 'etherlink', name: 'Etherlink', family: 'evm', explorer: 'https://explorer.etherlink.com/token/{address}', dexscreenerId: 'etherlink' },
  { slug: 'ethereumpow', name: 'EthereumPoW', family: 'evm', platform: 'EthereumPoW', dexscreenerId: 'ethereumpow' },
  { slug: 'starknet', name: 'Starknet', family: 'unknown', explorer: 'https://starkscan.co/token/{address}', dexscreenerId: 'starknet' },
  { slug: 'near', name: 'Near', family: 'unknown', explorer: 'https://nearblocks.io/token/{address}', dexscreenerId: 'near' },
  { slug: 'hedera', name: 'Hedera', family: 'unknown', platform: 'Hedera Hashgraph', explorer: 'https://hashscan.io/mainnet/token/{address}', dexscreenerId: 'hedera' },
];

/**
 * v1 dex 端点（search / holders / liquidity-change）用 bsc/sol/eth 这类短码，
 * v4 端点用完整 network_slug。这里把短码归一到 slug。
 */
const SLUG_ALIASES: Record<string, string> = {
  // search.plt / tokenDetail.plt 实测值（两者可能不同：search 给 "Robinhood"，tokenDetail 给 "Robinhood Chain"）
  'bnb smart chain (bep20)': 'bnb',
  'bnb smart chain': 'bnb',
  'bnb chain': 'bnb',
  'robinhood chain': 'robinhood',
  'sui network': 'sui',
  'sei v2': 'sei',
  'bera chain': 'berachain',
  'abstract chain': 'abstract',
  'world chain mainnet': 'world-chain',
  'world chain': 'world-chain',
  'boba network': 'boba',
  'hedera hashgraph': 'hedera',
  'manta pacific': 'manta',
  'x layer': 'x-layer',
  'zksync era': 'zksync',
  'arbitrum one': 'arbitrum',
  'polygon pos': 'polygon',
  'avalanche c-chain': 'avalanche',
  'op mainnet': 'optimism',
  eth: 'ethereum',
  ether: 'ethereum',
  bsc: 'bnb',
  'bnb-chain': 'bnb',
  'binance-smart-chain': 'bnb',
  sol: 'solana',
  arb: 'arbitrum',
  'arbitrum-one': 'arbitrum',
  matic: 'polygon',
  'polygon-pos': 'polygon',
  op: 'optimism',
  avax: 'avalanche',
  ftm: 'fantom',
  trx: 'tron',
  'zksync-era': 'zksync',
  'the-open-network': 'ton',
  seiv2: 'sei',
};

/**
 * 显示名 → slug。先查别名表；查不到就通用 slugify：
 * 去括号内容、去首尾空白、空格转连字符（"ZEDXION Smart Chain" → "zedxion-smart-chain"）。
 * 结果永远可以安全拼进 URL。
 */
export function normalizeNetworkSlug(input: string): string {
  const key = input.trim().toLowerCase();
  const aliased = SLUG_ALIASES[key];
  if (aliased) return aliased;
  const stripped = key.replace(/\(.*?\)/g, '').trim();
  return SLUG_ALIASES[stripped] ?? stripped.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

class ChainRegistry {
  private bySlug = new Map<string, ChainSpec>();
  private byDexscreener = new Map<string, ChainSpec>();
  /** 上游返回但注册表里没有的 slug，兜底成一个最小 spec。 */
  private dynamic = new Map<string, ChainSpec>();

  constructor(specs: ChainSpec[]) {
    for (const s of specs) {
      this.bySlug.set(s.slug, s);
      if (s.dexscreenerId) this.byDexscreener.set(s.dexscreenerId, s);
    }
  }

  get(slug: string): ChainSpec {
    const key = normalizeNetworkSlug(slug);
    return (
      this.bySlug.get(key) ??
      this.dynamic.get(key) ??
      this.registerDynamic(key)
    );
  }

  has(slug: string): boolean {
    return this.bySlug.has(slug.toLowerCase());
  }

  fromDexscreenerId(id: string): ChainSpec | undefined {
    const key = id.toLowerCase();
    return this.byDexscreener.get(key) ?? this.bySlug.get(normalizeNetworkSlug(key));
  }

  byFamily(family: ChainFamily): ChainSpec[] {
    return [...this.bySlug.values()].filter((c) => c.family === family);
  }

  displayName(slug: string): string {
    return this.get(slug).name;
  }

  /** 链的配色圆点；未登记的链退回 ⛓。 */
  emoji(slug: string): string {
    return this.get(slug).emoji ?? '⛓';
  }

  /** 链 logo（CMC 平台币图标）。有 plti 才有。 */
  logoUrl(slug: string, platformCryptoId?: number): string | undefined {
    const id = platformCryptoId ?? this.get(slug).platformCryptoId;
    return id ? `https://s2.coinmarketcap.com/static/img/coins/64x64/${id}.png` : undefined;
  }

  explorerUrl(slug: string, address: string): string | undefined {
    const tpl = this.get(slug).explorer;
    return tpl ? tpl.replace('{address}', address) : undefined;
  }

  /**
   * 池子（LP 合约）在区块浏览器上的页面。CMC 没有单独的池子页，所以导航到浏览器的合约 / 账户页。
   * 由代币页模板派生：EVM 系 /token/ → /address/，Solana /token/ → /account/，其余按各家习惯；没有对应规则的沿用代币页模板。
   */
  explorerAddressUrl(slug: string, address: string): string | undefined {
    const spec = this.get(slug);
    const tpl = spec.explorer;
    if (!tpl) return undefined;
    const rewrite: Array<[RegExp, string]> = [
      [/\/token20\//, '/contract/'], // tronscan
      [/\/mainnet\/coin\//, '/mainnet/object/'], // suiscan
      [/aptoslabs\.com\/coin\//, 'aptoslabs.com/account/'],
      [/solscan\.io\/token\//, 'solscan.io/account/'],
      [/\/token\//, '/address/'], // etherscan 系 / seitrace
    ];
    let out = tpl;
    for (const [re, to] of rewrite) {
      if (re.test(out)) {
        out = out.replace(re, to);
        break;
      }
    }
    return out.replace('{address}', address);
  }

  /** DexScan 官方页面，PRD 指定格式。 */
  dexscanUrl(slug: string, address: string): string {
    const spec = this.get(slug);
    return `https://dex.coinmarketcap.com/token/${spec.dexscanSlug ?? spec.slug}/${address}`;
  }

  /** v1 端点的 platform 参数。search 命中时应优先用 candidate.platform（plt 原样），这里是没有 search 结果时的兜底。 */
  platformName(slug: string): string {
    const spec = this.get(slug);
    return spec.platform ?? spec.name;
  }

  /** 用 /v4/dex/networks/list 的真实数据补全注册表，避免 slug 拼错。 */
  calibrate(networks: Array<{ slug: string; name?: string }>): number {
    let added = 0;
    for (const n of networks) {
      const key = n.slug.toLowerCase();
      if (this.bySlug.has(key)) continue;
      this.dynamic.set(key, {
        slug: key,
        name: n.name ?? key,
        family: 'unknown',
      });
      added++;
    }
    return added;
  }

  /** 上游出现未登记的链时，用它的显示名登记，避免卡片上出现 "robinhood chain" 这种小写 slug。 */
  remember(displayName: string): string {
    const slug = normalizeNetworkSlug(displayName);
    if (this.bySlug.has(slug)) return slug;
    const existing = this.dynamic.get(slug);
    if (!existing || existing.name === slug) {
      this.dynamic.set(slug, { slug, name: displayName.trim(), family: 'unknown', platform: displayName.trim() });
    }
    return slug;
  }

  private registerDynamic(slug: string): ChainSpec {
    const spec: ChainSpec = { slug, name: slug, family: 'unknown' };
    this.dynamic.set(slug, spec);
    return spec;
  }
}

export const chainRegistry = new ChainRegistry(CHAINS);
