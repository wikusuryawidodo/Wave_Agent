const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((a,b)=>a-b);
  const middle = Math.floor(ordered.length/2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle-1]+ordered[middle])/2;
}
function inWindow(trades,{now=Date.now(),windowDays=90}={}) {
  if (!Number.isFinite(now) || !(windowDays>0)) return [...trades];
  const floor=now-windowDays*86_400_000;
  return trades.filter(t=>Number.isFinite(Number(t.closedAt)) && Number(t.closedAt)<=now && Number(t.closedAt)>=floor);
}
export function summarizeHaloPerformance(closedTrades=[],options={}) {
  const trades=inWindow(Array.isArray(closedTrades)?closedTrades:[],options);
  const holds=trades.map(t=>(Number.isFinite(Number(t.openedAt))&&Number.isFinite(Number(t.closedAt))&&Number(t.closedAt)>=Number(t.openedAt))
    ?(Number(t.closedAt)-Number(t.openedAt))/60_000:null).filter(finite);
  const fees=trades.reduce((s,t)=>s+Math.max(0,Number(t.feesAccruedUsd)||0),0);
  const giveback=trades.reduce((s,t)=>s+Math.max(0,-(Number(t.inventoryPnlUsd)||0)),0);
  const gp=trades.reduce((s,t)=>s+Math.max(0,Number(t.netPnlUsd)||0),0);
  const gl=trades.reduce((s,t)=>s+Math.max(0,-(Number(t.netPnlUsd)||0)),0);
  const pools=new Map();let reentries=0,spot=0,bidAsk=0;
  for(const t of trades){const p=String(t.poolAddress??'');if(p){const prior=pools.get(p)||0;if(prior>0)reentries++;pools.set(p,prior+1);}
    if(t.plannedShape==='spot')spot++;if(t.plannedShape==='bid-ask')bidAsk++;}
  const known=spot+bidAsk;
  return {
    closedPositions:trades.length,totalNetPnlUsd:trades.reduce((s,t)=>s+(Number(t.netPnlUsd)||0),0),
    profitFactor:gl>0?gp/gl:gp>0?'infinite':null,medianHoldMinutes:median(holds),
    closedUnder15MinutesPct:holds.length?holds.filter(x=>x<15).length/holds.length*100:null,
    closedOver24HoursPct:holds.length?holds.filter(x=>x>=1440).length/holds.length*100:null,
    feeRetentionPct:fees>0?(fees-giveback)/fees*100:null,feesEarnedUsd:fees,inventoryGivebackUsd:giveback,
    repeatPoolPositionSharePct:trades.length?reentries/trades.length*100:null,uniquePools:pools.size,
    averagePositionsPerPool:pools.size?trades.length/pools.size:null,
    spotSharePct:known?spot/known*100:null,bidAskSharePct:known?bidAsk/known*100:null
  };
}
export function summarizeHaloPoolHistory(closedTrades=[],poolAddress,{now=Date.now(),windowDays=90,minClosedPositions=2,minFeeRetentionPct=40}={}) {
  const trades=inWindow(Array.isArray(closedTrades)?closedTrades:[],{now,windowDays}).filter(t=>t.poolAddress===poolAddress);
  const net=trades.reduce((s,t)=>s+(Number(t.netPnlUsd)||0),0);
  const fees=trades.reduce((s,t)=>s+Math.max(0,Number(t.feesAccruedUsd)||0),0);
  const giveback=trades.reduce((s,t)=>s+Math.max(0,-(Number(t.inventoryPnlUsd)||0)),0);
  const retention=fees>0?(fees-giveback)/fees*100:null;
  const eligible=trades.length>=minClosedPositions&&net>0&&finite(retention)&&retention>=minFeeRetentionPct;
  return {poolAddress,closedPositions:trades.length,netPnlUsd:net,feeRetentionPct:retention,reentryEligible:eligible};
}
export function chooseHaloPositionShape({five,thirty,mode='auto',bidAskRsiMin=35,bidAskRsiMax=48,minRsi5m=42,maxRsi5m=65}={}) {
  if(!five||!thirty||!['auto','spot','bid-ask'].includes(mode))return {eligible:false,shape:null,reason:'invalid indicator or shape mode'};
  const higher=thirty.supertrend==='bullish'&&thirty.price>thirty.ema50&&thirty.macdBias!=='bearish';
  const spot=higher&&five.supertrend==='bullish'&&five.macdBias==='bullish'&&five.rsi>=minRsi5m&&five.rsi<=maxRsi5m;
  const bidAsk=higher&&(five.supertrend==='bearish'||five.macdBias==='bearish')&&five.rsi>=bidAskRsiMin&&five.rsi<=bidAskRsiMax;
  const shape=mode==='spot'?(spot?'spot':null):mode==='bid-ask'?(bidAsk?'bid-ask':null):spot?'spot':bidAsk?'bid-ask':null;
  return {eligible:shape!==null,shape,reason:shape==='spot'?'aligned momentum: Spot intent':shape==='bid-ask'?'higher-timeframe uptrend with short-term pullback: Bid-Ask intent':'no HALO momentum/retrace setup'};
}
export function calculateHaloSizing(closedTrades=[],{
  now=Date.now(),windowDays=90,enabled=true,baseRiskPerPositionPct=0.0015,maxRiskPerPositionPct=0.003,
  minClosedPositions=100,level2ClosedPositions=200,level3ClosedPositions=300,
  minProfitFactor=1.2,level2ProfitFactor=1.3,level3ProfitFactor=1.4,minFeeRetentionPct=40
}={}) {
  const trades=inWindow(Array.isArray(closedTrades)?closedTrades:[],{now,windowDays});
  const perf=summarizeHaloPerformance(trades,{now,windowDays:0});
  const pf=perf.profitFactor==='infinite'?Number.POSITIVE_INFINITY:Number(perf.profitFactor);
  const qualified=enabled&&perf.totalNetPnlUsd>0&&finite(perf.feeRetentionPct)&&perf.feeRetentionPct>=minFeeRetentionPct;
  let multiplier=1,reason='base risk retained until positive closed-position evidence is sufficient';
  if(qualified&&trades.length>=level3ClosedPositions&&pf>=level3ProfitFactor){multiplier=2;reason='300+ closes, positive net PnL, fee retention and PF >=1.4';}
  else if(qualified&&trades.length>=level2ClosedPositions&&pf>=level2ProfitFactor){multiplier=1.5;reason='200+ closes, positive net PnL, fee retention and PF >=1.3';}
  else if(qualified&&trades.length>=minClosedPositions&&pf>=minProfitFactor){multiplier=1.25;reason='100+ closes, positive net PnL, fee retention and PF >=1.2';}
  const base=Number(baseRiskPerPositionPct),max=Number(maxRiskPerPositionPct);
  if(!(Number.isFinite(base)&&base>0&&Number.isFinite(max)&&max>=base&&max<=0.003))throw new Error('HALO risk must be positive and capped at 0.3% equity');
  return {sampleClosedPositions:trades.length,totalNetPnlUsd:perf.totalNetPnlUsd,profitFactor:Number.isFinite(pf)?pf:'infinite',
    feeRetentionPct:perf.feeRetentionPct,riskMultiplier:enabled?multiplier:1,
    effectiveRiskPerPositionPct:Math.min(max,base*(enabled?multiplier:1)),maxRiskPerPositionPct:max,
    reason:enabled?reason:'HALO size-up disabled; base risk retained'};
}
