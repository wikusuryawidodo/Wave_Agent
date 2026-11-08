import { estimateFeeYield } from './fee-model.js';
import { clmmInventoryReturnPct, rangeExposure } from './impermanent-loss.js';
import { markToMarketDlmmPosition } from './dlmm-simulator.js';

/**
 * Snapshot backtest. Each row represents one interval and must contain
 * timestamp, price, tvlUsd, feesUsd, volumeUsd. No look-ahead: decision at
 * row i uses row i values; PnL is marked on next row.
 */
export function backtestSnapshots({ snapshots, initialCapitalUsd, rangePct = 8,
  rebalanceCostUsd = 0, maxAllocationPct = 0.35 }) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) throw new Error('At least two snapshots required');
  if (!(initialCapitalUsd > 0)) throw new Error('initialCapitalUsd must be positive');
  const rows = [...snapshots].sort((a,b) => a.timestamp - b.timestamp);
  let equity = initialCapitalUsd, peak = equity, maxDrawdownPct = 0, trades = 0, wins = 0;
  const curve = [{ timestamp: rows[0].timestamp, equityUsd: equity }];
  const tradeLog = [];
  for (let i=0; i<rows.length-1; i++) {
    const a = rows[i], b = rows[i+1];
    if (!(a.price > 0 && b.price > 0 && a.tvlUsd > 0 && a.feesUsd >= 0)) continue;
    const allocation = equity * maxAllocationPct;
    const half = rangePct / 200;
    const lower = a.price * (1-half), upper = a.price * (1+half);
    const exposure = rangeExposure({ price: a.price, lower, upper });
    const hours = Math.max(0, (b.timestamp-a.timestamp)/3_600_000);
    const fee = estimateFeeYield({ tvlUsd: a.tvlUsd, fees24hUsd: a.feesUsd,
      allocationUsd: allocation, inRangeShare: exposure.exposure,
      utilization: Math.min(1, (a.volumeUsd || 0) / Math.max(1, a.tvlUsd)),
      gasCostUsd: rebalanceCostUsd });
    let inventoryPnlUsd, feeUsd, relativeToHoldPct, accountingMode;
    if (Array.isArray(a.bins) && Array.isArray(b.bins) && Array.isArray(a.binAllocations)) {
      const x=markToMarketDlmmPosition({
        initialBins:a.bins,currentBins:b.bins,allocations:a.binAllocations,
        initialTokenXPriceUsd:a.tokenXPriceUsd,currentTokenXPriceUsd:b.tokenXPriceUsd,
        initialTokenYPriceUsd:a.tokenYPriceUsd,currentTokenYPriceUsd:b.tokenYPriceUsd,
        hoursElapsed:hours
      });
      inventoryPnlUsd=x.inventoryPnlUsd;
      feeUsd=x.feesUsd;
      relativeToHoldPct=x.holdValueUsd>0?(x.currentValueUsd/x.holdValueUsd-1)*100:0;
      accountingMode='observed-bin-inventory';
    } else {
      const inventory = clmmInventoryReturnPct({ initialPrice:a.price, price:b.price, lower, upper, capitalUsd:allocation });
      inventoryPnlUsd = allocation * inventory.pnlVsInitialPct/100;
      feeUsd = fee.estimatedNetDailyFeesUsd * hours/24;
      relativeToHoldPct=inventory.relativeToHoldPct;
      accountingMode='simplified-clmm-fallback';
    }
    const pnl = inventoryPnlUsd + feeUsd;
    equity += pnl;
    trades++;
    if (pnl > 0) wins++;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, (peak-equity)/peak*100);
    tradeLog.push({ from: a.timestamp, to: b.timestamp, allocationUsd: allocation,
      feeUsd, inventoryPnlUsd, relativeToHoldPct, accountingMode, pnlUsd:pnl, inRange: exposure.inRange });
    curve.push({ timestamp: b.timestamp, equityUsd: equity });
  }
  const totalReturnPct = (equity/initialCapitalUsd-1)*100;
  const grossWins = tradeLog.filter(t=>t.pnlUsd>0).reduce((s,t)=>s+t.pnlUsd,0);
  const grossLosses = Math.abs(tradeLog.filter(t=>t.pnlUsd<0).reduce((s,t)=>s+t.pnlUsd,0));
  return { initialCapitalUsd, finalEquityUsd: equity, totalReturnPct,
    trades, winRatePct: trades ? wins/trades*100 : 0,
    profitFactor: grossLosses ? grossWins/grossLosses : grossWins ? Infinity : 0,
    maxDrawdownPct, curve, tradesLog: tradeLog,
    caveat: 'When bin snapshots and allocations are provided, uses observed bin inventory and per-bin 24h fee inputs with a constant LP-share approximation. Otherwise falls back to a simplified V3-style inventory curve. Neither mode yet decodes exact Meteora PositionV2 liquidity shares and fee checkpoints or models rebalance swaps, MEV and slippage.' };
}
