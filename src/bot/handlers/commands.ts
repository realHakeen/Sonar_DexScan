import { Composer } from 'telegraf';
import { InvalidInputError } from '../../infra/errors.js';
import { parseInput } from '../../domain/inputParser.js';
import type { BotContext } from '../context.js';
import { runScanFlow } from './scanFlow.js';

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
  '/help — how it works',
  '',
  'Add me to a group and any address posted there gets a report automatically.',
  '',
  '<i>Data by CoinMarketCap DEX API. For information only — not financial advice.</i>',
].join('\n');

const HELP_TEXT = [
  '<b>What a report contains</b>',
  '· Market: price, 24h change, FDV and <b>real circulating market cap</b> (labelled separately, never conflated)',
  '· Holders: holder count, Top10/50/100 concentration, sniper / dev / whale / bot / smart-money / KOL breakdown',
  '· Security: contract scan, buy / sell tax, honeypot status',
  '· Risks: same address on multiple chains, concentration above threshold, single-LP dominance, wash-trading signals',
  '',
  '<b>Duplicate names</b>',
  'Name searches return several candidates ranked by <b>liquidity</b>, not text relevance.',
  'Contracts officially listed on CMC are marked ✅ and pinned to the top.',
  '',
  '<b>Groups</b>',
  'In groups you get a compact card; tap “Full report” for everything. Group requests are rate-limited.',
].join('\n');

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

export const commandHandlers = new Composer<BotContext>();

commandHandlers.start(async (ctx) => {
  await ctx.reply(START_TEXT, HTML);
});

commandHandlers.help(async (ctx) => {
  await ctx.reply(HELP_TEXT, HTML);
});

/** /s <地址或名称> — 与直接发消息等价，命令形式便于群里显式调用。 */
commandHandlers.command(['s', 'scan'], async (ctx) => {
  const arg = commandArgument(ctx.message?.text ?? '');
  if (!arg) throw new InvalidInputError('/s needs a contract address or token name');
  await runScanFlow(ctx, parseInput(arg));
});

commandHandlers.command('ping', async (ctx) => {
  await ctx.reply('pong');
});

function commandArgument(text: string): string {
  const idx = text.indexOf(' ');
  return idx === -1 ? '' : text.slice(idx + 1).trim();
}
