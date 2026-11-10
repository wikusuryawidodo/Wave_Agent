import { getJson } from '../providers/http.js';

const BASE = 'https://datapi.jup.ag/v1/assets/search';
const num = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

/**
 * Read-only adapter for Jupiter's token asset/search API.
 * Unknown audit values stay null so the strategy fails closed.
 */
export function createJupiterTokenScreeningAdapter({
  baseUrl = BASE,
  fetchImpl = fetch,
  clock = Date.now,
  developerBlocklist = [],
  developerBlocklistVerified = false
} = {}) {
  const blocked = new Set(developerBlocklist.map(String));
  return {
    provider: 'jupiter-token-screening',
    readOnly: true,
    async getTokenSnapshot(mint) {
      if (!mint) throw new Error('mint is required');
      const url = new URL(baseUrl);
      url.searchParams.set('query', mint);
      const payload = await getJson(url, { fetchImpl });
      const asset = (Array.isArray(payload) ? payload : payload?.data ?? []).find(item => item?.id === mint);
      if (!asset) throw new Error('Jupiter asset API has no exact mint match');
      const updatedAt = Date.parse(asset.updatedAt ?? '');
      const ageSec = Number.isFinite(updatedAt) ? Math.max(0, (clock() - updatedAt) / 1000) : null;
      const dev = asset.dev ?? asset.creator ?? null;
      const devBlocked = developerBlocklistVerified && dev
        ? blocked.has(String(dev))
        : null;
      return {
        source: 'jupiter-asset-api',
        mint,
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
        dataAgeSec: ageSec,
        createdAt: asset.createdAt ?? null,
        tokenAgeDays: Number.isFinite(Date.parse(asset.createdAt ?? ''))
          ? Math.max(0, (clock() - Date.parse(asset.createdAt)) / 86_400_000) : null,
        marketCapUsd: num(asset.mcap ?? asset.marketCap ?? asset.marketCapUsd),
        holderCount: num(asset.holderCount ?? asset.holders),
        holders: num(asset.holderCount ?? asset.holders),
        top10HoldersPct: num(asset.audit?.topHoldersPercentage),
        top10DevWalletPct: num(asset.audit?.topDevWalletPercentage),
        botHoldersPct: num(asset.audit?.botHoldersPercentage),
        mintAuthorityDisabled: asset.audit?.mintAuthorityDisabled === true ? true : asset.audit?.mintAuthorityDisabled === false ? false : null,
        freezeAuthorityDisabled: asset.audit?.freezeAuthorityDisabled === true ? true : asset.audit?.freezeAuthorityDisabled === false ? false : null,
        organicScore: num(asset.organicScore),
        tokenFeesSol: num(asset.fees),
        launchpad: asset.launchpad ?? null,
        devAddress: dev ? String(dev) : null,
        developerBlocklistVerified,
        devBlocked,
        audit: {
          mintAuthorityDisabled: asset.audit?.mintAuthorityDisabled === true ? true
            : asset.audit?.mintAuthorityDisabled === false ? false : null,
          freezeAuthorityDisabled: asset.audit?.freezeAuthorityDisabled === true ? true
            : asset.audit?.freezeAuthorityDisabled === false ? false : null,
          topHoldersPercentage: num(asset.audit?.topHoldersPercentage),
          botHoldersPercentage: num(asset.audit?.botHoldersPercentage)
        },
        raw: asset
      };
    }
  };
}
