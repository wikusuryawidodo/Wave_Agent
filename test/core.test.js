import test from 'node:test';
import assert from 'node:assert/strict';
import { PaperLedger } from '../src/core/paper-ledger.js';
import { planRange } from '../src/core/range-planner.js';
import { ChainRegistry } from '../src/adapters/chain-registry.js';

test('paper ledger opens, accrues estimated fees and closes', () => {
  const l = new PaperLedger(1000);
  const p = l.open({ pool: 'pool1', allocationUsd: 200, range: { lower: 1, upper: 2 }, feeApr: 36 });
  l.accrueFees(p.id, 24);
  const c = l.close(p.id, { inventoryPnlPct: -0.05 });
  assert.ok(c.netPnlUsd > 0); // estimated 24h fee exceeds the illustrative 0.05% inventory loss at this illustrative APR
  assert.equal(l.positions.size, 0);
});

test('range planner returns ordered range', () => {
  const r = planRange({ price: 100, atr: 2, trend: 'bullish' });
  assert.ok(r.lower < 100 && r.upper > 100);
});

test('registry refuses unregistered chain', () => {
  const r = new ChainRegistry();
  assert.throws(() => r.get('base'), /No production-ready/);
});

test('Robinhood Chain metadata uses official mainnet and testnet IDs', async () => {
  const { ROBINHOOD_NETWORKS } = await import('../src/adapters/robinhood-chain.js');
  assert.equal(ROBINHOOD_NETWORKS.mainnet.chainId, 4663);
  assert.equal(ROBINHOOD_NETWORKS.testnet.chainId, 46630);
  assert.equal(ROBINHOOD_NETWORKS.mainnet.nativeCurrency.symbol, 'ETH');
});

test('Robinhood RPC adapter rejects a chain ID mismatch', async () => {
  const { createRobinhoodRpc } = await import('../src/adapters/robinhood-chain.js');
  const rpc = createRobinhoodRpc({ expectedChainId: 4663, fetchImpl: async () => ({ ok: true, json: async () => ({ result: '0x1' }) }) });
  await assert.rejects(rpc.health(), /chain ID mismatch/);
});

import { estimateFeeYield } from '../src/core/fee-model.js';
import { impermanentLossPct, clmmInventoryReturnPct } from '../src/core/impermanent-loss.js';
import { buildBinDistribution } from '../src/core/bin-distribution.js';
import { backtestSnapshots } from '../src/core/backtest.js';
import { normalizeMeteoraPool } from '../src/adapters/meteora-api.js';

test('fee yield scales by LP share and in-range capture', () => {
  const x=estimateFeeYield({tvlUsd:100000,fees24hUsd:1000,allocationUsd:1000,inRangeShare:0.5});
  assert.equal(x.estimatedGrossDailyFeesUsd,5);
  assert.ok(x.poolFeeAprPct>300);
});

test('constant product IL is negative away from parity', () => {
  assert.equal(impermanentLossPct(1),0);
  assert.ok(impermanentLossPct(4)<0);
});

test('concentrated inventory model starts at initial capital', () => {
  const x=clmmInventoryReturnPct({initialPrice:100,price:100,lower:90,upper:110,capitalUsd:1000});
  assert.ok(Math.abs(x.pnlVsInitialPct)<1e-8);
});

test('Meteora bin distribution sums to capital', () => {
  const bins=buildBinDistribution({activeBinId:100,binStepBps:25,lowerBinId:98,upperBinId:102,totalLiquidityUsd:500});
  assert.equal(bins.length,5);
  assert.ok(Math.abs(bins.reduce((s,b)=>s+b.allocationUsd,0)-500)<1e-8);
});

test('backtest produces equity curve and risk metrics', () => {
  const snapshots=[
    {timestamp:0,price:100,tvlUsd:100000,feesUsd:100,volumeUsd:50000},
    {timestamp:86400000,price:101,tvlUsd:101000,feesUsd:110,volumeUsd:55000},
    {timestamp:172800000,price:98,tvlUsd:99000,feesUsd:95,volumeUsd:48000}
  ];
  const r=backtestSnapshots({snapshots,initialCapitalUsd:1000});
  assert.equal(r.trades,2);
  assert.equal(r.curve.length,3);
  assert.ok(Number.isFinite(r.maxDrawdownPct));
});

test('Meteora raw pool normalized into common metrics', () => {
  const p=normalizeMeteoraPool({address:'pool',token_x:{mint:'x',symbol:'X'},token_y:{mint:'y',symbol:'Y'},tvl:1000,volume:500,fees_24h:4});
  assert.equal(p.tvlUsd,1000);
  assert.equal(p.volume24hUsd,500);
  assert.equal(p.fees24hUsd,4);
});

import { createMeteoraDataAdapter } from '../src/adapters/meteora-api.js';
import { createV3SubgraphAdapter } from '../src/adapters/subgraph-clmm.js';
import { createGmgnReadOnlyProvider } from '../src/adapters/gmgn-readonly.js';

