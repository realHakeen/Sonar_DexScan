/**
 * CMC credit 计量：客户端每收到一个响应就把 credit_count 报过来，订阅方（statsService）落库。
 * 放在 infra 里是为了让 api 层不依赖 services。
 */
type Listener = (credits: number) => void;
const listeners = new Set<Listener>();

export const creditMeter = {
  add(credits: number | undefined): void {
    if (!credits || !Number.isFinite(credits) || credits <= 0) return;
    for (const l of listeners) {
      try {
        l(credits);
      } catch {
        /* 计量失败不影响请求 */
      }
    }
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
