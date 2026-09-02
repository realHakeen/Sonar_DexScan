import { CmcClient } from './client.js';
import { CoreApi } from './coreApi.js';
import { DexApi } from './dexApi.js';

export { CmcClient } from './client.js';
export { CoreApi } from './coreApi.js';
export { DexApi } from './dexApi.js';
export type { TokenLocator } from './dexApi.js';

export interface CmcGateway {
  dex: DexApi;
  core: CoreApi;
}

/** 组合根：整个应用只在这里实例化一次 CMC 客户端。 */
export function createCmcGateway(client = new CmcClient()): CmcGateway {
  return { dex: new DexApi(client), core: new CoreApi(client) };
}
