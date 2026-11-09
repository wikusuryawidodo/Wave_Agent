/**
 * GMGN's documented Agent API is exposed through GMGN Skills/MCP, not a
 * generic public REST endpoint. Inject a trusted Skills/MCP read-only bridge.
 * This adapter intentionally permits only read skills and has no swap method.
 */
const ALLOWED = new Set(['gmgn-token', 'gmgn-market']);
const CHAINS = new Set(['sol', 'bsc', 'base', 'eth', 'robinhood', 'arc', 'stable']);
const TREND_INTERVALS = new Set(['1m', '5m', '1h', '6h', '24h']);
const SIGNAL_CHAINS = new Set(['sol', 'bsc', 'robinhood', 'arc', 'stable']);
const SIGNAL_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 18, 19, 20, 21]);
const TREND_ORDER = new Set([
  'default', 'swaps', 'marketcap', 'history_highest_market_cap', 'liquidity',
  'volume', 'holder_count', 'smart_degen_count', 'renowned_count', 'gas_fee',
  'price', 'change1m', 'change5m', 'change1h', 'creation_timestamp'
]);

function requiredChoice(name, value, choices) {
  if (!choices.has(value)) throw new Error(name + ' is unsupported: ' + value);
}
function positiveLimit(value, max, name = 'limit') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(name + ' must be an integer from 1 to ' + max);
  return n;
}
function numericFilters(filters = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('filters must be an object');
  const clean = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    if (!/^(min|max)(Marketcap|Liquidity|Created|SmartDegenCount|HolderCount|Volume|Swaps|InsiderRate|BundlerRate|RugRatio)$/i.test(key) ||
        !Number.isFinite(Number(value))) {
      throw new Error('Unsupported GMGN trending filter: ' + key);
    }
    clean[key] = Number(value);
  }
  return clean;
}

