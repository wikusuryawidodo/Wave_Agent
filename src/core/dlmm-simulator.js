const num=(v)=>Number(v ?? 0);
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));

/** Build a planned capital distribution over observed Meteora bins.
 * Token USD prices and token decimals must be normalized by the caller. */
export function allocateAcrossObservedBins({ bins, activeBinId, capitalUsd,
  lowerBinId, upperBinId, shape='curve', tokenXPriceUsd, tokenYPriceUsd }) {
  if (!Array.isArray(bins) || !(capitalUsd>0) || !(tokenXPriceUsd>0) || !(tokenYPriceUsd>0))
    throw new Error('bins, capitalUsd and positive token USD prices required');
  const selected=bins.filter(b=>b.binId>=lowerBinId && b.binId<=upperBinId);
  if (!selected.length) throw new Error('No observed bins inside selected range');
  const weights=selected.map(b=>{
    const d=Math.abs(b.binId-activeBinId);
    return shape==='spot' ? 1 : shape==='bid-ask' ? 1/(1+d*d) : 1/(1+d);
  });
  const sum=weights.reduce((a,b)=>a+b,0);
  return selected.map((b,i)=>({
    binId:b.binId, weight:weights[i]/sum, allocationUsd:capitalUsd*weights[i]/sum,
    observedBinValueUsd:num(b.amountX)*tokenXPriceUsd+num(b.amountY)*tokenYPriceUsd,
    price:num(b.price), amountX:num(b.amountX), amountY:num(b.amountY),
    liquiditySupply:num(b.liquiditySupply)
  }));
}

/** Revalue a paper LP allocation against actual observed per-bin inventory.
 * The LP share is approximated from deposited USD / initial bin TVL. Fees are
 * included only when bin-level observed fees are supplied in each snapshot. */
export function markToMarketDlmmPosition({ initialBins, currentBins, allocations,
  initialTokenXPriceUsd, currentTokenXPriceUsd, initialTokenYPriceUsd, currentTokenYPriceUsd,
  hoursElapsed=24 }) {
  const current=new Map(currentBins.map(b=>[Number(b.binId),b]));
  let currentValueUsd=0, holdValueUsd=0, feesUsd=0, allocatedUsd=0, inRangeBins=0;
  const details=[];
  for(const a of allocations) {
    const initial=initialBins.find(b=>Number(b.binId)===Number(a.binId));
    const now=current.get(Number(a.binId));
    if(!initial || !now) continue;
    const initialX=num(initial.amountX), initialY=num(initial.amountY);
    const currentX=num(now.amountX), currentY=num(now.amountY);
    const initialBinValue=initialX*initialTokenXPriceUsd+initialY*initialTokenYPriceUsd;
    if(initialBinValue<=0) continue;
    const lpShare=clamp(a.allocationUsd/initialBinValue);
    const initialShareX=initialX*lpShare, initialShareY=initialY*lpShare;
    const valueNow=lpShare*(currentX*currentTokenXPriceUsd+currentY*currentTokenYPriceUsd);
    const holdNow=initialShareX*currentTokenXPriceUsd+initialShareY*currentTokenYPriceUsd;
    const binFee=num(now.fees24hUsd)*lpShare*(hoursElapsed/24);
    currentValueUsd+=valueNow; holdValueUsd+=holdNow; feesUsd+=binFee;
    allocatedUsd+=a.allocationUsd; if(valueNow>0) inRangeBins++;
    details.push({binId:a.binId,lpSharePct:lpShare*100,valueNowUsd:valueNow,
      holdValueUsd:holdNow,feesUsd:binFee});
  }
  const inventoryPnlUsd=currentValueUsd-allocatedUsd;
  const ilVsHoldUsd=currentValueUsd-holdValueUsd;
  return { allocatedUsd,currentValueUsd,holdValueUsd,inventoryPnlUsd,ilVsHoldUsd,
    feesUsd,totalPnlUsd:inventoryPnlUsd+feesUsd,
    returnPct:allocatedUsd?(inventoryPnlUsd+feesUsd)/allocatedUsd*100:0,
    binsModeled:details.length,inRangeBins,details,
    caveat:'LP share is estimated from deposited USD / initial bin TVL. For exact position accounting use decoded PositionV2 liquidity_share and per-bin fee checkpoints; do not treat this planner output as exact on-chain PnL.' };
}

/** Actual-position accounting from SDK-decoded per-bin fee pendings. */
export function sumClaimablePositionFees(positionBins,{tokenXPriceUsd,tokenYPriceUsd}={}) {
  if(!(tokenXPriceUsd>0 && tokenYPriceUsd>0)) throw new Error('Token USD prices required');
  let feeX=0,feeY=0;
  for(const b of positionBins) {
    feeX+=num(b.feeXPending ?? b.fee_x_pending);
    feeY+=num(b.feeYPending ?? b.fee_y_pending);
  }
  return {feeX,feeY,feesUsd:feeX*tokenXPriceUsd+feeY*tokenYPriceUsd};
}
