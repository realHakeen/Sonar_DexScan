/**
 * 所有 CMC 端点路径集中在这里。每一条都已用真实 Key 实测（2026-09-02），
 * 注释里的参数与响应形态以实测为准，文档与实测冲突时以实测为准。
 * 文档: https://coinmarketcap.com/api/documentation/
 */
export const ENDPOINTS = {
  dex: {
    /**
     * GET q / limit → { data: { total, tks: [...] } }
     * tks 字段：pltId, plt("Ethereum"/"BSC"/"Solana" 显示名), plti, n, s, addr, pt, lt, w, x, l,
     *          pu(字符串), pc24h(小数), dec, tsup, fpt, fpct, v24h, mc(=FDV), liq, ts, lf, cid, ut24h, ecs, ssc
     * platform 参数传 'eth' 会 400，不要用。
     */
    search: '/v1/dex/search',
    /**
     * GET platform(plt 原样) / address → TokenDetailDTO，一次拿全：
     * n, sym, addr, plt, pid, dec, crt, own, rnc, web, tw, tg, lg, pubAt, lchAt,
     * fdv(常为 null), mcap(=price×总供应，即 FDV), lmc(CMC 收录流通市值), ts, cs, bs, liqUsd, hld(EVM 常为 0，不可信),
     * p, ph24h, pl24h, sts[{tp:'5m'|'1h'|'4h'|'24h'|'1m', vu, txs, nb, ns, bvu, svu, but, sut, pc(小数), ut}],
     * pls[TokenTopPoolDTO], cexs[{id, slug, n, lg, wst, cat[]}], cid, rl('safe'…), lf, turl
     */
    tokenDetail: '/v1/dex/token',
    /** GET platform / address / size → TokenTopPoolDTO[]（tokenDetail.pls 已含前 10 个，通常不必单独调）。 */
    tokenPools: '/v1/dex/token/pools',
    /**
     * GET platformName / address → [TokenSecurityResponseDTO]
     * securityLevel, categoryLevel, extra{buyTax, sellTax, isVerified, isFlaggedByVendor, isReported, source},
     * securityItems[{code, riskCode, riskyLevel:'g'|'y'|'r', isHit, des, groupId}],
     * evmDisplay{honeypotStatus, unverifiedContractStatus, rugPullStatus, fakeTokenStatus} | solanaDisplay{mintableStatus, freezableStatus, …}, tags[]
     */
    securityDetail: '/v1/dex/security/detail',
    /**
     * GET network_slug + contract_address(池子地址) + aux → DexParisQuotesDTO[]（含 GoPlus security_scan）。
     * 扫描主链路不再依赖它；保留给单池刷新 / K 线。
     */
    pairQuotes: '/v4/dex/pairs/quotes/latest',
    /** ⚠️ 实测必须带 dex_id/dex_slug，不能按代币列全部池子，扫描链路已弃用。 */
    spotPairs: '/v4/dex/spot-pairs/latest',
    /** GET → 实测 500（上游），warmup 已容错。 */
    networks: '/v4/dex/networks/list',
    /**
     * GET platform / address(代币或池子) / interval(1min…1h…1d…) / limit / from / to / unit(usd|native|quote) / pm(p 价格 | m 市值)
     * → [[open, high, low, close, volume, ts(ms), traders], …]，1 credit。已实测。
     * v4 的 /dex/pairs/ohlcv/* 全部 500，用这个代替。
     */
    klineCandles: '/v1/k-line/candles',
    /** 同上，返回 [[price, volume, ts], …]。 */
    klinePoints: '/v1/k-line/points',

    // ---- Holder 系列，参数一律 platform(plt 原样) + tokenAddress ----
    /** POST { tokenAddress, platform, tag } → { data: { holders: HolderDetailVO[] } }；tags 是 JSON 字符串。 */
    holdersList: '/v1/dex/holders/list',
    /** POST（实测 400 Parameter error，参数组合待定，未接入）。 */
    holdersDetail: '/v1/dex/holders/detail',
    /** GET interval=1d / limit → HolderTrendVO[]：holders, holdingRatioOfTop10/50/100(小数字符串)。 */
    holdersTrendList: '/v1/dex/holders/trend/list',
    /** GET → [{ tag, hc, tb, hr(小数) }]。 */
    holdersTagCount: '/v1/dex/holders/tag_count',
    /** GET → { platformId, count, tokenAddress }。 */
    holdersCount: '/v1/dex/holders/count',
  },
  core: {
    /** GET symbol / aux=platform → [{ id, name, symbol, slug, rank, platform{ slug, token_address } }] */
    map: '/v1/cryptocurrency/map',
    /** GET id / convert=USD → { [id]: { cmc_rank, tags[{name}], quote.USD{ market_cap, percent_change_24h… } } } */
    quotes: '/v2/cryptocurrency/quotes/latest',
    info: '/v2/cryptocurrency/info',
    /**
     * GET id / category=spot / limit / sort=volume_24h_strict → { num_market_pairs(=返回条数，不是总数), market_pairs[] }
     * market_pairs[]: market_pair, category, outlier_detected, exclusions[], exchange{id,name,slug}, quote.USD{price, volume_24h}
     * 1 credit / 100 条（2026-09-05 实测）。
     */
    marketPairs: '/v2/cryptocurrency/market-pairs/latest',
  },
  /**
   * v5 衍生品端点（2026-09-04 实测）。参数名与文档不同：按币是 crypto_id，按所是 exchange_slug / exchange_id。
   * 全部按次计费 1 credit，上游 60s 更新一次。
   */
  derivatives: {
    /**
     * GET crypto_id / limit(≤200 仍 1 credit) → { crypto_id, num_market_pairs, market_pairs[] }
     * market_pairs[]: market_pair_symbol, category('perpetual'), outlier_detected, exclusions[],
     *   exchange{exchange_id, exchange_name, exchange_slug}, market_pair_base{crypto_id, symbol, exchange_symbol},
     *   exchange_reported_quotes[{price, volume_24h_quote, open_interest, index_price, index_basis, funding_rate}],
     *   quotes[{convert_symbol:'USD', price, volume_24h, open_interest}]
     * 顶层没有 OI / 成交量汇总，只能客户端求和；sort 不支持 open_interest。
     * 灌水严重（HMSTR 在 Deepcoin 报 $1.4B OI），必须按 PERP_EXCHANGE_WHITELIST 过滤。
     */
    pairsByCrypto: '/v5/cryptocurrency/derivatives/market-pairs/list/latest',
    /**
     * GET crypto_id(可逗号批量) → { cryptocurrencies[{ crypto_id, symbol, cmc_rank,
     *   quotes[{ total/long/short_liquidations_1h|4h|24h, last_updated }] }] }
     * CMC 已跨所汇总，但只覆盖 9 家（binance, bitfinex, hyperliquid, bybit, gate, okx, htx, aster-pro, kraken）。
     */
    liquidationsByCrypto: '/v5/derivatives/liquidations/cryptocurrency/list/latest',
    /** GET limit / sort → exchanges[{ exchange_slug, exchange_score, quotes[{ open_interest_usd, derivative_volume_usd }] }]，135 家。 */
    exchanges: '/v5/exchange/derivatives/list',
  },
} as const;

/** pairs/quotes 的 aux 组合（仅在单池刷新时用）。 */
export const PAIR_QUOTE_AUX =
  'security_scan,buy_tax,sell_tax,holders,num_transactions_24h,24h_no_of_buys,24h_no_of_sells,24h_buy_volume,24h_sell_volume,pool_created,percent_pooled_base_asset';

/** 官方 tag 枚举。 */
export const HOLDER_TAGS = ['tag_all', 'tag_kol', 'tag_smart_money', 'tag_whale', 'tag_bot', 'tag_sniper', 'tag_dev'] as const;
