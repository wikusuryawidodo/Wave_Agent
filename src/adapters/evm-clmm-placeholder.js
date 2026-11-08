/** Base/BSC are not Meteora DLMM. This is deliberately an unregistered scaffold.
 * Implement protocol-specific concentrated-liquidity adapters (e.g. Uniswap v3
 * compatible pools) with chain ID validation, RPC quorum, decimals and tick math. */
export function createEvmClmmAdapter({ chain, getPools, getCandles }) {
  if (!['base', 'bsc', 'robinhood'].includes(chain)) throw new Error('Supported EVM scaffold chains: base, bsc');
  if (typeof getPools !== 'function' || typeof getCandles !== 'function') throw new Error('EVM data functions required');
  return { chain, protocol: 'evm-clmm-adapter-not-production-certified', getPools, getCandles, productionReady: false };
}
