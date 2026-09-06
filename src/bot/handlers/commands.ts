import { Composer } from 'telegraf';
import { InvalidInputError } from '../../infra/errors.js';
import { adminUserIds } from '../../config/env.js';
import { renderStatsPng, renderStatsText } from '../../render/stats.js';
import { parseInput } from '../../domain/inputParser.js';
import type { BotContext } from '../context.js';
import { runScanFlow } from './scanFlow.js';
import { runPerpFlow } from './perpFlow.js';
import { openSharedWatchlist, sendPortfolio } from './portfolio.js';
import { admitScan } from '../middlewares/throttle.js';

const START_TEXT = [
  '👋 <b>DexScan Bot</b> — paste an address, get a due-diligence report.',
  '',
  'Just send me:',
  '· A contract address (EVM / Solana / Tron / TON / Sui / Aptos / Cosmos)',
  '· A token name or ticker, e.g. <code>PEPE</code>',
  '· A DexScreener / DexScan / block-explorer link',
  '',
  '<b>Commands</b>',
  '/s &lt;address or name&gt; — scan a token',
  '/perp &lt;ticker or address&gt; — open interest, funding, liquidations by venue',
  '/watchlist — tokens you starred, with change since you added them',
  '/help — how it works',
  '',
  'Add me to a group and any address posted there gets a report automatically.',
  '',
  '<i>Data by CoinMarketCap DEX API. For information only — not financial advice.</i>',
].join('\n');

const HELP_TEXT = [
  '<b>How to use</b>',
  'Send a contract address, a token name or <code>$TICKER</code>, or a DexScreener / DexScan / block-explorer link. Forwarded alert posts work too — addresses and links are read from photo captions and hidden link text.',
  '',
  '<b>Commands</b>',
  '/s &lt;address | name | link&gt; — full report',
  '/perp &lt;ticker | address&gt; — perpetuals view, e.g. <code>/perp BTC</code> or <code>/perp PEPE</code>',
  '/watchlist — your starred tokens: price, market cap, change since you added, 24h change. Tap ⭐ Watchlist under any report to star one (up to 20). 📤 Share posts a read-only copy to any chat you pick',
  '/help — this message',
  '',
  '<b>What the report shows</b>',
  '· <b>Market</b> — price, 24h change, FDV and <b>real circulating market cap</b> (never conflated), DEX volume vs liquidity, buy / sell flow',
  '· <b>Spot</b> — CEX listings, spot volume with 24h change, CEX / DEX split, top venues by volume, CEX-vs-DEX price premium',
  '· <b>Perps</b> — open interest, perp volume vs spot, funding (8h, annualised), 24h / 1h liquidations long vs short. Tap <b>Perps detail</b> for the per-venue breakdown',
  '· <b>Pools</b> — top pools, share of liquidity, locks / burns',
  '· <b>Holders</b> — count, Top10 / Top50 concentration, sniper / dev / whale / bot / smart-money / KOL tags',
  '· <b>Security</b> — contract scan, buy / sell tax, honeypot status',
  '· <b>Risks</b> — multi-chain deployments, concentration, single-LP dominance, wash-trading signals',
  '· 7-day market-cap chart under the card',
  '',
  '<b>Perps data</b>',
  'OI and perp volume are summed over 16 trusted venues (Binance, OKX, Bybit, Bitget, Gate, KuCoin, MEXC, BingX, Kraken, Crypto.com, HTX, Deribit, Hyperliquid, Aster, Lighter, edgeX); inflated reporters are excluded. Funding is shown for the largest venue, normalised to 8h. Liquidations are CMC totals across 9 venues, so treat them as a floor.',
  '',
  '<b>Duplicate names</b>',
  'Name searches rank candidates by <b>liquidity</b>, not text relevance. Contracts officially listed on CMC are marked ✅ and pinned to the top.',
  '',
  '<b>Groups</b>',
  'Addresses, links and <code>$TICKER</code> posted in a group get a report automatically; plain names need <code>@bot</code>. Requests are rate-limited per group and queued a few seconds apart.',
  '',
  '<i>Data by CoinMarketCap. For information only — not financial advice.</i>',
].join('\n');

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

export const commandHandlers = new Composer<BotContext>();

commandHandlers.start(async (ctx) => {
  // 深链 t.me/bot?start=wl_<id>：分享出去的 watchlist，对方点 "Open in Sonar" 进来
  const payload = commandArgument(ctx.message?.text ?? '');
  const shared = /^wl_([A-Za-z0-9_-]{4,32})$/.exec(payload);
  if (shared && (await openSharedWatchlist(ctx, shared[1]!))) return;
  await ctx.reply(START_TEXT, HTML);
});

commandHandlers.help(async (ctx) => {
  await ctx.reply(HELP_TEXT, HTML);
});

/** /s <地址或名称> — 与直接发消息等价，命令形式便于群里显式调用。 */
commandHandlers.command(['s', 'scan'], async (ctx) => {
  const arg = commandArgument(ctx.message?.text ?? '');
  if (!arg) throw new InvalidInputError('/s needs a contract address or token name');
  const parsed = parseInput(arg);
  if (parsed.kind === 'none') throw new InvalidInputError('/s needs a contract address or token name');
  if (!(await admitScan(ctx))) return;
  await runScanFlow(ctx, parsed, { trigger: 'command' });
});

/** /perp <symbol 或地址> — 合约视角：按所 OI / 成交量 / 费率、基差、爆仓。 */
commandHandlers.command('perp', async (ctx) => {
  const arg = commandArgument(ctx.message?.text ?? '');
  if (!arg) throw new InvalidInputError('/perp needs a ticker or contract address, e.g. /perp PEPE');
  if (!(await admitScan(ctx))) return;
  await runPerpFlow(ctx, { query: arg }, { trigger: 'command' });
});

/** /watchlist — 个人收藏列表（群里发到私聊）。刷新行情也算一次请求，走限流。 */
commandHandlers.command('watchlist', async (ctx) => {
  if (!(await admitScan(ctx))) return;
  await sendPortfolio(ctx);
});

/** /stats — 仅 ADMIN_USER_IDS：一张 30 天图 + 文字 caption。 */
commandHandlers.command('stats', async (ctx) => {
  if (!ctx.from || !adminUserIds.has(ctx.from.id)) return;
  const stats = ctx.services.stats;
  if (!stats) {
    await ctx.reply('📊 Stats unavailable (storage not configured).');
    return;
  }
  const snap = stats.snapshot();
  const text = renderStatsText(snap, 2_000_000);
  try {
    await ctx.replyWithPhoto({ source: renderStatsPng(snap) }, { caption: text, parse_mode: 'HTML' });
  } catch (err) {
    ctx.log.warn('stats chart failed, sending text', { err: String(err) });
    await ctx.reply(text, HTML);
  }
});

commandHandlers.command('ping', async (ctx) => {
  await ctx.reply('pong');
});

function commandArgument(text: string): string {
  const idx = text.indexOf(' ');
  return idx === -1 ? '' : text.slice(idx + 1).trim();
}
