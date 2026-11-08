/**
 * GMGN's documented Agent API is exposed through GMGN Skills/MCP, not a
 * generic public REST endpoint. Inject a trusted MCP/Skills callTool bridge.
 * This adapter intentionally permits only read skills and has no swap method.
 */
const ALLOWED = new Set(['gmgn-token','gmgn-market']);
export function createGmgnReadOnlyProvider({ apiKey=process.env.GMGN_API_KEY,
  invokeSkill=null } = {}) {
  const ready=Boolean(apiKey && typeof invokeSkill==='function');
  async function call(skill,args) {
    if(!ready) throw new Error('GMGN is not configured: obtain an API key at https://gmgn.ai/ai and connect the official GMGN Skills/MCP read-only bridge');
    if(!ALLOWED.has(skill)) throw new Error(`Blocked non-read-only GMGN skill: ${skill}`);
    return invokeSkill(skill,{...args,apiKey});
  }
  return {
    provider:'gmgn-agent-api', readOnly:true, enabled:ready,
    async getToken(chain,address){ return call('gmgn-token',{chain,address}); },
    async getCandles(chain,address,{resolution='1h'}={}) {
      return call('gmgn-market',{action:'candles',chain,address,resolution});
    },
    async getMarket(chain,address){ return call('gmgn-market',{action:'market',chain,address}); },
    async getSecurity(chain,address){ return call('gmgn-token',{action:'security',chain,address}); },
    async getHolders(chain,address){ return call('gmgn-token',{action:'holders',chain,address}); },
    async getSmartMoney(chain,address){ return call('gmgn-token',{action:'smart-money',chain,address}); }
  };
}
