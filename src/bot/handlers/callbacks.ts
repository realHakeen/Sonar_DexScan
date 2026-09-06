import { Composer } from 'telegraf';
import { decodeCallback } from '../callbackData.js';
import type { BotContext } from '../context.js';
import { chainRegistry } from '../../domain/chains.js';
import { shortenAddress } from '../../render/format.js';
import { cachedSnapshot, isScanInflight, restoreCard, runScanFlow } from './scanFlow.js';
import { isPerpInflight, runPerpFlow } from './perpFlow.js';
import { handlePortfolioAdd, handlePortfolioCallback, handlePortfolioCopy } from './portfolio.js';

export const callbackHandlers = new Composer<BotContext>();

/** 处理刷新、切链、候选选择三类按钮。 */
callbackHandlers.on('callback_query', async (ctx) => {
  const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
  const payload = data ? decodeCallback(data) : null;

  if (payload?.action === 'noop') {
    // 「⏳ Refreshing…」这类状态按钮
    await ctx.answerCbQuery('Still working…');
    return;
  }
  if (!payload) {
    await ctx.answerCbQuery('This button has expired. Please send the address again.', { show_alert: true });
    return;
  }

  const { action, networkSlug, address, symbol } = payload;

  // portfolio 系列：port_refresh 没有 address，要在通用的 address 检查之前处理
  if (action === 'port_add') {
    if (!address) {
      await ctx.answerCbQuery('Incomplete button data.');
      return;
    }
    await handlePortfolioAdd(ctx, { networkSlug, address, symbol }, ctx.callbackQuery.message?.message_id);
    return;
  }
  if (action === 'port_copy') {
    if (!address) {
      await ctx.answerCbQuery('Incomplete button data.');
      return;
    }
    await handlePortfolioCopy(ctx, address);
    return;
  }
  if (action === 'port_del' || action === 'port_scan' || action === 'port_refresh') {
    await handlePortfolioCallback(ctx, action, { networkSlug, address, symbol }, ctx.callbackQuery.message?.message_id);
    return;
  }

  if (!address) {
    await ctx.answerCbQuery('Incomplete button data.');
    return;
  }

  const messageId = ctx.callbackQuery.message?.message_id;
  const chatId = ctx.chat?.id;

  if (action === 'perp' || action === 'perp_refresh' || action === 'perp_pick') {
    if (messageId === undefined) {
      await ctx.answerCbQuery('Incomplete button data.');
      return;
    }
    // 连点：只回 toast，不再发请求
    if (chatId !== undefined && isPerpInflight(chatId, messageId)) {
      await ctx.answerCbQuery('Still loading, hang on…');
      return;
    }
    await ctx.answerCbQuery(action === 'perp_refresh' ? 'Refreshing…' : 'Loading perps…');
    // address 两用：纯数字且无链 = cid（/perp BTC）；否则是代币定位（从扫描卡进来，可 Back）
    const isCid = !networkSlug && /^\d+$/.test(address);
    // 从卡片进来的：优先用卡片缓存里的 cid（桥接资产按地址反查不到 cid，例如 zec.omft.near）
    const snap = chatId !== undefined ? cachedSnapshot(chatId, messageId) : undefined;
    const snapCid = snap && snap.address.toLowerCase() === address.toLowerCase() ? snap.cmcId : undefined;
    const input = isCid ? { cmcId: Number(address) } : { cmcId: snapCid, origin: { networkSlug, address, symbol } };
    ctx.log.info('callback', { action, messageId, ...(isCid ? { cmcId: Number(address) } : { address }) });
    // 从卡片打开与视图内刷新都只换按钮、正文不动；候选选择才整条替换
    await runPerpFlow(ctx, input, {
      editMessageId: messageId,
      busyMode: action === 'perp_pick' ? 'replace' : 'keep',
      busyButton: action === 'perp' ? '⏳ Loading perps…' : '⏳ Refreshing…',
      busyLabel: symbol,
      trigger: action === 'perp' ? 'button' : action === 'perp_refresh' ? 'refresh' : 'pick',
    });
    return;
  }

  if (action === 'back') {
    if (messageId === undefined) {
      await ctx.answerCbQuery('Incomplete button data.');
      return;
    }
    if (chatId !== undefined && (isPerpInflight(chatId, messageId) || isScanInflight(chatId, messageId))) {
      await ctx.answerCbQuery('Still loading, hang on…');
      return;
    }
    // 优先零成本回填最近一次渲染的卡片；缓存过期（10 分钟）或重启过则重扫
    if (await restoreCard(ctx, messageId).catch(() => false)) {
      await ctx.answerCbQuery();
      return;
    }
    await ctx.answerCbQuery('Report expired, rescanning…');
    ctx.log.info('callback', { action, messageId, address, cacheMiss: true });
    await runScanFlow(
      ctx,
      { kind: 'address', address, chainSlug: networkSlug, source: 'raw' },
      { editMessageId: messageId, busyMode: 'replace', busyLabel: symbol ?? shortenAddress(address), trigger: 'back' },
    );
    return;
  }

  // 同一条消息正在扫描：连点只回 toast，不再发请求
  if (chatId !== undefined && messageId !== undefined && isScanInflight(chatId, messageId)) {
    await ctx.answerCbQuery('Still scanning, hang on…');
    return;
  }

  await ctx.answerCbQuery(action === 'refresh' ? 'Refreshing…' : 'Scanning…');
  ctx.log.info('callback', { action, networkSlug, messageId });

  const chainName = networkSlug ? chainRegistry.displayName(networkSlug) : undefined;
  const subject = symbol ?? shortenAddress(address);
  await runScanFlow(
    ctx,
    { kind: 'address', address, chainSlug: networkSlug, source: 'raw' },
    // 原地编辑。刷新保留旧卡片只换按钮；选候选 / 切链则先把消息替换成「Scanning …」
    {
      editMessageId: messageId,
      busyMode: action === 'refresh' ? 'keep' : 'replace',
      busyLabel: chainName ? `${subject} · ${chainName}` : subject,
      // 候选选择 / 切链是"把这个币带进群"的动作，允许创建首次 call；刷新只更新
      recordCall: action === 'scan' || action === 'chain',
      trigger: action === 'scan' ? 'candidate' : action,
    },
  );
});
