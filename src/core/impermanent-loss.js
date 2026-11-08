/** Full-range 50/50 constant-product IL benchmark versus hold. */
export function impermanentLossPct(priceRatio) {
  if (!(priceRatio > 0) || !Number.isFinite(priceRatio)) throw new Error('priceRatio must be positive');
  return (2*Math.sqrt(priceRatio)/(1+priceRatio)-1)*100;
}
export function rangeExposure({ price, lower, upper }) {
  if (!(price>0 && lower>0 && upper>lower)) throw new Error('Invalid price range');
  if (price<=lower || price>=upper) return { inRange:false, exposure:0, status:price<=lower?'below-range':'above-range' };
  return { inRange:true, exposure:1, status:'in-range' };
}
/** V3-style concentrated inventory value for a fixed liquidity amount.
 * Price is token1 per token0. Returns quote-token value. */
export function clmmInventoryValue({ price, lower, upper, liquidity }) {
  if (!(price>0 && lower>0 && upper>lower && liquidity>0)) throw new Error('Invalid CLMM position inputs');
  const sp=Math.sqrt(price), sa=Math.sqrt(lower), sb=Math.sqrt(upper);
  let amount0=0, amount1=0;
  if (sp<=sa) amount0=liquidity*(sb-sa)/(sa*sb);
  else if (sp>=sb) amount1=liquidity*(sb-sa);
  else {
    amount0=liquidity*(sb-sp)/(sp*sb);
    amount1=liquidity*(sp-sa);
  }
  return { amount0, amount1, valueQuote:amount0*price+amount1,
    inRange:price>lower && price<upper };
}
/** Calibrate initial liquidity so position starts at supplied capital. */
export function clmmInventoryReturnPct({ initialPrice, price, lower, upper, capitalUsd }) {
  if (!(capitalUsd>0)) throw new Error('capitalUsd must be positive');
  const unit=clmmInventoryValue({price:initialPrice,lower,upper,liquidity:1});
  const L=capitalUsd/unit.valueQuote;
  const current=clmmInventoryValue({price,lower,upper,liquidity:L});
  const holdValue=capitalUsd*(0.5*price/initialPrice+0.5);
  return { ...current, liquidity:L, holdValueUsd:holdValue,
    pnlVsInitialPct:(current.valueQuote/capitalUsd-1)*100,
    relativeToHoldPct:(current.valueQuote/holdValue-1)*100 };
}
