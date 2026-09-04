# DexScan Telegram Bot — 产品需求文档（PRD）

> 版本 1.0 · 2026-09-02 · 依据当前代码库（`main`）反向整理，描述的是**已实现**的行为；未实现项统一放在 §10。

---

## 1. 产品定义

**一句话**：地址进，尽调卡片出。

用户在 Telegram 私聊或群聊中发送代币合约地址、名称、ticker 或链接，Bot 返回一张单条消息的尽调卡片：行情、市值口径、持仓结构、安全检测、池子分布、风险提示，并附带刷新与切链按钮。

**核心差异**：竞品（PirbViewBot / Tokenscan 系）基于 DexScreener / GeckoTerminal，只有链上数据。本产品基于 CoinMarketCap DEX API + 主 API，通过 CMC coin id（cid）把链上与 CEX 侧数据打通，能给出竞品给不了的四项信息：

| | 竞品 | 本产品 |
|---|---|---|
| 正版识别 | 无 | ✅ 与 CMC 收录合约索引比对，搜 `Teller` 返回 $2M 流动性的正主而非 100 个同名空池 |
| 市值口径 | 只有 price × supply，常误标为"市值" | 流通市值 / 全链 FDV / 本链 FDV 分开标注 |
| CEX 视角 | 无 | 上所家数、现货/合约、CMC 排名、赛道 |
| 持仓与安全 | 自算链上标签、嵌 GoPlus | sniper/dev/whale/bot/smart money/KOL 持有人数与持仓占比；Binance / W3W 逐项安全评估 |

**定位**：竞品回答"这个币现在多少钱"，本产品回答"这个币是不是它自称的那个东西、体量到底多大、谁在拿着"。

## 2. 目标与指标

| 目标 | 指标 | 现状 |
|---|---|---|
| 响应速度 | 卡片出现 ≤ 1.5s（直连） | 美国机房直连 1.2–1.7s；经代理 5–7s |
| 可靠性 | 任一子请求失败不影响出卡 | `Promise.allSettled` 降级渲染，缺失项脚注标注 |
| 成本 | 单次扫描 ≤ 7 credits | search 1 + 详情 5 + 兜底 0–2 |
| 获客 | 可被拉入群自动响应 | 已实现，群内限流 + 紧凑卡 |

## 3. 用户与场景

- **私聊用户**：粘贴地址/名称/链接，拿完整卡片；重名时从候选列表里选。
- **群成员**：任何人贴地址或链接，Bot 自动出紧凑卡；点「Full report」展开；裸名称不触发，`@bot 名称` 显式触发。
- **群管理员**：把 Bot 拉进群即可，无需配置（需在 BotFather 关闭 Group Privacy）。

## 4. 功能需求（已实现）

### F1 地址扫描与定链
1. 正则识别地址格式 → 链系：`0x`+40 hex → EVM（需反查）；`0x`+64 hex 或 `0x…::mod::T` → Sui/Aptos；base58 32–44 → Solana；`T`+33 base58 → Tron；`EQ/UQ` → TON；bech32 前缀（`inj1` 等）→ Cosmos。
2. 调 `/v1/dex/search?q={address}` 反查所在链；多链命中按流动性降序取主链。
3. 次要链不丢弃：流动性 > 0 的部署进入风险区提示「Also on X ($N) — leftover or copycat」，并生成「Switch to X」按钮。
4. search 漏索引或挂掉时：链已知直接打 `/v1/dex/token`；EVM 无链提示则并行探测 BNB / Ethereum / Base / Arbitrum，取流动性最高者。
5. 网络失败与"未找到"区分：前者提示检查网络，后者提示核对地址。

### F2 名称 / Symbol 搜索与消歧
1. 三路并行取候选：DEX search 文本相关性（limit 100）、DEX search `sort=liquidity`、**本地 CMC 收录索引**（name / slug / symbol 精确命中 → `/v1/dex/token` 补齐行情，最多 3 条）。
2. 客户端重排，权重：流动性 1.0 > 成交量 0.55 > 有 cid 0.9 > 交易人数 0.35；官方合约 +3.0；symbol 精确匹配 +0.6；CMC 排名前 100 / 1000 / 其余 +1.2 / 0.6 / 0.3；空池（< $1K）−1.5；刷量（成交量高但人均 > $50K 或无交易人）−1.2 / −0.8。
3. 正版识别：候选地址与本地索引比对，命中标 ✅ 并补 cid、排名；索引未加载时按候选各自 symbol 查 `/v1/cryptocurrency/map`（0 credits）。
4. 交互：第一名明显占优（官方收录而第二名不是，或流动性 ≥ 10×）直接出卡；否则返回 Top 5 候选列表，按钮标注 `✅ SYMBOL · 链 · 流动性`。

