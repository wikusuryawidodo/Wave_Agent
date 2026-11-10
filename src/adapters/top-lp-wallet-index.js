import { getJson } from '../providers/http.js';
import { rankTopLpWallets } from '../core/wallet-intelligence.js';

/**
 * Read-only adapter for a trusted operator-selected top-LP wallet index.
 * Trust is an explicit local setting, never accepted from the remote response.
 */
export function createTopLpWalletIndexAdapter({
  endpoint = process.env.TOP_LP_WALLET_INDEX_URL,
  trusted = process.env.TOP_LP_WALLET_INDEX_TRUSTED === 'true',
  fetchImpl = fetch,
  clock = Date.now,
  rankOptions = {}
} = {}) {
  return {
    provider: 'top-lp-wallet-index',
    readOnly: true,
    trusted: Boolean(trusted),
    async getRankedWallets() {
      if (!endpoint) throw new Error('TOP_LP_WALLET_INDEX_URL is not configured');
      const payload = await getJson(endpoint, { fetchImpl });
      const records = Array.isArray(payload) ? payload : payload?.wallets ?? payload?.data;
      if (!Array.isArray(records)) throw new Error('Top LP wallet index response must contain a wallets array');
      if (!trusted) {
        return { source: 'untrusted-wallet-index', trusted: false, generatedAt: clock(), wallets: [] };
      }
      const verifiedRecords = records.map(record => ({
        ...record,
        verified: true,
        source: 'top-lp-wallet-index'
      }));
      const wallets = rankTopLpWallets(verifiedRecords, { ...rankOptions, now: clock() });
      return { source: 'top-lp-wallet-index', trusted: true, generatedAt: clock(), wallets };
    }
  };
}
