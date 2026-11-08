/** Chain-aware adapter contract. A chain is enabled only when a real DLMM/CLMM
 * adapter implementing these methods is installed and integration-tested. */
export class ChainRegistry {
  constructor() { this.adapters = new Map(); }
  register(adapter) {
    if (!adapter?.chain || typeof adapter.getPools !== 'function' || typeof adapter.getCandles !== 'function')
      throw new Error('Adapter must define chain, getPools(), and getCandles()');
    this.adapters.set(adapter.chain, adapter);
  }
  get(chain) {
    const adapter = this.adapters.get(chain);
    if (!adapter) throw new Error(`No production-ready liquidity adapter registered for ${chain}`);
    return adapter;
  }
  chains() { return [...this.adapters.keys()]; }
}
