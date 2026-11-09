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

function numericFilters(filters = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('filters must be an object');
  const clean = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    const match = /^(min|max)([A-Za-z]+)$/.exec(key);
    if (!match) throw new Error('Unsupported GMGN trending filter: ' + key);
    const [, bound, metric] = match;
    if (metric === 'Created') {
      if (typeof value !== 'string' || !/^\\d+(m|h|d)$/.test(value)) {
        throw new Error(key + ' must be a duration such as 30m, 6h or 7d');
      }
      clean[key] = value;
      continue;
    }
    if (!FILTER_METRICS.has(metric) || !Number.isFinite(Number(value)) || Number(value) < 0) {
      throw new Error('Unsupported or invalid GMGN trending filter: ' + key);
    }
    clean[key] = Number(value);
  }
  return clean;
}

function validateFilterTags(chain, filterTags = []) {
  if (!Array.isArray(filterTags) || filterTags.some(tag => typeof tag !== 'string' || !tag.trim())) {
    throw new Error('filterTags must be an array of non-empty strings');
  }
  const allowed = ['sol'].includes(chain) ? SOL_FILTER_TAGS : EVM_FILTER_TAGS;
  for (const tag of filterTags) {
    if (!allowed.has(tag)) throw new Error('Unsupported GMGN filter tag for ' + chain + ': ' + tag);
  }
  return [...new Set(filterTags)];
}