test('Meteora adapter normalizes pool list and candles using mocked read-only HTTP', async () => {
  const fetchImpl=async (url) => {
    const u=String(url);
    const body=u.includes('/ohlcv')
      ? {data:[{timestamp:1000,open:'1',high:'2',low:'0.9',close:'1.5',volume:'99'}]}
      : {data:[{address:'p1',tvl:100000,volume:50000,fees_24h:100,token_x:{mint:'x',symbol:'X'},token_y:{mint:'y',symbol:'Y'}}]};
    return {ok:true,json:async()=>body};
  };
  const a=createMeteoraDataAdapter({baseUrl:'https://mock.local',fetchImpl});
  const pools=await a.getPools();
  assert.equal(pools[0].poolAddress,'p1');
  assert.equal(pools[0].fees24hUsd,100);
  const candles=await a.getCandles('p1');
  assert.equal(candles[0].volume,99);
});

test('V3 subgraph adapter maps daily metrics without treating lifetime fees as daily', async () => {
  let calls=0;
  const fetchImpl=async (_url,opts) => {
    calls++;
    const q=JSON.parse(opts.body).query;
    const data=q.includes('query Pools')
      ? {pools:[{id:'0xpool',feeTier:'3000',liquidity:'1',sqrtPrice:'1',tick:'0',totalValueLockedUSD:'100000',token0:{id:'a',symbol:'A'},token1:{id:'b',symbol:'B'}}]}
      : {poolDayDatas:[{date:100,volumeUSD:'5000',feesUSD:'15',tvlUSD:'100000',pool:{id:'0xpool'}}]};
    return {ok:true,json:async()=>({data})};
  };
  const a=createV3SubgraphAdapter({chain:'base',endpoint:'https://mock.local/graphql',fetchImpl});
  const pools=await a.getPools();
  assert.equal(calls,2);
  assert.equal(pools[0].volume24hUsd,5000);
  assert.equal(pools[0].fees24hUsd,15);
});

test('GMGN provider fails closed without an approved endpoint and key', async () => {
  const p=createGmgnReadOnlyProvider({url:'',apiKey:''});
  assert.equal(p.enabled,false);
  await assert.rejects(p.getMarket('sol','mint'),/obtain an API key/);
});

import { allocateAcrossObservedBins, markToMarketDlmmPosition, sumClaimablePositionFees } from '../src/core/dlmm-simulator.js';

test('DLMM planner allocates capital across observed bins', () => {
  const bins=[
    {binId:9,price:0.9,amountX:100,amountY:0,liquiditySupply:100},
    {binId:10,price:1,amountX:50,amountY:50,liquiditySupply:100},
    {binId:11,price:1.1,amountX:0,amountY:100,liquiditySupply:100}
  ];
  const a=allocateAcrossObservedBins({bins,activeBinId:10,capitalUsd:300,lowerBinId:9,upperBinId:11,
    tokenXPriceUsd:1,tokenYPriceUsd:1,shape:'spot'});
  assert.equal(a.length,3);
  assert.ok(Math.abs(a.reduce((s,x)=>s+x.allocationUsd,0)-300)<1e-8);
});

test('DLMM mark-to-market uses observed bin inventory and per-bin fees', () => {
  const initial=[{binId:1,amountX:100,amountY:0,fees24hUsd:0},{binId:2,amountX:0,amountY:100,fees24hUsd:0}];
  const current=[{binId:1,amountX:80,amountY:10,fees24hUsd:20},{binId:2,amountX:10,amountY:80,fees24hUsd:10}];
  const allocations=[{binId:1,allocationUsd:50},{binId:2,allocationUsd:50}];
  const r=markToMarketDlmmPosition({initialBins:initial,currentBins:current,allocations,
    initialTokenXPriceUsd:1,currentTokenXPriceUsd:1,initialTokenYPriceUsd:1,currentTokenYPriceUsd:1,hoursElapsed:24});
  assert.equal(r.binsModeled,2);
  assert.ok(r.feesUsd>0);
  assert.ok(Number.isFinite(r.totalPnlUsd));
});

test('claimable fee aggregation converts position fees to USD', () => {
  const r=sumClaimablePositionFees([{feeXPending:2,feeYPending:3}],{tokenXPriceUsd:4,tokenYPriceUsd:2});
  assert.equal(r.feesUsd,14);
});

test('GMGN read provider permits only read skill bridge', async () => {
  const calls=[];
  const p=createGmgnReadOnlyProvider({apiKey:'dummy',invokeSkill:async (skill,args)=>{calls.push(skill);return {ok:true};}});
  await p.getCandles('sol','mint',{resolution:'5m'});
  assert.deepEqual(calls,['gmgn-market']);
  assert.equal(p.swap,undefined);
});