### F3 扫描卡片
单条 HTML 消息，按手机 36 列宽度设计，等宽标签列 + 树形连接线。区块与字段：

| 区块 | 内容 |
|---|---|
| 头部 | `SYMBOL ✅ · Name`；链 · CMC 排名 · 上线时长 · 已放弃所有权；CEX 上所家数（现货数）+ 前 3 家；赛道（≤3）；合约地址（可复制） |
| Market | Price + 24h 涨跌；MC / FDV（多链时拆三行：MC all chains、FDV all chains、FDV 本链）+ 流通比；Liq / Vol + 倍数（≥1× 才显示）；Trades：交易人数 · ↑买笔 ↓卖笔；Flow：买量 / 卖量 · 买压 % |
| Holders | 总数；Top10 / Top50 进度条；标签 🎯🧑‍💻🐳🤖🧠📣 持有人数（持仓占比 ≥ 0.1% 时显示），超过 2 个拆两行 |
| Security | 来源 · 评级；税率 · 蜜罐状态；命中项逐条（🚨/⚠️/ℹ️ 按 r/y/g），未命中项只给数量 |
| Pools | 前 3 个池子：DEX 缩写 / 报价币 · 流动性 · 首池占比 · 锁仓 🔒 / 销毁 🔥 |
| Risks | 按 🚨 → ⚠️ → ℹ️ 排序，最多 8 条；Security 已逐项列出的合约级 warn 不重复；单一 LP 已在 Pools 显示不重复 |
| Links | DexScan · Explorer · Trade · Website · X · TG |
| 脚注 | 有降级项时：`⚠️ Partial data — unavailable: …. Tap Refresh to retry.` |

按钮：`🔄 Refresh` · `📈 Trade on DexScan`；有次要链时一行「Switch to X」。

**口径约束**（必须遵守）：`pc24h` / `sts.pc` 是小数，×100 后展示；`mc` / `mcap` 是 price × total supply，标签必须是 FDV；MC 来自主 API，是全链口径；持有人数以 holders 端点为准，`token.hld` 仅兜底；**Liq = 所有池子双边 TVL 合计**（DexScreener 定义），CMC 自己的 `liq` / `liqUsd` ≈ 单边（DexScan 网站显示值，约为前者一半），只作对照不展示。

### F4 群组模式
- 群内对地址、链接、`@bot …` 响应；裸名称不响应（避免"这个 pepe 不错"触发查询）。
- 返回 5 行紧凑卡（名称链名+风险图标 / 价格涨跌 / MC·Liq·Vol / 最严重一条风险 / 地址+链接），按钮「📋 Full report」展开。
- 限流：群 6 次/分钟 + 8s 冷却，私聊 20 次/分钟；群内超限静默丢弃，私聊提示等待秒数。

### F5 链接解析（零 API 消耗）
识别 `dex.coinmarketcap.com/token/{net}/{addr}`、DexScreener、GeckoTerminal、Birdeye、pump.fun 及 30+ 区块浏览器域名，从 URL 直接得到链与地址；混在句子里的地址和链接也能提取。

### F6 响应体验
- 收到消息立即回「🔍 Scanning…」，完成后 `editMessageText` 替换为卡片。
- 按钮点击：候选 / 切链 / 展开 → 消息立即变为「🔍 Scanning SYMBOL · 链…」并撤掉按钮；刷新 → 卡片保留、按钮变「⏳ Refreshing…」。同一条消息扫描中再点只回 toast，不重复请求。
- 所有详情端点并发（`Promise.allSettled`），单次扫描固定 5 个并发请求，兜底请求仅在缺失时追加。

### F6b K 线预览图
- 数据：`/v1/k-line/candles`，`pm=m` 市值口径，1h × 168（7 天）；新币不足 4 根时退到 15min × 96。坏蜡烛（open/close ≤ 0、low/high 离群 50×）过滤或钳位。
- 渲染：服务端 SVG → PNG（`@resvg/resvg-js`），1000×500，含蜡烛、成交量、ATH 标注、最新价标签、涨跌幅头部。
- 托管：进程自带 HTTP 路由 `/chart/{chain}/{address}.png`，PNG 内存缓存 5 分钟；URL 带 5 分钟时间桶让 Telegram 预览缓存失效。
- 消息：正文开头零宽不可见链接 + `link_preview_options.show_above_text`，图显示在卡片顶部；未配置公网地址（`PUBLIC_BASE_URL` / Railway `RAILWAY_PUBLIC_DOMAIN`）时静默不出图。
- 成本：每张图 1 credit（缓存期内不重复）。

