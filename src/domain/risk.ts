import { RISK_THRESHOLDS } from '../config/constants.js';
import { chainRegistry } from './chains.js';
import type {
  HolderTagDistribution,
  HoldersOverview,
  PoolInfo,
  RiskFlag,
  SecurityScan,
  TokenCandidate,
} from './types.js';

export interface RiskInput {
  primary: TokenCandidate;
  secondaryDeployments: TokenCandidate[];
  holders?: HoldersOverview;
  tags?: HolderTagDistribution;
  security?: SecurityScan;
  pools: PoolInfo[];
}

/**
 * PRD F3「风险提示区」。规则集中在这里，产品调阈值不需要碰渲染层。
 * 每条规则都是纯函数，缺数据时静默跳过，绝不猜测。
 */
export function evaluateRisks(input: RiskInput): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const t = RISK_THRESHOLDS;

  // —— 致命项 ——
  const sec = input.security;
  if (sec?.isHoneypot) {
    flags.push({ level: 'danger', code: 'honeypot', message: '🚨 Honeypot — may be unsellable' });
  }
  if (sec?.cannotSellAll && !sec.isHoneypot) {
    flags.push({ level: 'danger', code: 'cannot_sell_all', message: '🚨 Cannot sell full balance' });
  }
  if (sec?.cannotBuy) {
    flags.push({ level: 'danger', code: 'cannot_buy', message: '🚨 Buying restricted' });
  }
  if (sec?.selfDestruct) {
    flags.push({ level: 'danger', code: 'self_destruct', message: '🚨 Self-destruct function' });
  }
  if (sec?.airdropScam) {
    flags.push({ level: 'danger', code: 'airdrop_scam', message: '🚨 Airdrop scam flag' });
  }
  if (sec?.hiddenOwner) {
    flags.push({ level: 'danger', code: 'hidden_owner', message: '🚨 Hidden owner' });
  }
  if (sec?.maliciousCreator) {
    flags.push({ level: 'danger', code: 'malicious_creator', message: '🚨 Malicious creator history' });
  }
  if (sec?.flaggedByVendor) {
    flags.push({ level: 'danger', code: 'flagged', message: '🚨 Flagged by security vendor' });
  }
  if (sec?.level && !['safe', 'low', 'unknown'].includes(sec.level.toLowerCase())) {
    flags.push({ level: 'warn', code: 'security_level', message: `⚠️ Rated ${sec.level}` });
  }

  // —— 交易税 ——
  const buy = input.security?.buyTaxPct;
  const sell = input.security?.sellTaxPct;
  if (buy !== undefined && buy > t.maxTaxPct) {
    flags.push({ level: 'warn', code: 'buy_tax', message: `⚠️ Buy tax ${buy.toFixed(1)}%` });
  }
  if (sell !== undefined && sell > t.maxTaxPct) {
    flags.push({ level: 'warn', code: 'sell_tax', message: `⚠️ Sell tax ${sell.toFixed(1)}%` });
  }

  // —— 合约权限 ——
  if (input.security?.isMintable) {
    flags.push({ level: 'warn', code: 'mintable', message: '⚠️ Mintable' });
  }
  if (input.security?.canTakeBackOwnership) {
    flags.push({ level: 'warn', code: 'ownership', message: '⚠️ Ownership reclaimable' });
  }
  if (input.security?.transferPausable) {
    flags.push({ level: 'warn', code: 'pausable', message: '⚠️ Transfers pausable' });
  }
  if (input.security?.ownerChangeBalance) {
    flags.push({ level: 'warn', code: 'owner_change_balance', message: '⚠️ Owner can edit balances' });
  }
  if (input.security?.slippageModifiable) {
    flags.push({ level: 'warn', code: 'slippage_modifiable', message: '⚠️ Tax modifiable' });
  }
  if (input.security?.openSource === false) {
    flags.push({ level: 'warn', code: 'closed_source', message: '⚠️ Closed source' });
  }
  if (input.security?.isProxy) {
    flags.push({ level: 'warn', code: 'upgradeable', message: '⚠️ Upgradeable proxy' });
  }
  if (input.security?.freezable) {
    flags.push({ level: 'warn', code: 'freezable', message: '⚠️ Freezable' });
  }
  if (input.security?.hackRisk) {
    flags.push({ level: 'warn', code: 'hack', message: '⚠️ Prior exploit' });
  }

  // —— 持仓集中度 ——
  const top10 = input.holders?.top10Pct;
  if (top10 !== undefined && top10 > t.top10Pct) {
    const severe = top10 > 80;
    flags.push({
      level: severe ? 'danger' : 'warn',
      code: 'top10_concentration',
      message: `${severe ? '🚨' : '⚠️'} Top 10 own ${top10.toFixed(1)}%`,
    });
  }

  // —— 刷量：成交量远超流动性，且人均成交额异常 ——
  const vol = input.primary.volume24hUsd;
  const liqForWash = input.primary.liquidityUsd;
  const traders = input.primary.traders24h;
  if (vol !== undefined && liqForWash !== undefined && liqForWash > 0 && vol / liqForWash > 20) {
    const perTrader = traders && traders > 0 ? vol / traders : undefined;
    if (perTrader === undefined || perTrader > 50_000) {
      flags.push({
        level: 'warn',
        code: 'wash_trade',
        message: `⚠️ Vol ${Math.round(vol / liqForWash)}× liq${perTrader ? `, $${Math.round(perTrader / 1000)}K/trader` : ''} — wash?`,
      });
    }
  }
  const top50 = input.holders?.top50Pct;
  if (top50 !== undefined && top50 > t.top50Pct) {
    flags.push({
      level: 'warn',
      code: 'top50_concentration',
      message: `⚠️ Top 50 own ${top50.toFixed(1)}%`,
    });
  }

  // —— 单一 LP 占比过高 ——
  const lpFlag = evaluateSingleLp(input.pools, t.singleLpPct);
  if (lpFlag) flags.push(lpFlag);

  // —— 流动性过低 ——
  const liq = input.primary.liquidityUsd;
  if (liq !== undefined && liq < t.minLiquidityUsd) {
    flags.push({
      level: 'warn',
      code: 'low_liquidity',
      message: `⚠️ Liquidity only $${Math.round(liq).toLocaleString('en-US')}`,
    });
  }

  // —— 狙击者占比 ——
  const sniper = input.tags?.sniper;
  const total = input.holders?.totalHolders;
  if (sniper !== undefined && total !== undefined && total > 0) {
    const pct = (sniper / total) * 100;
    if (pct > 15) {
      flags.push({
        level: 'warn',
        code: 'sniper_ratio',
        message: `⚠️ Snipers ${pct.toFixed(1)}% of holders`,
      });
    }
  }

  // —— 多链同地址（残留或仿冒）——
  for (const dep of input.secondaryDeployments) {
    flags.push({
      level: 'info',
      code: 'multi_chain',
      message:
        `ℹ️ Also on ${chainRegistry.displayName(dep.networkSlug)} ` +
        `($${Math.round(dep.liquidityUsd ?? 0).toLocaleString('en-US')}) — leftover or copycat`,
    });
  }

  // —— 未被 CMC 收录 ——
  if (!input.primary.cmcId) {
    flags.push({
      level: 'info',
      code: 'not_listed',
      message: 'ℹ️ Not listed on CMC — verify contract',
    });
  }

  return flags;
}

function evaluateSingleLp(pools: PoolInfo[], thresholdPct: number): RiskFlag | undefined {
  const withLiq = pools.filter((p) => (p.liquidityUsd ?? 0) > 0);
  if (withLiq.length < 2) return undefined;

  const total = withLiq.reduce((sum, p) => sum + (p.liquidityUsd ?? 0), 0);
  if (total <= 0) return undefined;

  const top = withLiq.reduce((a, b) => ((a.liquidityUsd ?? 0) >= (b.liquidityUsd ?? 0) ? a : b));
  const pct = ((top.liquidityUsd ?? 0) / total) * 100;
  if (pct <= thresholdPct) return undefined;

  return {
    level: 'warn',
    code: 'single_lp',
    message: `⚠️ Single LP (${top.dexName ?? 'unknown DEX'}) ${pct.toFixed(1)}% of liq`,
  };
}

/** 卡片顶部的总体风险等级。 */
export function overallRisk(flags: RiskFlag[]): 'danger' | 'warn' | 'ok' {
  if (flags.some((f) => f.level === 'danger')) return 'danger';
  if (flags.some((f) => f.level === 'warn')) return 'warn';
  return 'ok';
}
