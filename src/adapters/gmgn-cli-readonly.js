import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CHAINS = new Set(['sol', 'bsc', 'base', 'eth', 'arbitrum', 'hyperevm', 'robinhood', 'arc', 'stable', 'avalanche']);
const INTERVALS = new Set(['1m', '5m', '1h', '6h', '24h']);
const SIGNAL_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
const ORDER_BY = new Set([
  'volume', 'swaps', 'liquidity', 'marketcap', 'holders', 'price', 'change',
  'change1m', 'change5m', 'change1h', 'renowned_count', 'smart_degen_count',
  'bluechip_owner_percentage', 'rank', 'creation_timestamp',
  'square_mentions', 'history_highest_market_cap', 'gas_fee'
]);

function requiredChoice(name, value, allowed) {
  if (!allowed.has(value)) throw new Error('Unsupported ' + name + ': ' + value);
}
function checkedLimit(value, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error('limit must be between 1 and ' + max);
  return String(n);
}
function checkedDuration(key, value) {
  if (typeof value !== 'string' || !/^\d+(m|h|d)$/.test(value)) {
    throw new Error(key + ' must use a duration such as 30m, 6h or 14d');
  }
}
function checkedNonNegative(key, value) {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(key + ' must be non-negative');
}

/**
 * Official GMGN CLI read-only adapter. It executes only config --check and
 * documented market read subcommands. No wallet, copytrade, buy, sell or
 * transaction commands are exposed by this provider.
 */