### F7 风险规则引擎
阈值可配置（`.env`）。规则：

| 级别 | 规则 |
|---|---|
| 🚨 danger | 蜜罐；限制卖出；限制买入；自毁函数；空投诈骗；隐藏所有者；恶意创建者；被安全厂商标记；Top10 > 80% |
| ⚠️ warn | 买/卖税 > 10%；可增发；可收回所有权；可暂停；可改余额；税可改；未开源；可升级代理；可冻结；有被攻击记录；安全评级非 safe；Top10 > 60%；Top50 > 85%；单一 LP > 70%；流动性 < $5K；狙击地址 > 15% 持有人；成交量 > 20× 流动性且人均 > $50K（刷量） |
| ℹ️ info | 同地址多链部署；未被 CMC 收录 |

### F8 本地 CMC 收录索引
启动时后台拉全量 `/v1/cryptocurrency/map`（~8k 条，0 credits，3–5s），建 name / slug / symbol / 合约地址索引，每小时刷新。用于 F2 第三路候选与正版识别。索引未就绪时功能自动退化，不阻塞启动。

### F9 链注册表
内置 50+ 条链：注册表 slug、显示名、v1 端点 platform 名、DexScan URL slug、浏览器模板、DexScreener id。上游返回的显示名（`Robinhood Chain`、`BNB Smart Chain (BEP20)`、`Sei v2`…）通过别名表 + 通用 slugify 归一；未知链按显示名自动登记。链身份以 search 结果为准，不被 tokenDetail 的长名覆盖。

## 5. 数据源规格（全部已用真实 Key 实测）

| 端点 | 方法 / 参数 | 用途 | 实测要点 |
|---|---|---|---|
| `/v1/dex/search` | GET `q`, `limit`(≤100), `sort=liquidity` | 定链、候选 | 响应 `{data:{total,tks[]}}`；`plt` 为显示名；`pc24h` 小数；`pu`/`ut24h` 字符串；`ssc` 相关性分对同名结果完全相同 |
| `/v1/dex/token` | GET `platform`, `address` | 卡片主数据 | 一次返回基础信息、`sts[]` 各周期买卖统计、`pls[]` 头部池子、`cexs[]`、`own`/`rnc`、`cid`、`lmc`、`rl`；`hld` 对 EVM 常为 0；`mcap`=FDV 口径；`bidx` 不可靠 |
| `/v1/dex/security/detail` | GET `platformName`, `address` | 安全评估 | `securityLevel`、`extra{buyTax,sellTax,source}`、`securityItems[{riskCode,riskyLevel,isHit}]`、`evmDisplay`/`solanaDisplay` |
| `/v1/dex/holders/trend/list` | GET `interval=1d`, `limit` | 总数 + Top10/50/100 | `holdingRatioOfTop*` 小数字符串 |
| `/v1/dex/holders/count` | GET | 总数兜底 | `{platformId,count,tokenAddress}` |
| `/v1/dex/holders/tag_count` | GET | 标签分布 | `[{tag,hc,tb,hr}]`，`hr` 小数 |
| `/v1/dex/holders/list` | POST `{tokenAddress,platform,tag}` | 集中度/标签兜底；/th 复用 | `tags` 是 JSON 字符串；`percent` 已是百分比；`walletAddress` |
| `/v1/cryptocurrency/map` | GET `symbol` / 全量分页 | 正版识别、本地索引 | 0 credits；`slug` 过滤在部分 Key 上不生效并返回全量，禁止按 slug 查 |
| `/v2/cryptocurrency/quotes/latest` | GET `id` | 流通市值、排名、赛道 | `tags[{name}]` |
| `/v1/k-line/candles` | GET `platform`, `address`, `interval`, `limit`, `pm` | K 线图 | 返回 `[[o,h,l,c,v,ts(ms),traders]]`；代币地址即可；v4 `ohlcv/*` 全部 500 |

通用：`status.error_code` 是字符串（成功 `"0"`）；v1 端点 `platform` 直接用 search 的 `plt` 原样，大小写不敏感，数字 id 不行；`/v4/dex/spot-pairs/latest` 必须带 dex id，不能按代币列池子（已弃用）；`/v4/dex/networks/list` 上游 500（已容错）。

## 6. 非功能需求

