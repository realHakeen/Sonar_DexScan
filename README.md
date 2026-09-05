# DexScan Telegram Bot

> Paste an address, get a due-diligence report.

Users send a token contract address, name, or link in a private chat or group; the bot replies with a single report card covering market data, holder structure, and security checks. Data source: **CoinMarketCap DEX API + main API**.

The differentiator: competitors sit on DexScreener / GeckoTerminal and only see on-chain data. This project uses CMC's `cid` (coin id) to bridge DEX and CEX data, so it can show **real circulating market cap next to FDV**, CMC rank, sector tags, CEX listings, and an official-listing badge.

---

## Quick start

```bash
npm install
cp .env.example .env      # fill in TELEGRAM_BOT_TOKEN and CMC_API_KEY
npm run probe             # hit every endpoint with your real key (recommended)
npm run dev
```

Production:

```bash
npm run build && npm start
```

Leave `TELEGRAM_WEBHOOK_DOMAIN` empty for long polling; set it to switch to webhook mode. `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` from the environment are honoured automatically (Node's `fetch` ignores them by default; the bot fixes that at startup).

For group mode, open @BotFather → your bot → **Bot Settings → Group Privacy → Turn off**, otherwise the bot cannot see regular messages.

---

## Module layout

```
src/
├── config/          env validation (zod), thresholds and weights
├── infra/           logger, TTL cache + in-flight dedupe, rate limiter, errors, proxy
├── api/cmc/         CMC adapter — the only layer that knows the API key
│   ├── endpoints.ts     every endpoint path, with verified request/response shapes in comments
│   ├── client.ts        auth / timeout / backoff retry / cache / dedupe, GET + POST
│   ├── mappers.ts       raw fields → domain model, tolerant aliases
│   ├── dexApi.ts        DEX endpoints facade
│   └── coreApi.ts       main-API facade (cid → market cap / rank / tags)
├── domain/          pure logic, no IO, fully unit-tested
│   ├── chains.ts        chain registry: slug / platform name / explorer / DexScreener id
│   ├── derivatives.ts   perp OI / volume / funding aggregation over the exchange whitelist; liquidation mapping
│   ├── spot.ts          spot venue share over the spot whitelist; CEX-vs-DEX premium
│   ├── calls.ts         call milestones (2x…100x), call age / multiple formatting, Telegram message links
│   ├── detectChain.ts   F1 regex chain-family detection
│   ├── inputParser.ts   F5 link parsing + input classification
│   ├── ranking.ts       F2 re-ranking and disambiguation
│   ├── verification.ts  official-contract check via /cryptocurrency/map
│   ├── holders.ts       concentration / tag fallback computed from holder lists
│   └── risk.ts          risk rule engine
├── services/        orchestration: Promise.allSettled aggregation
├── render/          pure rendering: card, candidate list, keyboards, formatting
└── bot/             Telegraf adapter: middlewares + handlers
```

Dependency direction: `bot → services → domain / api → infra`. `domain` and `render` have no IO, so they are trivially testable; swapping Telegram means rewriting `bot/` only, swapping the data source means rewriting `api/cmc/` only.

---

## PRD coverage

| PRD | Feature | Where |
|---|---|---|
| F1 | Address scan / chain resolution | `domain/detectChain.ts`, `services/scanService.ts` |
| F1.3–4 | Multi-chain hits: highest liquidity wins, others become a hint | `domain/ranking.ts#splitByChain`, `domain/risk.ts` |
| F1.5 | Inline buttons to switch chain | `render/keyboards.ts` |
| F2 | Name / symbol search + disambiguation | `services/searchService.ts`, `domain/ranking.ts` |
| F2 | Official-contract badge (✅ CMC listed) | `domain/verification.ts` |
| F3 | Report card | `render/card.ts` |
| F4 | Group mode + rate limiting | `bot/handlers/message.ts`, `bot/middlewares/throttle.ts` |
| F5 | Link parsing (zero API cost) | `domain/inputParser.ts` |
| F6 | Placeholder → `editMessageText`, concurrent fetches, refresh button | `bot/handlers/scanFlow.ts`, `services/scanService.ts` |
| — | K-line chart preview above the card (market-cap candles, ATH, volume) | `render/chart.ts`, `services/chartService.ts`, `infra/httpServer.ts` |
| F3b | Perps block: open interest, perp volume, funding, liquidations (cid-only) | `domain/derivatives.ts`, `api/cmc/coreApi.ts`, `render/card.ts` |
| F3e | Group call tracking: first caller line on the card (`🚀 user @ $21.5M [10.5x] (37d ago) 🔼`) and a milestone banner (2x…100x, once per group/token) posted when a rescan crosses a threshold; zero extra credits | `services/callService.ts`, `domain/calls.ts`, `render/banner.ts`, `assets/banner-bg.jpg` |
| F3d | `⭐ Add to Portfolio` + `/portfolio`: per-user starred tokens with change since added (SQLite via `node:sqlite`, `DATA_DIR`) | `infra/db.ts`, `services/portfolioService.ts`, `bot/handlers/portfolio.ts` |
| F3c | Spot block: CEX listings, spot volume + 24h change, CEX/DEX split, top venues by volume (whitelist), CEX-vs-DEX premium | `domain/spot.ts`, `api/cmc/coreApi.ts`, `render/card.ts` |
| — | `/perp <ticker or address>`: per-venue OI / volume / funding, basis vs index, 1h / 4h / 24h liquidations; native coins supported | `services/perpService.ts`, `render/perpCard.ts`, `bot/handlers/perpFlow.ts` |

### Deliberate implementation details

- **`pc24h` is a fraction**; it is multiplied by 100 once in `mappers.ts`, so the render layer only ever sees percentages.
- **`mc` / `mcap` is FDV, not circulating market cap.** The card label is hard-coded to `FDV`; real market cap comes from `cid → /v2/cryptocurrency/quotes/latest` (fallback: `token.lmc`) and is shown alongside.
- **Server-side search order is unusable.** Searching `PEPE` returns dozens of copycats with near-identical text relevance; the client re-ranks by `liquidity > volume > has cid > traders`, and penalises wash-traded pools (high volume, few traders).
- **Bare names do not trigger scans in groups.** "this pepe looks good" must not fire a query; groups respond to addresses, links, or an explicit `@bot` mention only.
- **No sub-request can break the card.** `buildReport` uses `Promise.allSettled`; failures go into `degraded[]` and are footnoted on the card, missing fields are simply omitted — never guessed.
- **Perp OI is summed client-side over a 16-exchange whitelist, never over everything CMC returns.** The v5 derivatives endpoint has no per-coin total, and roughly a third of the venues it lists report fake open interest (HMSTR showed $1.4B on one venue against $2M on Binance). `exchange_score` cannot be used as the filter: several inflated venues score 8+, while Hyperliquid has a liquidity score of 0 and edgeX / dYdX have no score at all. The list lives in `config/constants.ts#PERP_EXCHANGE_WHITELIST`; on top of it, pairs flagged `outlier_detected` / `exclusions` are dropped and a venue whose OI exceeds the runner-up by 20× is treated as a glitch. Funding is shown for the largest venue only, normalised to 8h (Hyperliquid / Lighter settle hourly, edgeX every 4h) — cross-venue averaging would mix periods. Liquidations come pre-aggregated by CMC but only cover 9 venues, so they are a lower bound.
- **Search failure ≠ not found.** Network errors surface as "could not reach the data source"; when search misses a brand-new token, EVM addresses are probed in parallel across BNB / Ethereum / Base / Arbitrum via `/v1/dex/token`.

---

## Data-source call chain (every endpoint verified with a real key, 2026-09-02)

```
/v1/dex/search                GET q                         chain resolution + candidates. plt is a display name ("Ethereum"/"BSC"/"Solana"), pc24h is a fraction
/v1/dex/token                 GET platform + address        main card data: market, 24h buy/sell stats, top pools, CEX listings, owner, cid, lmc
/v1/dex/security/detail       GET platformName + address    security assessment (Binance / W3W): rating, taxes, itemised checks, honeypot status
/v1/dex/holders/trend/list    GET interval=1d               holder count + holdingRatioOfTop10/50/100
/v1/dex/holders/tag_count     GET                           [{ tag, hc, tb, hr }]
/v1/dex/holders/count         GET                           holder-count fallback (only when trend is empty)
/v1/dex/holders/list          POST { tokenAddress, platform, tag }  concentration / tag fallback; reused by /th /nh
/v1/k-line/candles            GET platform + address + interval + pm=m   [o,h,l,c,v,ts,traders] for the chart image (v4 ohlcv/* returns 500)
/v1/cryptocurrency/map        GET symbol                    official-contract comparison (✅ CMC listed)
/v2/cryptocurrency/quotes/latest GET id                     real market cap / rank / sector tags, spot volume split (cex_volume_24h / dex_volume_24h)
/v2/cryptocurrency/market-pairs/latest GET id + category=spot   top-100 spot pairs by volume for per-venue share (1 credit / 100 pairs; num_market_pairs echoes the returned count)
/v5/cryptocurrency/derivatives/market-pairs/list/latest GET crypto_id   every perp pair with open_interest / funding_rate / volume per venue (no per-coin total; 1 credit up to limit=200)
/v5/derivatives/liquidations/cryptocurrency/list/latest GET crypto_id   1h / 4h / 24h long + short liquidations, pre-aggregated by CMC across 9 venues
```

One scan = 1 search + 5 concurrent detail requests (token / security / trend / tag_count / core), plus 3 more (spot pairs / perp pairs / liquidations) when the token has a `cid`. Measured end-to-end on three chains at ~1.5s direct, ~6s through a slow proxy, with zero degraded sub-requests.

**Findings that differ from the docs or from intuition** (all captured in `mappers.ts` comments):

- `status.error_code` is a string (`"0"` on success) — convert before comparing
- v1 endpoints accept the `plt` value from search verbatim as `platform`, case-insensitive; numeric ids are rejected
- `token.mcap` = price × total supply, i.e. FDV; `token.lmc` is the CMC-listed circulating market cap
- `token.hld` is often `0` for EVM tokens; holder counts come from the holders endpoints
- `sts[].pc` and `pc24h` are fractions (PEPE `-0.0136` ↔ main API `-1.23%`); v4 `percent_change_price_24h` is already a percentage
- `holders/list.tags` is a JSON string `{"tag_whale":1,...}`; `percent` is already in percent units
- `/v4/dex/spot-pairs/latest` requires `dex_id`/`dex_slug` and cannot list all pools for a token — dropped in favour of `/v1/dex/token.pls`
- `/v4/dex/networks/list` and `/v4/dex/listings/info` currently return 500 upstream; startup tolerates it
- v5 derivatives endpoints take `crypto_id` / `exchange_slug`, not the `id` / `slug` the docs show; `sort` does not accept `open_interest`; the liquidations-by-exchange endpoint ignores `crypto_id`, so a per-venue split of one coin's liquidations is not available

Re-run the probe whenever you get a new key or the upstream changes:

```bash
npm run probe -- <contract address> [platform]
```

---

## Deploy to Railway

The bot is a single long-running process (long polling), which is exactly what Railway runs. No webhook, no domain, nothing to configure in Telegram.

**1. Push the repo to GitHub** (Railway deploys from Git; `railway up` from the CLI also works without Git).

**2. Create the service**: Railway dashboard → *New Project* → *Deploy from GitHub repo* → pick this repo. Railway detects `railway.json` and builds with the `Dockerfile`.

**3. Add a Volume** (service → *Settings* → *Volumes*) mounted at `/data`, so the portfolio database survives redeploys. Railway mounts volumes owned by root while the image runs as the `node` user, so also set `RAILWAY_RUN_UID=0` (Railway's documented workaround; with `1000` SQLite fails with `unable to open database file`). Without a volume the bot still runs, portfolio is simply disabled.

**4. Set variables** in the service's *Variables* tab:

| Variable | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | from @BotFather |
| `CMC_API_KEY` | your CoinMarketCap Pro key |
| `CMC_TIMEOUT_MS` | `6000` — Railway's US region reaches CMC directly, no proxy latency |
| `CMC_MAX_RETRIES` | `1` |
| `LOG_LEVEL` | `info` |
| `DATA_DIR` | `/data` — the Volume mount from step 3 (portfolio database) |
| `RAILWAY_RUN_UID` | `0` — needed for the Volume to be writable (see step 3) |

Leave `TELEGRAM_WEBHOOK_DOMAIN` unset. Railway injects `PORT` automatically; the bot uses it to serve `/health` and the K-line chart images.

**Enable chart previews**: Settings → Networking → **Generate Domain**. Railway then injects `RAILWAY_PUBLIC_DOMAIN` and the bot starts attaching a 7-day candlestick chart (`/v1/k-line/candles`, rendered server-side) above every card. Without a public domain the bot runs normally, just without charts. Self-hosting elsewhere: set `PUBLIC_BASE_URL` to your https origin and make sure `ttf-dejavu` (or any TTF font) is installed for text rendering.

**5. Deploy.** First build takes ~1–2 min. Check *Deployments → Logs* for `Bot started (long polling)` and `coin index loaded`.

**Operational notes**

- **Keep replicas at 1.** Long polling hands each Telegram update to exactly one `getUpdates` caller; two replicas would race and drop messages. `railway.json` pins `numReplicas: 1`. One 0.5 vCPU / 512 MB instance handles hundreds of concurrent scans — the real ceiling is CMC credits (~6 per scan) and Telegram's per-chat send limit, not the process.
- **Stop any local `npm run dev`** using the same bot token before deploying, for the same reason.
- Every push to the connected branch redeploys. The coin index is rebuilt from CMC on each start and refreshed hourly in-process.
- Scaling later (thousands of scans/min): switch to webhook mode (`TELEGRAM_WEBHOOK_DOMAIN`), swap `infra/cache.ts` and the rate limiter for a Redis implementation (Railway has a one-click Redis add-on), then raise replicas.

---

## Tests

```bash
npm test        # node:test — chain detection, link parsing, ranking, mappers, holders, risk rules, formatting
npm run typecheck
```

---

## Not implemented (outside the PRD MVP)

- `/c` charts, `/th` `/tt` `/fb` holder and trader lists, `/pnl` cards, `/rank`, `/ref`
- Multi-instance deployment needs `infra/cache.ts` swapped for a Redis implementation (interface already isolated)
- Persistence: callback tokens and rate-limit state live in process memory. Inline-encoded buttons survive restarts; the token fallback (only for over-long Sui/Aptos coin types) does not

---

*Data by CoinMarketCap. For information only — not financial advice.*
