/** Integration boundary for the existing Meridian Meteora DLMM modules.
 * Wire getPools/getCandles to verified Meteora APIs and existing RPC helpers.
 * Do not put signing or transaction submission in this adapter for paper mode. */
export function createMeteoraAdapter({ getPools, getCandles }) {
  if (typeof getPools !== 'function' || typeof getCandles !== 'function') throw new Error('Meteora data functions required');
  return { chain: 'solana', protocol: 'meteora-dlmm', getPools, getCandles };
}
