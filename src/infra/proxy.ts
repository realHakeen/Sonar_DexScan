import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { createLogger } from './logger.js';

const log = createLogger('proxy');

/**
 * Node 的全局 fetch（undici）默认不读 HTTP_PROXY / HTTPS_PROXY / NO_PROXY，
 * 而 curl 会读。用户机器上常有系统代理，直连会间歇性 "fetch failed"。
 * 这里在启动时把 fetch 的行为对齐到 curl。必须在任何 fetch 之前执行。
 */
export function installEnvProxy(): void {
  const proxy = process.env['HTTPS_PROXY'] ?? process.env['https_proxy'] ?? process.env['HTTP_PROXY'] ?? process.env['http_proxy'];
  if (!proxy) return;
  setGlobalDispatcher(new EnvHttpProxyAgent());
  log.info('fetch now honours the system proxy', { proxy: proxy.replace(/\/\/.*@/, '//***@') });
}
