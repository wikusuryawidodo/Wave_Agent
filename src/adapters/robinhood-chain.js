/**
 * Robinhood Chain read-only network adapter boundary.
 * Official network facts: mainnet chainId 4663 / testnet 46630; ETH gas; EVM-compatible.
 * This does not claim a production-ready DEX/CLMM integration.
 */
export const ROBINHOOD_NETWORKS = Object.freeze({
  mainnet: { name: 'Robinhood Chain', chainId: 4663, rpcUrl: 'https://rpc.mainnet.chain.robinhood.com', explorerUrl: 'https://robinhoodchain.blockscout.com', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
  testnet: { name: 'Robinhood Chain Testnet', chainId: 46630, rpcUrl: 'https://rpc.testnet.chain.robinhood.com', explorerUrl: 'https://explorer.testnet.chain.robinhood.com', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
});

export function createRobinhoodRpc({ rpcUrl = process.env.ROBINHOOD_RPC_URL || ROBINHOOD_NETWORKS.mainnet.rpcUrl, expectedChainId = Number(process.env.ROBINHOOD_CHAIN_ID || 4663), fetchImpl = fetch } = {}) {
  let requestId = 0;
  async function rpc(method, params = []) {
    const response = await fetchImpl(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }) });
    if (!response.ok) throw new Error(`Robinhood RPC HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`Robinhood RPC ${payload.error.message || 'unknown error'}`);
    return payload.result;
  }
  return {
    chain: 'robinhood', chainId: expectedChainId, rpcUrl,
    async health() {
      const raw = await rpc('eth_chainId');
      const actual = Number(BigInt(raw));
      if (actual !== expectedChainId) throw new Error(`Robinhood RPC chain ID mismatch: expected ${expectedChainId}, got ${actual}`);
      const block = await rpc('eth_blockNumber');
      return { ok: true, chainId: actual, blockNumber: Number(BigInt(block)) };
    },
    async getPools() { throw new Error('Robinhood RPC is configured, but DEX pool discovery adapter is not implemented'); },
    async getCandles() { throw new Error('Robinhood Chain candle provider is not implemented'); },
  };
}
