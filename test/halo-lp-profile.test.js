import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeHaloPerformance, summarizeHaloPoolHistory, chooseHaloPositionShape, calculateHaloSizing } from '../src/core/halo-lp-profile.js';

function trade({poolAddress='pool-a',netPnlUsd=2,feesAccruedUsd=10,inventoryPnlUsd=-4,openedAt=1_800_000_000_000,holdMinutes=60,plannedShape='spot'}={}) {
  return {poolAddress,netPnlUsd,feesAccruedUsd,inventoryPnlUsd,openedAt,closedAt:openedAt+holdMinutes*60_000,plannedShape};
}
test('HALO performance summary reports net PnL, fee retention, hold duration, repeat pools and shape mix',()=>{
  const start=1_800_000_000_000;
  const data=[trade({openedAt:start,holdMinutes:59,feesAccruedUsd:10,inventoryPnlUsd:-6}),
    trade({openedAt:start+2_000_000,poolAddress:'pool-a',holdMinutes:80,plannedShape:'bid-ask'}),
    trade({openedAt:start+4_000_000,poolAddress:'pool-b',holdMinutes:10})];
  const s=summarizeHaloPerformance(data,{now:start+10_000_000,windowDays:90});
  assert.equal(s.closedPositions,3);assert.equal(s.medianHoldMinutes,59);
  assert.ok(Math.abs(s.feeRetentionPct - (100 - 14 / 30 * 100)) < 1e-9);assert.ok(Math.abs(s.repeatPoolPositionSharePct-100/3)<1e-9);
  assert.equal(s.uniquePools,2);assert.equal(s.spotSharePct,50);assert.equal(s.bidAskSharePct,50);
});
test('HALO pool affinity requires repeated positive net results and at least 40% retained fees',()=>{
  const start=1_800_000_000_000;
  const data=[trade({poolAddress:'pool-a',netPnlUsd:5,inventoryPnlUsd:-4,openedAt:start}),
    trade({poolAddress:'pool-a',netPnlUsd:3,inventoryPnlUsd:-3,openedAt:start+1_000_000}),
    trade({poolAddress:'pool-b',netPnlUsd:99,inventoryPnlUsd:-9,openedAt:start+2_000_000})];
  assert.equal(summarizeHaloPoolHistory(data,'pool-a',{now:start+5_000_000,minClosedPositions:2}).reentryEligible,true);
  assert.equal(summarizeHaloPoolHistory(data,'pool-b',{now:start+5_000_000,minClosedPositions:1}).reentryEligible,false);
});
test('HALO selects Spot for aligned momentum and Bid-Ask for retrace in a bullish higher timeframe',()=>{
  const thirty={supertrend:'bullish',price:110,ema50:105,macdBias:'bullish'};
  assert.equal(chooseHaloPositionShape({thirty,five:{supertrend:'bullish',macdBias:'bullish',rsi:55}}).shape,'spot');
  assert.equal(chooseHaloPositionShape({thirty,five:{supertrend:'bearish',macdBias:'bearish',rsi:44}}).shape,'bid-ask');
});
test('HALO size-up is staged at 100/200/300 positive closes and fee retention gates',()=>{
  const now=1_800_000_000_000;
  const many=Array.from({length:300},(_,i)=>trade({openedAt:now-(300-i)*3_600_000,netPnlUsd:2,feesAccruedUsd:10,inventoryPnlUsd:-4}));
  assert.equal(calculateHaloSizing(many.slice(0,99),{now}).riskMultiplier,1);
  assert.equal(calculateHaloSizing(many.slice(0,100),{now}).riskMultiplier,1.25);
  assert.equal(calculateHaloSizing(many.slice(0,200),{now}).riskMultiplier,1.5);
  const sized=calculateHaloSizing(many,{now});
  assert.equal(sized.riskMultiplier,2);assert.equal(sized.effectiveRiskPerPositionPct,0.003);
});
