import { Composer } from 'telegraf';
import { decodeCallback } from '../callbackData.js';
import type { BotContext } from '../context.js';
import { chainRegistry } from '../../domain/chains.js';
import { shortenAddress } from '../../render/format.js';
import { isScanInflight, runScanFlow } from './scanFlow.js';

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
  if (!address) {
    await ctx.answerCbQuery('Incomplete button data.');
    return;
  }

  const messageId = ctx.callbackQuery.message?.message_id;
  const chatId = ctx.chat?.id;

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
    // 原地编辑；用户既然点了按钮，就给完整卡片。
    // 刷新保留旧卡片只换按钮；选候选 / 切链 / 展开则先把消息替换成「Scanning …」
    {
      editMessageId: messageId,
      forceFull: true,
      busyMode: action === 'refresh' ? 'keep' : 'replace',
      busyLabel: chainName ? `${subject} · ${chainName}` : subject,
    },
  );
});