export function createGmgnCliReadOnlyProvider({
  binary = 'gmgn-cli',
  execFileImpl = execFileAsync,
  timeoutMs = 20_000,
  maxBuffer = 8 * 1024 * 1024
} = {}) {
  let configCheck = null;

  async function execute(args, buffer = maxBuffer) {
    return execFileImpl(binary, args, { timeout: timeoutMs, maxBuffer: buffer, windowsHide: true });
  }
  async function ensureConfigured() {
    if (!configCheck) {
      configCheck = execute(['config', '--check'], 1024 * 1024).then(() => true).catch(error => {
        configCheck = null;
        const detail = String(error?.stderr || error?.stdout || error?.message || error);
        throw new Error('GMGN CLI configuration check failed. Install/update gmgn-cli and configure the GMGN API key using the official CLI. ' + detail);
      });
    }
    return configCheck;
  }
  async function market(args) {
    await ensureConfigured();
    const result = await execute(['market', ...args, '--raw']);
    const stdout = String(result?.stdout ?? result ?? '').trim();
    if (!stdout) throw new Error('GMGN CLI returned empty output');
    try { return JSON.parse(stdout); } catch {}
    const starts = [stdout.indexOf('{'), stdout.indexOf('[')].filter(index => index >= 0);
    if (!starts.length) throw new Error('GMGN CLI --raw output was not JSON');
    return JSON.parse(stdout.slice(Math.min(...starts)));
  }

  return {
    provider: 'gmgn-cli-readonly',
    readOnly: true,
    async getTrending(chain, {
      interval = '1h',
      limit = 50,
      orderBy = 'volume',
      direction = 'desc',
      filterTags = [],
      platforms = [],
      filters = {}
    } = {}) {
      requiredChoice('chain', chain, CHAINS);
      requiredChoice('trending interval', interval, INTERVALS);
      requiredChoice('orderBy', orderBy, ORDER_BY);
      if (!['asc', 'desc'].includes(direction)) throw new Error('direction must be asc or desc');
      if (!Array.isArray(filterTags) || !Array.isArray(platforms)) throw new Error('filterTags and platforms must be arrays');
      const args = ['trending', '--chain', chain, '--interval', interval, '--order-by', orderBy,
        '--direction', direction, '--limit', checkedLimit(limit, 100)];
      for (const tag of filterTags) {
        if (typeof tag !== 'string' || !tag.trim()) throw new Error('filterTags must contain non-empty strings');
        args.push('--filter', tag);
      }
      for (const platform of platforms) {
        if (typeof platform !== 'string' || !platform.trim()) throw new Error('platforms must contain non-empty strings');
        args.push('--platform', platform);
      }
      const flags = {
        minVolume: '--min-volume', maxVolume: '--max-volume',
        minLiquidity: '--min-liquidity', maxLiquidity: '--max-liquidity',
        minMarketcap: '--min-marketcap', maxMarketcap: '--max-marketcap',
        minSmartDegenCount: '--min-smart-degen-count', minRenownedCount: '--min-renowned-count',
        minTop10HolderRate: '--min-top10-holder-rate', maxTop10HolderRate: '--max-top10-holder-rate',
        maxInsiderRate: '--max-insider-rate', maxBundlerRate: '--max-bundler-rate',
        maxEntrapmentRatio: '--max-entrapment-ratio', minCreated: '--min-created', maxCreated: '--max-created'
      };
      for (const [key, value] of Object.entries(filters)) {
        const flag = flags[key];
        if (!flag) throw new Error('Unsupported GMGN trending filter: ' + key);
        if (key.endsWith('Created')) checkedDuration(key, value);
        else checkedNonNegative(key, value);
        args.push(flag, String(value));
      }
      return market(args);
    },
    async getSignals(chain, {
      signalTypes = [4, 6, 12, 13, 20],
      marketCapMin,
      marketCapMax,
      triggerMarketCapMin,
      triggerMarketCapMax,
      totalFeeMin,
      totalFeeMax
    } = {}) {
      if (!['sol', 'bsc', 'base', 'eth', 'arbitrum', 'avalanche', 'robinhood', 'arc', 'stable'].includes(chain)) {
        throw new Error('Unsupported GMGN signal chain: ' + chain);
      }
      if (!Array.isArray(signalTypes) || signalTypes.length === 0 ||
          signalTypes.some(type => !Number.isInteger(type) || !SIGNAL_TYPES.has(type))) {
        throw new Error('signalTypes must use documented types; do not request 14, 15 or 16');
      }
      const args = ['signal', '--chain', chain];
      for (const type of signalTypes) args.push('--signal-type', String(type));
      const mapped = [
        ['--mc-min', marketCapMin], ['--mc-max', marketCapMax],
        ['--trigger-mc-min', triggerMarketCapMin], ['--trigger-mc-max', triggerMarketCapMax],
        ['--total-fee-min', totalFeeMin], ['--total-fee-max', totalFeeMax]
      ];
      for (const [flag, value] of mapped) {
        if (value === undefined || value === null) continue;
        checkedNonNegative(flag, value);
        args.push(flag, String(value));
      }
      return market(args);
    },
    async getTrenches(chain, {
      types = ['completed'],
      limit = 50,
      platforms = []
    } = {}) {
      requiredChoice('chain', chain, CHAINS);
      const allowedTypes = new Set(['new_creation', 'near_completion', 'completed']);
      if (!Array.isArray(types) || !types.length || types.some(type => !allowedTypes.has(type))) {
        throw new Error('types must contain new_creation, near_completion or completed');
      }
      if (!Array.isArray(platforms) || platforms.some(x => typeof x !== 'string' || !x.trim())) {
        throw new Error('platforms must be non-empty strings');
      }
      const args = ['trenches', '--chain', chain, '--limit', checkedLimit(limit, 80)];
      for (const type of types) args.push('--type', type);
      for (const platform of platforms) args.push('--launchpad-platform', platform);
      return market(args);
    },
    async getHotSearches({
      chains = ['sol'],
      interval = '24h',
      limit = 100,
      filterTags = [],
      filters = {}
    } = {}) {
      if (!Array.isArray(chains) || !chains.length) throw new Error('chains must be a non-empty array');
      for (const chain of chains) requiredChoice('chain', chain, CHAINS);
      requiredChoice('hot-search interval', interval, INTERVALS);
      if (!Array.isArray(filterTags)) throw new Error('filterTags must be an array');
      const args = ['hot-searches', '--interval', interval, '--limit', checkedLimit(limit, 500)];
      for (const chain of chains) args.push('--chain', chain);
      for (const tag of filterTags) {
        if (typeof tag !== 'string' || !tag.trim()) throw new Error('filterTags must contain non-empty strings');
        args.push('--filter', tag);
      }
      const flags = {
        minLiquidity: '--min-liquidity', maxMarketcap: '--max-marketcap',
        minMarketcap: '--min-marketcap', minVolume: '--min-volume',
        minSmartDegenCount: '--min-smart-degen-count', minCreated: '--min-created', maxCreated: '--max-created'
      };
      for (const [key, value] of Object.entries(filters)) {
        const flag = flags[key];
        if (!flag) throw new Error('Unsupported GMGN hot-search filter: ' + key);
        if (key.endsWith('Created')) checkedDuration(key, value);
        else checkedNonNegative(key, value);
        args.push(flag, String(value));
      }
      return market(args);
    },
    async getCandles(chain, address, { resolution = '1h', from, to } = {}) {
      requiredChoice('chain', chain, CHAINS);
      if (!address) throw new Error('token address is required');
      if (!new Set(['30s', '1m', '5m', '15m', '1h', '4h', '1d']).has(resolution)) {
        throw new Error('Unsupported GMGN candle resolution: ' + resolution);
      }
      const args = ['kline', '--chain', chain, '--address', address, '--resolution', resolution];
      if (from !== undefined) { checkedNonNegative('from', from); args.push('--from', String(from)); }
      if (to !== undefined) { checkedNonNegative('to', to); args.push('--to', String(to)); }
      return market(args);
    }
  };
}
