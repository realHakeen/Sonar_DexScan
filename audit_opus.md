# Sonar_DexScan — Production-Readiness Audit

**Scope:** whole repository at `main@8d5f3a8` (~8.5k lines TS, `src/` + `test/`).
**Lens:** security, reliability, correctness, test coverage — treating the bot as production-bound.
**Method:** full static read of every file under `src/`, `test/`, `scripts/`, plus build/deploy config.

> **Caveat on verification:** no Node runtime is available on this machine (`node`, `npm`, `npx` all absent), so I could **not** run `npm test`, `npm run typecheck`, or the bot. Every finding below is derived from reading the code. Findings marked **[unverified]** are ones I would want to confirm by execution before acting; everything else is deterministic from the source.

**Overall:** this is well-above-average code. The layering (`bot → services → domain/api → infra`) is clean, the domain logic is pure and genuinely well tested, degradation paths are deliberate (`softFail`, `degraded[]`, `Promise.allSettled` everywhere), and the comments record real API measurements rather than guesses. The gaps are concentrated in three places the tests don't reach: **the trust boundary at the edges (webhook, public HTTP endpoint, HTML rendering of upstream strings)**, **cost control on the CMC credit budget**, and **the untested infra layer**.

---

## Severity summary

| # | Severity | Finding | Location |
|---|---|---|---|
| 1 | **High** | Webhook mode accepts unauthenticated updates (no `secretToken`) | `src/index.ts:29` |
| 2 | **High** | `/chart` is a public, unauthenticated, cost-amplifying endpoint | `src/infra/httpServer.ts:37` |
| 3 | **High** | Address scan silently falls back to unrelated search results | `src/services/scanService.ts:66` |
| 4 | **Med-High** | `escapeHtml` does not escape `"`, but is used inside `href="…"` | `src/render/format.ts:5,87` |
| 5 | **Med-High** | No URL scheme allowlist for upstream-supplied links (`tg://` abuse) | `src/render/card.ts:398` |
| 6 | **Medium** | Polling `launch()` rejection is swallowed; `/health` still returns 200 | `src/index.ts:43` |
| 7 | **Medium** | Button callbacks bypass all rate limiting → unbounded CMC spend | `src/bot/handlers/callbacks.ts`, `portfolio.ts:131` |
| 8 | **Medium** | Errors are reported to the user twice | `src/bot/handlers/scanFlow.ts:137`, `middlewares/errorBoundary.ts:19` |
| 9 | **Medium** | Tests cannot run without production secrets in the environment | `src/config/env.ts:60` |
| 10 | **Medium** | Webhook mode silently breaks `/health` and chart previews | `src/index.ts:28` |
| 11 | **Medium** | `engines: node >=20` but `node:sqlite` needs ≥22.5 | `package.json:8`, `src/infra/db.ts:3` |
| 12 | **Medium** | No CI: no automated typecheck/test gate | (absent `.github/`) |
| 13 | **Low-Med** | SSRF: arbitrary upstream URLs fetched server-side | `src/services/chartService.ts:23` |
| 14 | **Low-Med** | Unbounded chain-registry growth from user-controlled slugs | `src/domain/chains.ts:258` |
| 15 | **Low-Med** | Server-side SVG→PNG rasterisation blocks the event loop | `src/render/chart.ts:187` |
| 16 | **Low** | `formatPrice` off-by-10× when the mantissa rounds up a decade | `src/render/format.ts:28` |
| 17 | **Low** | Double HTML-escaping of user/upstream text | `src/render/candidates.ts:9`, `perpCard.ts:77,114,116` |
| 18 | **Low** | Read-then-write races in `CallService` / `PortfolioService` | `src/services/callService.ts:74`, `portfolioService.ts:61` |
| 19 | **Low** | Retry backoff sleeps while the abort timer is still armed | `src/api/cmc/client.ts:127,158` |
| 20 | **Low** | `callback_data` is `|`-delimited but `symbol` is never sanitised | `src/bot/callbackData.ts:74` |
| 21 | **Low** | Non-reproducible Docker base image; DB never closed on shutdown | `Dockerfile:2,10`, `src/index.ts:19` |
| 22 | **Low** | Docs recommend `RAILWAY_RUN_UID=0`, undoing `USER node` | `README.md:144` |
| 23 | **Info** | Multi-replica scaling path is broken by in-process state | `README.md:169` |

