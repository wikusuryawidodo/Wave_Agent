import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeteoraWalletActivityAdapter, decodeMeteoraLiquidityEvents } from '../src/adapters/meteora-wallet-activity.js';
import { METEORA_DLMM_PROGRAM_ID } from '../src/core/paper-engine.js';
import { rankTopLpWallets } from '../src/core/wallet-intelligence.js';

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function encodeBase58(bytes) {
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let out = '';
  while (n > 0n) { const r = Number(n % 58n); out = alphabet[r] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out || '1';
}
function transaction(wallet, pool, amounts = [100, 1_000_000_000]) {
  const discriminator = [228, 69, 165, 46, 81, 203, 154, 29];
  const data = encodeBase58(Uint8Array.from([...discriminator, 65, 66, 67, 68, 0, 0, 0, 0]));
  return {
    blockTime: 1_800_000_000,
    slot: 50,
    meta: { err: null, loadedAddresses: { writable: [], readonly: [] }, innerInstructions: [
      { index: 0, instructions: [{ programIdIndex: 0, data }] }
    ] },
    transaction: { message: { staticAccountKeys: [METEORA_DLMM_PROGRAM_ID] } },
    wallet, pool, amounts
  };
}

test('event decoder only accepts the canonical Meteora DLMM program and successful transactions', () => {
  const tx = transaction('wallet-a', 'pool-a');
  const coder = { decode: () => ({ name: 'addLiquidity', data: {
    from: 'wallet-a', position: 'position-a', lbPair: 'pool-a',
    amounts: ['100', '1000000000']
  } }) };
  const events = decodeMeteoraLiquidityEvents(tx, coder);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'add-liquidity');
  const bad = structuredClone(tx);
  bad.transaction.message.staticAccountKeys[0] = 'NotTheMeteoraProgram111111111111111111111111';
  assert.equal(decodeMeteoraLiquidityEvents(bad, coder).length, 0);
  const failed = { ...tx, meta: { ...tx.meta, err: { InstructionError: 1 } } };
  assert.equal(decodeMeteoraLiquidityEvents(failed, coder).length, 0);
});

test('wallet activity adapter requires exact PositionV2 owner/pool, quote side and ranked wallet', async () => {
  const now = 1_800_000_000_000;
  const wallet = 'wallet-a';
  const rank = rankTopLpWallets([{
    address: wallet, verified: true, source: 'top-lp-wallet-index',
    updatedAt: now - 1000, closedPositions: 30, winRatePct: 70,
    realizedPnlUsd: 800, feesEarnedUsd: 250, maxDrawdownPct: 8, rangeEfficiencyPct: 90
  }], { now });
  const tx = transaction(wallet, 'pool-a');
  const coder = { decode: () => ({ name: 'addLiquidity', data: {
    from: wallet, position: 'position-a', lbPair: 'pool-a',
    amounts: ['100', '1000000000']
  } }) };
  const helius = { readOnly: true, getTransaction: async () => tx };
  const adapter = createMeteoraWalletActivityAdapter({
    helius, eventCoder: coder, rankedWallets: rank,
    quoteMintPricesUsd: { So11111111111111111111111111111111111111112: 150 },
    clock: () => now,
    resolvePosition: async () => ({
      owner: wallet, poolAddress: 'pool-a', xMint: 'token-mint-a',
      yMint: 'So11111111111111111111111111111111111111112',
      decimalsX: 6, decimalsY: 9
    })
  });
  const result = await adapter.getVerifiedEvents('signature-a', wallet);
  assert.equal(result.length, 1);
  assert.equal(result[0].verified, true);
  assert.equal(result[0].walletRankVerified, true);
  assert.equal(result[0].quoteAmountUsd, 150);
});
