import { InvalidInputError, NotFoundError, toUserMessage } from '../../infra/errors.js';
import { parseInput } from '../../domain/inputParser.js';
import { chainRegistry } from '../../domain/chains.js';
import { bold, escapeHtml, link } from '../../render/format.js';
import type { BotContext } from '../context.js';
import type { Lore } from '../../services/loreService.js';

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

/**
 * /lore：解析输入 → 占位 → （后台）定位代币 → 生成 → 编辑。
 * 定位用扫描同一套解析，但不出卡片，只多花 tokenDetail 的 1 credit。
 * 生成可能要 40 多秒（官网 / 新闻都空时 CMC skill 兜底 14–50s），超过 Telegraf 的 handlerTimeout（30s），
 * 所以占位消息发出后 handler 就返回，后面的活自己收尾、自己兜错，不让超时变成 unhandled rejection。
 */
export async function runLoreCommand(ctx: BotContext, arg: string): Promise<void> {
  const svc = ctx.services.lore;
  if (!svc.enabled) {
    await ctx.reply('📖 /lore is not configured on this bot (LORE_API_KEY missing).');
    return;
  }
  const parsed = parseInput(arg);
  if (parsed.kind === 'none') throw new InvalidInputError('/lore needs a contract address, link or $TICKER');

  const msg = await ctx.reply('📖 Reading the project… this can take up to a minute.', { reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined });
  void loreJob(ctx, parsed, msg.message_id).catch((err) => ctx.log.error('lore job crashed', { arg, err: String(err) }));
}

/** 占位消息之后的全部工作；任何异常都落到编辑占位消息，不向上抛。 */
async function loreJob(ctx: BotContext, parsed: ReturnType<typeof parseInput>, placeholderId: number): Promise<void> {
  const svc = ctx.services.lore;
  const edit = (text: string) => ctx.telegram.editMessageText(ctx.chat!.id, placeholderId, undefined, text, HTML);
  const started = Date.now();
  try {
    const loc = await locate(ctx, parsed);
    const lore = await svc.forToken(loc);
    const text = renderLore(lore);
    // 有横幅图（DexScreener 上项目方提交的）就发图片消息，正文做 caption（上限 1024 字）；发不出去退回纯文字
    if (lore.headerImage && text.length <= 1024) {
      try {
        await ctx.replyWithPhoto(lore.headerImage, { caption: text, parse_mode: 'HTML', reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined });
        await ctx.telegram.deleteMessage(ctx.chat!.id, placeholderId).catch(() => undefined);
      } catch (err) {
        ctx.log.debug('lore photo failed, falling back to text', { err: String(err) });
        await edit(text);
      }
    } else {
      await edit(text);
    }
    ctx.services.stats?.record({ kind: 'lore', userId: ctx.from?.id, chatId: ctx.chat?.id, chatType: ctx.chat?.type, token: `${lore.networkSlug}:${lore.symbol}`, elapsedMs: Date.now() - started, trigger: lore.cached ? 'cache' : 'generate' });
  } catch (err) {
    ctx.log.warn('lore failed', { input: parsed.kind === 'address' ? parsed.address : parsed.kind === 'query' ? parsed.query : '', err: String(err) });
    await edit(escapeHtml(toUserMessage(err))).catch(() => undefined);
  }
}

/** 地址 → 链 + 地址；$ticker / 名称 → 搜索第一名。 */
async function locate(ctx: BotContext, parsed: ReturnType<typeof parseInput>): Promise<{ networkSlug: string; address: string }> {
  if (parsed.kind === 'address') {
    if (parsed.chainSlug && !parsed.pair) return { networkSlug: parsed.chainSlug, address: parsed.address };
    // 裸地址不知道链：search 反查（1 credit），同地址多链取流动性最高的；查不到（新币漏索引 / 池子链接）再退到完整扫描的定链逻辑
    if (!parsed.pair) {
      const found = await ctx.services.cmc.dex.search(parsed.address).catch(() => []);
      const matched = found.filter((c) => c.address.toLowerCase() === parsed.address.toLowerCase()).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
      if (matched[0]) return { networkSlug: matched[0].networkSlug, address: matched[0].address };
    }
    const report = await ctx.services.scan.scanByAddress(parsed.address, { chainSlug: parsed.chainSlug, preferPair: parsed.pair });
    return { networkSlug: report.primary.networkSlug, address: report.primary.address };
  }
  if (parsed.kind === 'query') {
    const ranked = await ctx.services.search.searchByName(parsed.query, 1);
    const top = ranked[0]?.candidate;
    if (!top) throw new NotFoundError(parsed.query);
    return { networkSlug: top.networkSlug, address: top.address };
  }
  throw new InvalidInputError('unrecognised input');
}

/**
 * 📖 DRILL · Project Mars · Robinhood Chain
 * <正文>
 * 不带来源脚注（产品决定）；素材完全抓不到时才在正文下给一行链接，免得只剩一句"素材不足"。
 */
export function renderLore(l: Lore): string {
  const head = `📖 ${bold(l.symbol)} · ${escapeHtml(l.name)} · ${escapeHtml(chainRegistry.displayName(l.networkSlug))}`;
  const out = [head, '', escapeHtml(l.text)];
  if (l.sources.length === 0) {
    const links: string[] = [];
    if (l.links.website) links.push(link('Website', l.links.website));
    if (l.links.twitter) links.push(link('X', l.links.twitter));
    if (l.links.telegram) links.push(link('TG', l.links.telegram));
    if (links.length) out.push('', links.join(' · '));
  }
  return out.join('\n');
}
