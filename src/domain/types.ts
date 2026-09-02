import type { RawRecord } from '../api/cmc/types.js';

export interface CexListing {
  slug: string;
  name: string;
  /** SPOT / DERIVATIVES */
  categories: string[];
}

/** 一条搜索候选 / 一个代币在某条链上的快照。字段已归一化，来源可能是 search 或 tokenDetail。 */
export interface TokenCandidate {
  /** CMC coin id。有值 = 被 CMC 正式收录，是打通 DEX 与 CEX 数据的钥匙。 */
  cmcId?: number;
  name: string;
  symbol: string;
  /** 链注册表 key（ethereum / bnb / solana…），用于浏览器链接与展示。 */
  networkSlug: string;
  /** 上游 plt 原样（"Ethereum" / "BSC" / "Solana"），喂给所有 v1 端点的 platform 参数。 */
  platform?: string;
  networkId?: number;
  address: string;
  logo?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  priceUsd?: number;
  /** 已乘 100 的百分比。上游 pc24h / sts.pc 都是小数，归一化在 mapper 完成。 */
  priceChange24hPct?: number;
  /** price × total supply。上游叫 mc / mcap，但语义是 FDV，标签必须写 FDV。 */
  fdvUsd?: number;
  /** CMC 收录的流通市值（tokenDetail.lmc），主 API 不可用时的兜底。 */
  listingMarketCapUsd?: number;
  totalSupply?: number;
  circulatingSupply?: number;
  decimals?: number;
  volume24hUsd?: number;
  liquidityUsd?: number;
  traders24h?: number;
  txns24h?: number;
  buys24h?: number;
  sells24h?: number;
  buyers24h?: number;
  sellers24h?: number;
  buyVolume24hUsd?: number;
  sellVolume24hUsd?: number;
  /** tokenDetail.hld，EVM 代币经常为 0，只能作兜底。 */
  holdersCount?: number;
  percentPooled?: number;
  pairAddress?: string;
  dexName?: string;
  /** 上线时间（epoch ms）。 */
  listedAt?: number;
  ownerAddress?: string;
  ownerRenounced?: boolean;
  /** tokenDetail.rl，如 'safe'。 */
  riskLevel?: string;
  /** tokenDetail.lf === 1。 */
  listedOnCmc?: boolean;
  tradeUrl?: string;
  cexListings?: CexListing[];
  /** CMC 官方收录合约与本条记录地址一致（map 比对结果）。 */
  officialVerified?: boolean;
  /** CMC 排名（本地索引或主 API）。 */
  cmcRank?: number;
  raw: RawRecord;
}

export interface HoldersOverview {
  totalHolders?: number;
  top10Pct?: number;
  top50Pct?: number;
  top100Pct?: number;
}

export interface HolderTagDistribution {
  sniper?: number;
  dev?: number;
  whale?: number;
  bot?: number;
  smartMoney?: number;
  kol?: number;
  /** 各标签持有人合计持仓占总供应的百分比（tag_count 的 hr）。 */
  holdingPct?: Partial<Record<'sniper' | 'dev' | 'whale' | 'bot' | 'smartMoney' | 'kol', number>>;
}

export type HolderTag =
  | 'tag_all'
  | 'tag_kol'
  | 'tag_smart_money'
  | 'tag_whale'
  | 'tag_bot'
  | 'tag_sniper'
  | 'tag_dev';

/** HolderDetailVO 的归一化子集。 */
export interface HolderEntry {
  address?: string;
  publicName?: string;
  balance?: number;
  /** 占总供应百分比（上游已是百分比单位）。 */
  percent?: number;
  buyUsd?: number;
  sellUsd?: number;
  realizedPnlUsd?: number;
  realizedPnlPct?: number;
  firstActiveAt?: number;
  lastActiveAt?: number;
  explorerUrl?: string;
  tags: string[];
  raw: RawRecord;
}

/** security/detail 的单条检测项。level: g 绿 / y 黄 / r 红。 */
export interface SecurityItem {
  code: string;
  riskCode?: string;
  level: string;
  hit: boolean;
  description?: string;
  group?: string;
}

export interface SecurityScan {
  /** BINANCE / W3W / GoPlus … */
  provider: string;
  /** securityLevel: 'safe' 等。 */
  level?: string;
  buyTaxPct?: number;
  sellTaxPct?: number;
  contractVerified?: boolean;
  flaggedByVendor?: boolean;
  reported?: boolean;
  /** evmDisplay / solanaDisplay 的 Yes / No / Unknown。 */
  honeypotStatus?: string;
  rugPullStatus?: string;
  fakeTokenStatus?: string;
  mintableStatus?: string;
  freezableStatus?: string;
  /** 全部检测项（含未命中）。 */
  items: SecurityItem[];
  tags: string[];
  // —— 由 items / display / GoPlus 推导出的布尔项，风控引擎只看这些 ——
  isHoneypot?: boolean;
  cannotBuy?: boolean;
  cannotSellAll?: boolean;
  selfDestruct?: boolean;
  airdropScam?: boolean;
  maliciousCreator?: boolean;
  hackRisk?: boolean;
  isMintable?: boolean;
  /** 可升级 / 代理合约。 */
  isProxy?: boolean;
  hiddenOwner?: boolean;
  canTakeBackOwnership?: boolean;
  ownerChangeBalance?: boolean;
  ownerRenounced?: boolean;
  isBlacklisted?: boolean;
  isWhitelisted?: boolean;
  transferPausable?: boolean;
  freezable?: boolean;
  /** 税率可修改。 */
  slippageModifiable?: boolean;
  antiWhale?: boolean;
  tradingCoolDown?: boolean;
  openSource?: boolean;
  trustList?: boolean;
  extra: Record<string, string>;
}

/** TokenTopPoolDTO / DexSpotPairDTO 的归一化。 */
export interface PoolInfo {
  pairAddress?: string;
  dexName?: string;
  liquidityUsd?: number;
  volume24hUsd?: number;
  quoteSymbol?: string;
  /** 锁仓率 / 销毁率（百分比），tokenDetail.pls 提供，常为 null。 */
  lockedRatePct?: number;
  burnedRatePct?: number;
  isTop?: boolean;
  createdAt?: number;
  raw: RawRecord;
}

/** 来自主 API（非 DEX）的数据。 */
export interface CoreMarketData {
  cmcId: number;
  cmcRank?: number;
  /** 真实流通市值。 */
  marketCapUsd?: number;
  fdvUsd?: number;
  circulatingSupply?: number;
  totalSupply?: number;
  categories: string[];
  numMarketPairs?: number;
}

export type RiskLevel = 'info' | 'warn' | 'danger';

export interface RiskFlag {
  level: RiskLevel;
  code: string;
  message: string;
}

/** 渲染卡片所需的全部数据，一个聚合根。 */
export interface TokenReport {
  primary: TokenCandidate;
  secondaryDeployments: TokenCandidate[];
  holders?: HoldersOverview;
  tags?: HolderTagDistribution;
  security?: SecurityScan;
  pools: PoolInfo[];
  core?: CoreMarketData;
  risks: RiskFlag[];
  degraded: string[];
  generatedAt: number;
}