export function createGmgnReadOnlyProvider({
  apiKey = process.env.GMGN_API_KEY,
  invokeSkill = null
} = {}) {
  const ready = Boolean(apiKey && typeof invokeSkill === 'function');

  async function call(skill, args) {
    if (!ready) {
      throw new Error('GMGN is not configured: obtain an API key at https://gmgn.ai/ai and connect the official GMGN Skills/MCP read-only bridge');
    }
    if (!ALLOWED.has(skill)) throw new Error('Blocked non-read-only GMGN skill: ' + skill);
    return invokeSkill(skill, { ...args, apiKey });
  }

  return {
    provider: 'gmgn-agent-api',
    readOnly: true,
    enabled: ready,
    async getToken(chain, address) {
      requiredChoice('chain', chain, CHAINS);
      if (!address) throw new Error('token address is required');
      return call('gmgn-token', { chain, address });
    },
    async getCandles(chain, address, { resolution = '1h', from, to } = {}) {
      requiredChoice('chain', chain, CHAINS);
      if (!address) throw new Error('token address is required');
      if (!new Set(['30s', '1m', '5m', '15m', '1h', '4h', '1d']).has(resolution)) {
        throw new Error('Unsupported GMGN candle resolution: ' + resolution);
      }
      return call('gmgn-market', { action: 'candles', chain, address, resolution, from, to });
    },
    async getMarket(chain, address) {
      requiredChoice('chain', chain, CHAINS);
      if (!address) throw new Error('token address is required');
      return call('gmgn-market', { action: 'market', chain, address });
    },
    async getTrending(chain, {
      interval = '1h',
      limit = 50,
      orderBy = 'volume',
      direction = 'desc',
      filters = {},
      platforms = []
    } = {}) {
      requiredChoice('chain', chain, CHAINS);
      requiredChoice('interval', interval, TREND_INTERVALS);
      requiredChoice('orderBy', orderBy, TREND_ORDER);
      if (!['asc', 'desc'].includes(direction)) throw new Error('direction must be asc or desc');
      const n = positiveLimit(limit, 100);
      if (!Array.isArray(platforms) || platforms.some(p => typeof p !== 'string' || !p.trim())) {
        throw new Error('platforms must be an array of non-empty platform names');
      }
      return call('gmgn-market', {
        action: 'trending',
        chain,
        interval,
        limit: n,
        orderBy,
        direction,
        filters: numericFilters(filters),
        platforms
      });
    },
    async getSignals(chain, {
      signalTypes = [12, 13, 6, 7, 20],
      marketCapMin,
      marketCapMax,
      triggerMarketCapMin,
      triggerMarketCapMax,
      totalFeeMin,
      totalFeeMax,
      limit = 50
    } = {}) {
      requiredChoice('signal chain', chain, SIGNAL_CHAINS);
      if (!Array.isArray(signalTypes) || signalTypes.length === 0 ||
          signalTypes.some(type => !Number.isInteger(type) || !SIGNAL_TYPES.has(type))) {
        throw new Error('signalTypes must contain documented read-only signal types; 14, 15 and 16 are not accepted');
      }
      const bounds = { marketCapMin, marketCapMax, triggerMarketCapMin, triggerMarketCapMax, totalFeeMin, totalFeeMax };
      for (const [key, value] of Object.entries(bounds)) {
        if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
          throw new Error(key + ' must be a non-negative number');
        }
      }
      return call('gmgn-market', {
        action: 'signal',
        chain,
        signalTypes,
        ...bounds,
        limit: positiveLimit(limit, 50)
      });
    },
    async getTrenches(chain, {
      types = ['completed'],
      limit = 50,
      filterPreset = 'safe',
      sortBy = 'volume_24h',
      direction = 'desc',
      platforms = []
    } = {}) {
      requiredChoice('chain', chain, CHAINS);
      const allowedTypes = new Set(['new_creation', 'near_completion', 'completed']);
      if (!Array.isArray(types) || types.length === 0 || types.some(type => !allowedTypes.has(type))) {
        throw new Error('types must contain new_creation, near_completion or completed');
      }
      if (!['safe', 'smart-money', 'strict', ''].includes(filterPreset)) throw new Error('Unsupported trenches filterPreset');
      if (!['smart_degen_count', 'renowned_count', 'volume_24h', 'volume_1h', 'swaps_24h', 'swaps_1h', 'rug_ratio', 'holder_count', 'usd_market_cap', 'created_timestamp'].includes(sortBy)) {
        throw new Error('Unsupported trenches sortBy');
      }
      if (!['asc', 'desc'].includes(direction)) throw new Error('direction must be asc or desc');
      if (!Array.isArray(platforms) || platforms.some(p => typeof p !== 'string' || !p.trim())) {
        throw new Error('platforms must be an array of non-empty platform names');
      }
      return call('gmgn-market', {
        action: 'trenches',
        chain,
        types,
        limit: positiveLimit(limit, 80),
        filterPreset,
        sortBy,
        direction,
        platforms
      });
    },
    async getHotSearches({
      chains = ['sol'],
      interval = '24h',
      limit = 100,
      filters = {}
    } = {}) {
      if (!Array.isArray(chains) || chains.length === 0 || chains.some(chain => !CHAINS.has(chain))) {
        throw new Error('chains must be a non-empty array of supported GMGN chains');
      }
      requiredChoice('interval', interval, TREND_INTERVALS);
      return call('gmgn-market', {
        action: 'hot-searches',
        chains,
        interval,
        limit: positiveLimit(limit, 500),
        filters: numericFilters(filters)
      });
    },
    async getSecurity(chain, address) {
      requiredChoice('chain', chain, CHAINS);
      if (!address) throw new Error('token address is required');
      return call('gmgn-token', { action: 'security', chain, address });
    },
    async getHolders(chain, address) {
      requiredChoice('chain', chain, CHAINS);
      if (!address) throw new Error('token address is required');
      return call('gmgn-token', { action: 'holders', chain, address });
    },
    async getSmartMoney(chain, address) {
      requiredChoice('chain', chain, CHAINS);
      if (!address) throw new Error('token address is required');
      return call('gmgn-token', { action: 'smart-money', chain, address });
    }
  };
}
