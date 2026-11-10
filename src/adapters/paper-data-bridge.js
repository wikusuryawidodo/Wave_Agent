/**
 * Stable read-only integration boundary for a future Blockchain API + API Router GPT.
 * Providers must expose explicit read methods. Execution/signing methods are never called.
 */
export function createPaperDataBridge({ blockchainApi, routerGpt } = {}) {
  if (!blockchainApi || blockchainApi.readOnly !== true || typeof blockchainApi.getPoolSnapshot !== 'function') {
    throw new Error('blockchainApi must be a read-only provider with getPoolSnapshot()');
  }
  if (!routerGpt || routerGpt.readOnly !== true || typeof routerGpt.getQuote !== 'function') {
    throw new Error('routerGpt must be a read-only quote provider with getQuote()');
  }

  return {
    provider: 'wave-agent-paper-data-bridge',
    readOnly: true,
    async getPoolSnapshot(poolAddress) {
      const snapshot = await blockchainApi.getPoolSnapshot(poolAddress);
      if (!snapshot || snapshot.pool?.poolAddress !== poolAddress) throw new Error('Blockchain API returned a mismatched pool snapshot');
      return snapshot;
    },
    async getRebalanceQuote(request) {
      const quote = await routerGpt.getQuote(request);
      if (!quote || quote.source !== 'read-only-router-quote' || quote.poolAddress !== request.poolAddress) {
        throw new Error('Router GPT returned a mismatched or non-read-only quote');
      }
      return quote;
    },
    executionEnabled: false
  };
}
