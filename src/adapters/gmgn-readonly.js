/**
 * GMGN Skills/MCP read-only bridge adapter.
 * The official CLI adapter is available separately in gmgn-cli-readonly.js.
 */
const ALLOWED = new Set(['gmgn-token', 'gmgn-market']);
const CHAINS = new Set(['sol', 'bsc', 'base', 'eth', 'robinhood', 'arc', 'stable']);
const SIGNAL_CHAINS = new Set(['sol', 'bsc', 'robinhood', 'arc', 'stable']);
const INTERVALS = new Set(['1m', '5m', '1h', '6h', '24h']);
const CANDLES = new Set(['30s', '1m', '5m', '15m', '1h', '4h', '1d']);
const SIGNAL_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 18, 19, 20, 21]);
const TREND_ORDER = new Set([
  'default', 'swaps', 'marketcap', 'history_highest_market_cap', 'liquidity',
  'volume', 'holder_count', 'smart_degen_count', 'renowned_count', 'gas_fee',
  'price', 'change1m', 'change5m', 'change1h', 'creation_timestamp'
]);
const FILTER_METRICS = new Set([
  'Volume', 'Liquidity', 'Marketcap', 'HistoryHighestMarketcap', 'Swaps',
  'HolderCount', 'GasFee', 'RenownedCount', 'SmartDegenCount', 'BotDegenCount',
  'VisitingCount', 'PriceChangePercent', 'InsiderRate', 'BundlerRate',
  'EntrapmentRatio', 'Top10HolderRate', 'Top70SniperHoldRate', 'DevTeamHoldRate'
]);
const SOL_FILTER_TAGS = new Set([
  'renounced', 'frozen', 'burn', 'token_burnt', 'has_social', 'not_social_dup',
  'not_image_dup', 'dexscr_update_link', 'not_wash_trading', 'is_internal_market', 'is_out_market'
]);
const EVM_FILTER_TAGS = new Set([
  'not_honeypot', 'verified', 'renounced', 'locked', 'token_burnt', 'has_social',
  'not_social_dup', 'not_image_dup', 'dexscr_update_link', 'is_internal_market', 'is_out_market'
]);

function requiredChoice(name, value, choices) {
  if (!choices.has(value)) throw new Error(name + ' is unsupported: ' + value);
}
function checkedLimit(value, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error('limit must be an integer from 1 to ' + max);
  return n;
}
function checkedFilters(filters = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('filters must be an object');
  const clean = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    const match = /^(min|max)([A-Za-z]+)$/.exec(key);
    if (!match) throw new Error('Unsupported GMGN range filter: ' + key);
    const [, , metric] = match;
    if (metric === 'Created') {
      if (typeof value !== 'string' || !/^\d+(m|h|d)$/.test(value)) {
        throw new Error(key + ' must be a duration such as 30m, 6h or 14d');
      }
      clean[key] = value;
    } else {
      if (!FILTER_METRICS.has(metric) || !Number.isFinite(Number(value)) || Number(value) < 0) {
        throw new Error('Unsupported or invalid GMGN range filter: ' + key);
      }
      clean[key] = Number(value);
    }
  }
  return clean;
}
function checkedTags(chain, tags = []) {
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || !tag.trim())) {
    throw new Error('filterTags must be an array of non-empty strings');
  }
  const allowed = chain === 'sol' ? SOL_FILTER_TAGS : EVM_FILTER_TAGS;
  for (const tag of tags) if (!allowed.has(tag)) throw new Error('Unsupported GMGN filter tag for ' + chain + ': ' + tag);
  return [...new Set(tags)];
}

