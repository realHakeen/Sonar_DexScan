import type { HolderEntry, HolderTagDistribution, HoldersOverview } from './types.js';

/**
 * holders/trend/list 缺集中度时，从 holders/list 自己算。
 * 依赖每条记录的 percent（占总供应百分比）；缺 percent 时退回用 balance 相对占比估算。
 */
export function concentrationFromHolders(entries: HolderEntry[]): Pick<HoldersOverview, 'top10Pct' | 'top50Pct' | 'top100Pct'> {
  if (entries.length === 0) return {};

  const withPercent = entries.filter((h) => h.percent !== undefined);
  let shares: number[];

  if (withPercent.length >= Math.min(10, entries.length)) {
    // 实测 percent 已是百分比单位（"19.25"），不做换算
    shares = withPercent.map((h) => h.percent!);
  } else {
    // 没有占比字段：用 balance 在列表内的相对占比。列表通常只覆盖头部持有人，结果会偏高，标记为估算
    const balances = entries.map((h) => h.balance ?? 0);
    const total = balances.reduce((a, b) => a + b, 0);
    if (total <= 0) return {};
    shares = balances.map((b) => (b / total) * 100);
  }

  shares.sort((a, b) => b - a);
  const sumTop = (n: number) => (shares.length >= n ? round2(shares.slice(0, n).reduce((a, b) => a + b, 0)) : undefined);

  return {
    top10Pct: sumTop(10),
    top50Pct: sumTop(50),
    top100Pct: sumTop(100),
  };
}

/** tag_count 端点失败时，用 holders/list 里每条记录自带的 tags 兜底。 */
export function tagDistributionFromHolders(entries: HolderEntry[]): HolderTagDistribution | undefined {
  if (entries.length === 0) return undefined;
  const count = (tag: string) => entries.filter((h) => h.tags.includes(tag)).length || undefined;
  const out: HolderTagDistribution = {
    sniper: count('tag_sniper'),
    dev: count('tag_dev'),
    whale: count('tag_whale'),
    bot: count('tag_bot'),
    smartMoney: count('tag_smart_money'),
    kol: count('tag_kol'),
  };
  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