---

## Security

### 1. [High] Webhook mode accepts unauthenticated updates — no `secretToken`

`src/index.ts:28-35`

```ts
await built.bot.launch({
  webhook: { domain: env.TELEGRAM_WEBHOOK_DOMAIN, path: env.TELEGRAM_WEBHOOK_PATH, port: env.PORT },
});
```

Telegraf supports `secretToken` here (it sets `secret_token` on `setWebhook` and validates the `X-Telegram-Bot-Api-Secret-Token` header on every inbound request). It is not set, and the default path is the fully guessable `/tg/webhook` (`src/config/env.ts:10`).

Anyone who can reach the public origin can `POST` a forged `Update` and the bot will process it as genuine. Consequences, all reachable from the handlers as written:

- **Identity spoofing.** `trackCall` (`scanFlow.ts:215-224`) writes `ctx.from.id`, `username`, `displayName` straight into the `calls` table, and the milestone banner then credits that user publicly with a link to `t.me/<username>`. An attacker can attribute a 100× call to anyone.
- **Watchlist tampering.** `handlePortfolioAdd`/`handlePortfolioCallback` key entirely off `ctx.from.id` (`portfolio.ts:12-13`), so an attacker can add to, or `port_del` from, any user's watchlist.
- **Message injection into any chat the bot is in.** `runScanFlow` replies into `ctx.chat.id` taken from the forged update.
- **Unbounded credit burn** — each forged update can drive a full 5–8-call scan.

**Fix:** generate a high-entropy secret, pass it as `webhook.secretToken`, and require it in config whenever `TELEGRAM_WEBHOOK_DOMAIN` is set (a `superRefine` in `src/config/env.ts`). Also randomise the default path.

Note the README (line 138) says to use polling, so this is currently latent — but webhook mode is a supported, documented (`README.md:169`) scaling path with a code path already written, and it will be reached the first time someone scales.

### 2. [High] `/chart/{chain}/{address}.png` is public, unauthenticated, and amplifies cost

`src/infra/httpServer.ts:37-56` → `src/services/chartService.ts:78-129`

The endpoint must be publicly fetchable — Telegram's servers pull it for the link preview — but it has no authentication, no signature, and no rate limit, while each *unseen* `(chain, address)` pair costs real money and CPU:

- `resolveMeta` (line 149) issues a `tokenDetail` call for any address it hasn't seen (1 credit);
- `build` (line 101) issues one, sometimes two, `klineCandles` calls (1 credit each);
- `renderChartPng` rasterises a 1000×500 SVG **synchronously on the event loop**.

The `failed` cache (line 72) only holds 30s and is keyed per address, so an attacker iterating random addresses gets a fresh miss every request. `README.md:166` puts the real ceiling at "CMC credits (~6 per scan)" — this endpoint lets an unauthenticated third party spend that budget directly, and to stall the bot's event loop while doing it.