export function createGmgnReadOnlyProvider({ apiKey = process.env.GMGN_API_KEY, invokeSkill = null } = {}) {
  const ready = Boolean(apiKey && typeof invokeSkill === 'function');
  async function call(skill, args) {
    if (!ready) throw new Error('GMGN Skills/MCP bridge is not configured. Configure the GMGN API key and inject an approved read-only invokeSkill bridge.');
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
      requiredChoice('candle resolution', resolution, CANDLES);
      return call('gmgn-market', { action: 'candles', chain, address, resolution, from, to });
    },
    async getMarket(chain, address) {
      requiredChoice('chain', chain, CHAINS);
      if (!address) throw new Error('token address is required');
      return call('gmgn-market', { action: 'market', chain, address });
    },
    async getTrending(chain, {
      interval = '1h', limit = 50, orderBy = 'volume', direction = 'desc',
      filters = {}, filterTags = [], platforms = []
    } = {}) {
      requiredChoice('chain', chain, CHAINS);
      requiredChoice('trending interval', interval, INTERVALS);
      requiredChoice('orderBy', orderBy, TREND_ORDER);
      if (!['asc', 'desc'].includes(direction)) throw new Error('direction must be asc or desc');
      if (!Array.isArray(platforms) || platforms.some(x => typeof x !== 'string' || !x.trim())) throw new Error('platforms must be non-empty strings');
      return call('gmgn-market', {
        action: 'trending', chain, interval, limit: checkedLimit(limit, 100), orderBy, direction,
        filters: checkedFilters(filters), filterTags: checkedTags(chain, filterTags), platforms
      });
    },
    async getSignals(chain, {
      signalTypes = [12, 13, 6, 7, 20],
      marketCapMin, marketCapMax, triggerMarketCapMin, triggerMarketCapMax,
      totalFeeMin, totalFeeMax, limit = 50
    } = {}) {
      requiredChoice('signal chain', chain, SIGNAL_CHAINS);
      if (!Array.isArray(signalTypes) || signalTypes.length === 0 ||
          signalTypes.some(type => !Number.isInteger(type) || !SIGNAL_TYPES.has(type))) {
        throw new Error('signalTypes must use documented read-only types; 14, 15 and 16 cannot be explicitly requested');
      }
      const bounds = { marketCapMin, marketCapMax, triggerMarketCapMin, triggerMarketCapMax, totalFeeMin, totalFeeMax };
      for (const [key, value] of Object.entries(bounds)) {
        if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0)) throw new Error(key + ' must be non-negative');
      }
      return call('gmgn-market', {
        action: 'signal', chain, signalTypes, ...bounds, limit: checkedLimit(limit, 50)
      });
    },
    async getTrenches(chain, {
      types = ['completed'], limit = 50, filterPreset = 'safe',
      sortBy = 'volume_24h', direction = 'desc', platforms = [], filters = {}
    } = {}) {
      requiredChoice('chain', chain, CHAINS);
      const allowedTypes = new Set(['new_creation', 'near_completion', 'completed']);
      if (!Array.isArray(types) || !types.length || types.some(type => !allowedTypes.has(type))) throw new Error('Invalid trenches types');
      if (!['safe', 'smart-money', 'strict', ''].includes(filterPreset)) throw new Error('Invalid trenches filter preset');
      if (!['smart_degen_count', 'renowned_count', 'volume_24h', 'volume_1h', 'swaps_24h', 'swaps_1h', 'rug_ratio', 'holder_count', 'usd_market_cap', 'created_timestamp'].includes(sortBy)) {
        throw new Error('Invalid trenches sort field');
      }
      if (!['asc', 'desc'].includes(direction)) throw new Error('direction must be asc or desc');
      if (!Array.isArray(platforms) || platforms.some(x => typeof x !== 'string' || !x.trim())) throw new Error('platforms must be non-empty strings');
      return call('gmgn-market', {
        action: 'trenches', chain, types, limit: checkedLimit(limit, 80),
        filterPreset, sortBy, direction, platforms, filters
      });
    },
    async getHotSearches({ chains = ['sol'], interval = '24h', limit = 100, filters = {}, filterTags = [] } = {}) {
      if (!Array.isArray(chains) || !chains.length) throw new Error('chains must be a non-empty array');
      for (const chain of chains) requiredChoice('chain', chain, CHAINS);
      requiredChoice('hot-search interval', interval, INTERVALS);
      const tags = [...new Set(chains.flatMap(chain => checkedTags(chain, filterTags)))];
      return call('gmgn-market', {
        action: 'hot-searches', chains, interval, limit: checkedLimit(limit, 500),
        filters: checkedFilters(filters), filterTags: tags
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