| 项 | 要求 | 实现 |
|---|---|---|
| 超时与重试 | 单请求 10s（直连可 6s），重试 1 次指数退避 | `client.ts`；4xx 不重试 |
| 缓存 | search 30s、行情 15s、持仓 2min、安全 10min、元数据 1h；并发去重 | 进程内 TTL 缓存 |
| 限流 | 见 F4 | 固定窗口 + 冷却 |
| 代理 | 遵守 `HTTP(S)_PROXY` / `NO_PROXY` | 启动时接管 Node fetch |
| 日志 | JSON 行、带 reqId、级别可配 | `LOG_LEVEL` |
| 健康检查 | 注入 `PORT` 时提供 `/health` | Railway healthcheck |
| 部署 | 单实例 long polling；Dockerfile + `railway.json` | Railway，push 即部署 |
| 密钥 | `.env` 不入库；API Key 只存在于 HTTP 客户端层 | |

## 7. 配置项

| 变量 | 默认 | 说明 |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` / `CMC_API_KEY` | 必填 | |
| `TELEGRAM_WEBHOOK_DOMAIN` / `_PATH` / `PORT` | 空 / `/tg/webhook` / 3000 | 填域名切 webhook |
| `CMC_TIMEOUT_MS` / `CMC_MAX_RETRIES` | 10000 / 1 | |
| `CACHE_TTL_*_MS` | 见 §6 | |
| `RATE_LIMIT_PRIVATE_PER_MIN` / `GROUP_PER_MIN` / `GROUP_COOLDOWN_MS` | 20 / 6 / 8000 | |
| `RISK_TOP10_PCT` / `TOP50_PCT` / `SINGLE_LP_PCT` / `MIN_LIQUIDITY_USD` / `MAX_TAX_PCT` | 60 / 85 / 70 / 5000 / 10 | |
| `LOG_LEVEL` | info | |

## 8. 命令与交互

| 入口 | 行为 |
|---|---|
| `/start` `/help` | 说明 |
| `/s <地址｜名称｜链接>`、`/scan` | 扫描 |
| 私聊直接发送 | 同 `/s` |
| 群内地址 / 链接 / `@bot …` | 紧凑卡 |
| 按钮 | Refresh · Trade on DexScan · Switch to X · Full report · 候选选择 |

## 9. 架构约束

- 分层 `bot → services → domain / api → infra`；`domain` 与 `render` 无 IO，可单测（当前 67 个测试）。
- 端点路径集中在 `api/cmc/endpoints.ts`，字段别名集中在 `mappers.ts`；上游改版只改这两处。
- 缓存 / 限流接口已隔离，多实例时替换为 Redis 实现即可。
- 探针 `npm run probe -- <地址> [platform]` 逐端点核对响应形态。

## 10. 未实现 / 路线图

| 项 | 说明 | 优先级 |
|---|---|---|
| 新币模板 | 上线 < 24h 或在 pump.fun bonding curve 上的代币：显示 curve 进度（`bcr`）、5m/1h 动量、dev 持仓与是否清仓、Top 5 持有人；此时不触发"流动性过低" | 高 |
| 卡片结论行 | 头部一句风险评分 + 最重要两条 | 高 |
| `/th` `/nh` `/tt` `/fb` | 持有人 / 名人持有 / 交易者 / 首批买家（`holders/list` 已接） | 中 |
| `/c` K 线命令（切换周期） | 卡片顶部已有 7d 图，命令版可选 1h/24h/7d/30d | 低 |
| 订阅推送 | 流动性事件（`/v1/dex/liquidity-change/list` 已登记）、价格告警 | 中 |
| Logo 预览 | 链接预览技巧把 logo 放卡片顶部 | 低 |
| 图标集中化 | `render/icons.ts` 单文件管理 emoji | 低 |
| `/pnl` `/rank` `/ref` `/settings` | 竞品有、本产品暂无 | 低 |
| Redis | 多实例 + webhook 时替换缓存/限流/去重 | 按需 |
| `holders/detail` | 实测 400，参数待定 | 阻塞 |

## 11. 已知限制

- 名称搜索依赖 CMC 收录索引覆盖：未收录的新币只能靠 DEX search，同名仿盘多时可能排不到正主。
- `token.hld` 不可靠、`bidx` 不可靠、`map?slug=` 不生效——均已绕过，但属于上游数据质量问题。
- 经代理访问 CMC 时单请求 2–3s，1.5s 目标只在直连机房达成。
- 单实例 long polling：两个进程同时跑会抢消息。