**Fix:** make the URL bearer-authenticating rather than the endpoint public. `ChartService.register` already builds the URL — append an HMAC over `(networkSlug, address, bucket)` keyed on a server secret, and reject unsigned/expired requests in `httpServer.ts` before any upstream call. Add a small global token bucket in front of `render()` as defence in depth, and move rasterisation off-thread (see #15).

### 3. [High] An address scan can silently render a report for a *different* token

`src/services/scanService.ts:60-77`

```ts
const found   = await this.cmc.dex.search(address).catch(…);
const matched = found.filter((c) => c.address.toLowerCase() === address.toLowerCase());
const pool    = matched.length > 0 ? matched : found;   // ← line 66
…
if (!primary) ({ primary, secondary } = splitByChain(pool));
```

When the upstream search returns results but **none of them match the address the user pasted**, the code falls back to *all* results and picks the highest-liquidity one. The user then gets a full due-diligence card — contract address, risk flags, holder concentration, the ✅ CMC-listed badge — for a token they never asked about, with no indication of the substitution. In a tool whose entire value proposition is "paste an address, learn whether it is a scam", rendering the wrong token is the worst possible failure mode.

I believe this fallback exists to handle address *normalisation* differences (TON bounceable vs non-bounceable `EQ…`/`UQ…`, Sui coin-type casing), where the upstream legitimately returns a different string for the same asset. That is a good reason to not require byte equality — but it is not a reason to accept an arbitrary unrelated result.

**Fix:** constrain the fallback. Accept a non-exact match only when it is plausibly the same asset — same chain family as `detectChain(address)`, and either a case-insensitive match after chain-specific normalisation or a substring/checksum relationship. Otherwise fall through to the existing `tokenDetail` chain-probe path (line 79-98), which already handles "search missed it". If a substituted result is ever shown, say so on the card.

**[unverified]** — I cannot exercise `/v1/dex/search` to see how often it returns non-matching rows for an unknown address. Even if that is rare today, the guard costs three lines and the failure is silent.

### 4. [Med-High] `escapeHtml` does not escape `"`, but its output goes inside `href="…"`

`src/render/format.ts:5-7` and `86-88`

```ts
export function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, …);          // no " and no '
}
export function link(text: string, url: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;   // attribute context
}
```

Escaping `&<>` is correct for *text* context but insufficient for *attribute* context. Every URL in `renderLinks` (`card.ts:398-409`) is upstream-controlled token metadata: `p.website` (`w`/`web`), `p.twitter`, `p.telegram` (`tg`), `p.tradeUrl` (`turl`), plus `explorerUrl`/`dexscanUrl`, which interpolate the raw upstream `address` into a template (`chains.ts:189-223`). None of those are validated in `toTokenCandidate` (`mappers.ts:105-147`).

A single `"` in any of those fields terminates the attribute early and produces markup Telegram's strict HTML parser rejects (it allows only `href` on `<a>`). The `sendMessage`/`editMessageText` call then fails with a 400, the user gets the generic error, and **that token becomes permanently unscannable** — a durable, attacker-plantable denial of service against any specific token, including a legitimate competitor's.

**Fix:** add `"` (and `'`) to `escapeHtml`, or better, split into `escapeText` and `escapeAttr` so the distinction is explicit and can't regress. Add a mapper-level test with a `"` in `web`/`tw`/`turl` and a `"` in `addr`.

### 5. [Med-High] No scheme allowlist on upstream-supplied links

Same code path as #4. `link()` will happily emit whatever scheme the upstream string carries. Telegram renders `tg://` links, and `tg://proxy?server=…&secret=…` / `tg://resolve?domain=…` / `tg://join?invite=…` are established abuse primitives. A scam token can therefore get *this bot* — the trusted party in the conversation — to render an authoritative-looking `Website` link that routes the victim's traffic through an attacker-controlled MTProto proxy or into an attacker's channel.

`normalizeTwitter` (`mappers.ts:87-91`) makes it worse for one field: `if (v.startsWith('http')) return v;` passes `httpfoo://` through, and otherwise concatenates unvalidated input into `https://x.com/${…}`.

**Fix:** a single `safeUrl(raw): string | undefined` helper in the mapper layer — parse with `new URL()`, require `https:` (or `http:`), drop everything else, and drop the link entirely rather than rendering a broken one. Apply to `website`, `twitter`, `telegram`, `tradeUrl`, `logo`.

### 6. [Low-Med] Server-side SSRF via upstream image URLs

`src/services/chartService.ts:23-36`

```ts
const res = await fetch(url, { signal: AbortSignal.timeout(3000), headers: { Accept: 'image/…' } });
```

`url` is `c.logo` (upstream `l`/`lg`/`logo`), reachable via `ChartService.register` → `logo()` and via `logoDataUri()` in the milestone banner. There is no host allowlist, no private-IP rejection, and redirects are followed by default (undici follows up to 20). The response is base64-embedded into a PNG that is then sent to a chat — a working, if narrow, exfiltration channel for anything that can be served with an `image/png|jpeg` content type. The `512 KB` cap and content-type check (lines 29-31) limit but do not close it.

**Fix:** allowlist the CMC static hosts (`s2.coinmarketcap.com` etc.), set `redirect: 'manual'`, and reject non-public destinations. Chain logos are already derived from a fixed template (`chains.ts:184-187`) and need no fetch of arbitrary hosts at all.

### 7. Positives worth recording

- API key lives only in `CmcClient` (`client.ts:104`); no layer above it can see it. Logs record `path`/`credit_count`, never the key.
- Proxy credentials are masked before logging (`proxy.ts:15`).
- Every SQL statement is prepared and parameterised (`portfolioService.ts`, `callService.ts`); no string-built SQL anywhere.
- No committed secrets — `git log -S` over history turned up only `.env.example` with placeholders; `.gitignore`/`.dockerignore` both exclude `.env`.
- `Dockerfile` runs `USER node` and prunes dev dependencies.
- `/watchlist` is correctly routed to DM when invoked in a group (`portfolio.ts:85-92`), so one user's holdings never leak into a shared chat.

---

## Reliability

### 8. [Medium] A failed polling launch is invisible and the health check lies

`src/index.ts:43-57`

```ts
void built.bot.launch(() => log.info('Bot started (long polling)'));
…
health: () => ({ ok: true, … })
```

`launch()`'s promise is discarded. If it rejects — invalid token, revoked token, `409 Conflict` from a second `getUpdates` consumer, permanent network failure — the `unhandledRejection` handler (line 24) writes one log line and the process keeps running. `/health` unconditionally returns `ok: true` (line 50), so Railway's health check passes and the restart policy never fires. **The bot is dead and the platform believes it is healthy** — the single worst outcome for an always-on service.

**Fix:** `.catch()` the launch, set a `botRunning` flag, and have `health()` return `ok: false` (→ 503, already wired at `httpServer.ts:32`) when it is false. Consider `process.exit(1)` on launch failure so the restart policy can do its job.

### 9. [Medium] Every error is delivered to the user twice

`src/bot/handlers/scanFlow.ts:137-141` edits the placeholder message to the user-facing error text and then re-throws. `errorBoundary` (`middlewares/errorBoundary.ts:19-25`) catches it and, for a message-originated update, sends `ctx.reply(text)` — a *second* copy. `runPerpFlow` has the same shape (`perpFlow.ts:84-88`).

For callback-originated updates the second delivery is `answerCbQuery`, which was already answered in `callbacks.ts:61/90/106` — Telegram rejects the duplicate, which is then caught and logged as `failed to send error reply` at **error** level. So the production log fills with error-level noise on every ordinary "token not found".

**Fix:** have `runScanFlow`/`runPerpFlow` mark the error as already surfaced (a flag on the error, or a `handled` symbol) and have `errorBoundary` skip re-delivery; or don't re-throw once the message has been edited, and log at the throw site instead.

### 10. [Medium] Webhook mode silently disables `/health` and chart previews

`src/index.ts:28-61`. `startHttpServer` is called only in the `else` (polling) branch — in webhook mode the port belongs to Telegraf, which serves only the webhook path. Two consequences:

- `railway.json` sets `healthcheckPath: "/health"`. In webhook mode nothing serves it, so the deploy fails its health check.
- `publicBaseUrl` is still truthy, so `ChartService.enabled` is `true` and `register()` keeps emitting `/chart/…png` URLs (`chartService.ts:56-69`) that now 404. Telegram silently drops the preview and every card loses its chart with no log line.

**Fix:** mount the `/health` and `/chart` routes on Telegraf's own server in webhook mode (Telegraf exposes `webhookCallback` / accepts a `cb`), or start the HTTP server unconditionally on a separate port. At minimum, force `ChartService.enabled = false` and log a warning when `isWebhookMode && !chartRouteMounted`.

### 11. [Medium] Callbacks bypass rate limiting entirely

`admitScan` is deliberately not applied to callbacks (`throttle.ts:16`, "用户已经看到卡片，点刷新应当即时响应"). The reasoning is sound for latency, but the consequence is that the **most expensive operations in the app are the only unmetered ones**:

- `port_refresh` (`portfolio.ts:126-135`) calls `listWithQuotes`, which fans out to up to 20 tokens — one `quotesBatch` plus up to 20 `tokenDetail` calls, each with a `search` fallback (`portfolioService.ts:108-115`). No throttle, no in-flight guard, no debounce. A user holding the button down issues that fan-out repeatedly.
- `port_scan` (`portfolio.ts:110-117`) runs a **full scan into a brand-new message** with no throttle and no in-flight key, so the `inflight` de-duplication in `runScanFlow` never applies.
- `refresh` / `perp_refresh` are protected only by the per-message `inflight` set, which stops concurrent clicks but not serial ones.

Response caching (15–30 s TTLs) blunts the worst of it, but the exposure is real and it is the same budget #2 attacks.

**Fix:** apply a separate, more generous callback budget (e.g. 60/min/user) rather than none, and add an `inflight` guard around `port_refresh` and `port_scan` keyed on `chatId:messageId` / `userId` the way the other flows already do.

### 12. [Low-Med] Synchronous rasterisation on the event loop

`renderChartPng` (`chart.ts:187-195`) and `renderBannerPng` (`banner.ts:59-62`) run resvg synchronously — 1000×500 and 1200×796 respectively. Every millisecond spent there is a millisecond the bot cannot answer any other user, and via #2 an unauthenticated party controls how often it happens. Move to a worker thread or a small queue with a concurrency cap.

### 13. [Low-Med] Unbounded chain-registry growth from attacker-controlled input

`src/domain/chains.ts:152-159, 258-262`

```ts
get(slug) { return this.bySlug.get(key) ?? this.dynamic.get(key) ?? this.registerDynamic(key); }
private registerDynamic(slug) { const spec = {…}; this.dynamic.set(slug, spec); return spec; }
```

`get()` **writes** on every miss, into a `Map` with no cap and no eviction. Reachable slugs come from user input: `parseLink` reads `?chain=` / `?network=` from any pasted URL (`inputParser.ts:111,116`) and `parseLink`'s CMC branch takes `segments[idx+1]` verbatim (line 90); `remember()` (line 248) also writes from upstream `plt`. Posting links with varying `?chain=` values in a group grows the map without bound — a slow memory leak, and a trivially automatable one.

**Fix:** make `get()` non-mutating (return an ephemeral fallback spec), or bound `dynamic` with an LRU. Also validate the slug shape before registering.

### 14. [Low] Read-then-write races

- `CallService.track` (`callService.ts:74-98`): `get` then `INSERT` with no transaction. Two members posting the same address simultaneously in a group both see no row and both insert → `UNIQUE` violation on the second. It is caught in `trackCall`'s try/catch (`scanFlow.ts:227`) so nothing breaks, but the second scan loses its call attribution silently. Use `INSERT … ON CONFLICT DO NOTHING` + re-read, or wrap in `BEGIN IMMEDIATE`.
- `PortfolioService.add` (`portfolioService.ts:59-80`): `has` → `size` → `INSERT`, same shape. A double-tap on ⭐ raises a `UNIQUE` error that escapes to `errorBoundary` and shows the user a generic failure for what should be an idempotent "already added". Use `INSERT … ON CONFLICT DO NOTHING` and read `changes`.

### 15. [Low] Retry backoff runs with the abort timer still armed

`src/api/cmc/client.ts:93-164`. `await sleep(this.backoff(…))` at lines 127 and 158 sits inside `try`/`catch`, so `clearTimeout(timer)` in the `finally` (line 162) does not run until *after* the sleep. The stale timer then calls `abort()` on an already-settled controller — harmless today, but it means a request's effective deadline silently includes its own backoff, and it leaves a live timer per in-flight retry. Clear the timer at the top of the catch.

### 16. [Low] Shutdown is not actually graceful, and the DB is never closed

`src/index.ts:15-20`: the 2-second grace timer is `.unref()`d, so it cannot hold the loop open — once `bot.stop()` releases its handles the process exits immediately and the timer's stated purpose ("give in-flight requests time to finish") is not achieved. Separately, `DatabaseSync` is never `close()`d, so WAL is never checkpointed on shutdown. Data is still durable (the `-wal` file persists), but on an ephemeral filesystem without the volume it is not.

### 17. [Low] `callback_data` is `|`-delimited and `symbol` is unsanitised

`src/bot/callbackData.ts:60-83`. `encodeCallback` interpolates `payload.symbol` — an upstream string, uppercased but otherwise unvalidated (`mappers.ts:115`) — into a `|`-delimited record, and `decodeCallback` splits on `|` positionally. A symbol containing `|` shifts every field. Strip or percent-encode `|` before encoding.

---

## Correctness

### 18. [Low] `formatPrice` is off by 10× when the mantissa rounds up a decade

`src/render/format.ts:26-29`

```ts
const exp = Math.floor(Math.log10(v));
const leadingZeros = Math.abs(exp) - 1;
const digits = Math.round(v * 10 ** (leadingZeros + 4)).toString().slice(0, 4);
return `$0.0${toSubscript(leadingZeros)}${digits}`;
```

When rounding to 4 significant figures carries into a 5th digit, `slice(0, 4)` silently drops the carry without decrementing `leadingZeros`.

`formatPrice(0.00099999)`: `exp = -4`, `leadingZeros = 3`, `round(9999.9) = 10000`, `slice → "1000"` → renders **`$0.0₃1000`** (= 0.0001000), a **10× understatement** of a price of ~0.001.

This fires for roughly the top 0.005% of each decade — rare, but deterministic, silent, and it is a *price* in a financial tool. Same shape affects the chart's Y-axis labels and ATH badge via `fmtY`.

**Fix:** detect the carry (`if (digits.length > 4) leadingZeros -= 1`) and recompute, or use `toPrecision(4)` and derive the zero count from the result. Add the boundary case to `test/format.test.ts`.

Related: the doc comment on line 18 gives `0.000000001234 → $0.0₆1234`, but the code (and `test/format.test.ts:6`) correctly produce `$0.0₈1234`. The comment is wrong.

### 19. [Low] Double HTML-escaping of user and upstream text

`bold()` (`format.ts:90-92`) already escapes, but four call sites pre-escape:

- `src/render/candidates.ts:9` — `bold(escapeHtml(query))`, `query` is user input
- `src/render/perpCard.ts:77` — `bold(escapeHtml(v.symbol))`
- `src/render/perpCard.ts:114` — `bold(escapeHtml(query))`
- `src/render/perpCard.ts:116` — `bold(escapeHtml(h.symbol))`

A query of `A&B` renders as `A&amp;B` on screen. Cosmetic, but it is exactly the kind of drift that later gets "fixed" by removing the escaping in the wrong layer. Drop the inner `escapeHtml`.

### 20. [Low] `formatUsdShort` silently discards the sign

`src/render/format.ts:139-146` computes `abs` and never re-applies the sign, unlike `formatUsd` (line 37-41), which does. Today all its inputs (OI, volume, liquidations, market cap) are non-negative so nothing is visibly wrong, but two functions with near-identical names behaving differently on negatives is a latent trap — `formatUsdShort(-5000)` renders `$5K`.

### 21. [Low] No message-length guard before `editMessageText`

`renderScanCard` concatenates header + links + up to 8 market rows + 3 pools + holders + 8 risks + ~8 security rows + 6 perp rows + 5 spot rows + call line + degraded notice. Upstream-controlled `name`, `categories`, `cexListings` names and DEX names all feed in unbounded. Nothing checks against Telegram's 4096-character limit before sending; overflow is a 400 and, via the error path, a double error message (#9). A `text.slice()` with an ellipsis, or a length assertion in the card tests, would close it.

Similarly `answerCbQuery` is capped at 200 chars in `errorBoundary.ts:22` but not in `portfolio.ts:65-71`, where the toast interpolates an unbounded upstream `symbol`.

### 22. [Info] `aggregatePerpPairs` outlier loop stops early on a zero second-place

`src/domain/derivatives.ts:90`: `while (… && kept[1].openInterestUsd > 0)`. If the second-largest venue reports exactly 0 OI, a genuinely absurd first-place value is kept. Narrow, and arguably the safe default, but worth a comment so it isn't mistaken for a bug later.

### 23. [Info] `isMentioningBot` matches prefixes

`src/bot/handlers/message.ts:55-59` uses `includes('@' + username)`, so `@mybot_evil` counts as a mention of `@mybot`. Low impact (it only widens group triggering), but a word-boundary check is one character of regex.

---

## Test coverage

The **domain and render layers are genuinely well covered** — 17 test files, ~90 cases, and the assertions are specific and behavioural (exact rendered strings, exact aggregation outputs) rather than tautological. `derivatives`, `risk`, `ranking`, `mappers`, `inputParser`, `holders`, `spot`, `coinIndex`, `rateLimiter`, `callbackData` and the card renderers are all tested against realistic fixtures drawn from measured API responses. That is the right thing to have tested first.

### 24. [Medium] The suite cannot run without production secrets

`src/config/env.ts:60` evaluates `load()` at module scope and **throws** if `TELEGRAM_BOT_TOKEN` or `CMC_API_KEY` are absent. Most test files transitively import it (`test/risk.test.ts` → `domain/risk` → `config/constants` → `config/env`; likewise `card`, `ranking`, `calls`, `perp`, `portfolio`, `chains`, `coinIndex`). Since `.env` is gitignored, **`npm test` fails on a clean checkout and would fail in any CI job that does not inject real credentials.**

**Fix:** either lazily evaluate `env` (a getter / `loadEnv()` called from `src/index.ts`), or have the schema fall back to test-safe defaults when `NODE_ENV === 'test'`. Since `RISK_THRESHOLDS` and `RANKING_WEIGHTS` are the only reason the domain touches env at all, injecting thresholds into `evaluateRisks`/`scoreCandidate` would sever the dependency cleanly and make the domain layer genuinely IO-free as the README claims (line 44).

**[unverified]** — I could not execute the suite to confirm the failure, but the import chain is unambiguous.

### 25. [Medium] No CI

There is no `.github/`, no pipeline config of any kind. `npm run typecheck` and `npm test` exist and are presumably run by hand. For production-bound code, a push/PR workflow running `typecheck` + `test` (+ `docker build`) is the single highest-value addition in this document, because it is what keeps every other fix here from regressing.

### 26. [Medium] Zero coverage of the entire `infra/`, `api/`, `services/` and `bot/` layers

Untested, in rough priority order:

| Module | Why it matters |
|---|---|
| `api/cmc/client.ts` | Retry/backoff, timeout→`TimeoutError`, `softFail` 4xx vs 5xx, the string-vs-number `error_code` quirk (line 138), envelope-vs-bare-body detection (line 147). All are subtle, all are load-bearing, all are trivially testable against a stubbed `fetch`. |
| `infra/cache.ts` | In-flight de-duplication and the eviction path (line 66-78) — concurrency logic with no test at all. |
| `services/scanService.ts` | `buildReport`'s merge precedence (line 158-167), the pool-TVL liquidity override (172-175), the holders/concentration fallback ladder (177-200), `degraded[]` accumulation. This is the most intricate logic in the codebase and the most user-visible. Finding #3 lives here. |
| `bot/middlewares/errorBoundary.ts` | Finding #9 would have been caught by one test. |
| `bot/handlers/message.ts` | The group-trigger policy (`isExplicit`, line 41-44) is a product-critical rule — the difference between "useful in groups" and "banned from groups". |
| `infra/httpServer.ts` | Route matching, 404/500 behaviour, and the `..`-in-slug case. |
| `domain/verification.ts` | The ✅ badge is the bot's core trust signal and its logic is untested. |
| `services/perpService.ts` | `resolve()`'s address → index → search → `marketDataBySymbol` ladder. |

`services/portfolioService.ts` and `services/callService.ts` *are* partially covered (`test/portfolio.test.ts`, `test/calls.test.ts`) against an in-memory DB — good, and the pattern generalises: `openMemoryDatabase()` plus a stub `CmcGateway` is enough to cover `scanService` too.

### 27. [Low] Specific cases worth adding

- `formatPrice(0.00099999)` — finding #18.
- `toTokenCandidate` with `"` in `web` / `tw` / `turl` / `addr` — finding #4.
- `scanByAddress` where `search` returns only non-matching rows — finding #3.
- `encodeCallback` with `|` in `symbol` — finding #17.
- `renderScanCard` length assertion against 4096 with maximal fixtures — finding #21.
- `TtlCache.wrap` under concurrent callers, and rejection cleanup of `inflight`.

---

## Build, deploy and configuration

### 28. [Medium] `engines` understates the real Node requirement

`package.json:8` declares `"node": ">=20"`, but `src/infra/db.ts:3` imports `node:sqlite`, which does not exist before Node 22.5 (and is still flagged experimental in 22.x). On Node 20 the import fails at module load; because `db.ts` is imported by `services/index.ts`, that is a hard crash at startup, not a graceful degradation. The `Dockerfile` uses `node:22-alpine` so containers are fine — but the declared contract is wrong for anyone running outside Docker, and `npm ci` will not warn them.

**Fix:** `"node": ">=22.5"`. Separately, note in the README that `node:sqlite` is experimental and its API may change across minor Node releases — pinning the base image (below) also pins that risk.

### 29. [Low] Non-reproducible Docker builds

`Dockerfile:2` and `:10` use the floating tag `node:22-alpine`. Two builds a month apart produce different runtimes — which, given #28, means the SQLite API can shift underneath a rebuild with no code change. Pin to a digest or at least a patch version.

### 30. [Low] Documented deployment runs as root

`README.md:144` instructs setting `RAILWAY_RUN_UID=0` so the mounted volume is writable, which discards the `USER node` hardening in `Dockerfile:15`. It is Railway's documented workaround, so this is a pragmatic call rather than a mistake — but it should be an explicit, recorded trade-off, and the alternative (an init step that `chown`s the mount, or `DATA_DIR` on a subpath created at build time) is worth a line in the README.

Related, minor: with the default `DATA_DIR=./data` and no volume, `mkdirSync('/app/data')` fails for the `node` user, so persistence is disabled. This *is* handled gracefully (`db.ts:56-59` warns, `Services.portfolio` is `undefined`, the UI says "storage not configured") and the README calls it out — so it is working as designed. Consider raising that log line's severity or surfacing it in `/health`, since "watchlist silently unavailable in production" is the kind of thing that goes unnoticed for weeks.

### 31. [Info] The documented multi-replica scaling path is broken by in-process state

`README.md:169` suggests webhook mode + Redis-backed cache/rate-limiter, then raising replicas. Beyond `infra/cache.ts` and `infra/rateLimiter.ts`, these are also per-process and would break under multiple replicas:

- `scanFlow.ts:64` `cardCache` — "◀ Back to report" would restore only when the request lands on the replica that rendered the card.
- `scanFlow.ts:40` / `perpFlow.ts:40` `inflight` — the double-click guards stop working across replicas.
- `callbackData.ts:35` token store — buttons that fell back to the token form (long Sui/Aptos coin types) would report "expired" on the wrong replica.
- `chartService.ts:44-47` `meta` / `png` / `logos` — a chart URL fetched by Telegram against a different replica falls back to a `resolveMeta` re-fetch (1 extra credit) every time.
- `domain/chains.ts` `dynamic` registry — divergent per replica.

None of these are bugs today (`numReplicas: 1` is pinned and documented), but the README should list them so the scaling step isn't underestimated.

---

## Recommended order of work

1. **CI first** (#25) — `typecheck` + `test` on every push. Everything below is at risk of regression without it.
2. **Unblock the tests** (#24) — decouple `config/env` from the domain layer, so #1 actually runs on a clean checkout.
3. **Close the edges**: webhook `secretToken` (#1), sign the `/chart` URL (#2), fix `escapeHtml` for attributes + add a URL scheme allowlist (#4, #5).
4. **Fix the silent-wrong-answer path** (#3) — this one damages user trust in the product's core claim.
5. **Make failure visible**: health reflects bot liveness (#8), stop double-reporting errors (#9), decide what webhook mode does about `/health` and charts (#10).
6. **Meter the callbacks** (#11) and correct `engines` (#28).
7. **Backfill tests** for `client.ts`, `cache.ts`, `scanService.ts`, `errorBoundary.ts` (#26) — in that order; they are where the remaining unknowns are.
8. The `Low` correctness items (#18–#23) as a single cleanup pass with tests attached.
