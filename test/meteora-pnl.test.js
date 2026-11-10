import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeteoraPnLReadOnlyAdapter } from '../src/adapters/meteora-pnl-readonly.js';

test('Meteora PnL adapter reads portfolio and per-pool PnL without write methods', async () => {
  const requests = [];
  const fetchImpl = async url => {
    requests.push(String(url));
    const payload = String(url).includes('/portfolio/open')
      ? { pools: [{ poolAddress: 'pool-a', positions: [{ positionAddress: 'pos-a', total_value_true_usd: 120, pnl_true_usd: 15, pnl_pct_derived: 14, unclaimed_fees_true_usd: 4, in_range: true }] }] }
      : { positions: [{ positionAddress: 'pos-a', poolAddress: 'pool-a', pnl_true_usd: 15, unclaimed_fees_true_usd: 4 }] };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const adapter = createMeteoraPnLReadOnlyAdapter({ fetchImpl, clock: () => 1_800_000_000_000 });
  const portfolio = await adapter.getPortfolio('wallet');
  const detail = await adapter.getPoolPnl('pool-a', 'wallet');
  assert.equal(portfolio.positions[0].positionAddress, 'pos-a');
  assert.equal(portfolio.positions[0].pnlUsd, 15);
  assert.equal(detail.positions[0].unclaimedFeesUsd, 4);
  assert.equal(adapter.readOnly, true);
  assert.equal(adapter.sendTransaction, undefined);
  assert.equal(requests.length, 2);
});

test('Meteora PnL falls back to an explicitly read-only SDK result', async () => {
  const adapter = createMeteoraPnLReadOnlyAdapter({
    fetchImpl: async () => new Response('unavailable', { status: 503 }),
    rpcFallback: async () => ({ readOnly: true, positions: [{ position: 'pos-rpc', pool: 'pool-rpc', pnl_pct: 2 }] })
  });
  const result = await adapter.getPositions('wallet');
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.source, 'meteora-sdk-rpc-fallback');
  assert.equal(result.positions[0].pnlPct, 2);
});
