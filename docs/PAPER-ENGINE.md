# Wave_Agent — Balanced LP paper strategy

## Strategy intent

This is an experimental **paper-only LP selection and management model**, not a promise or guarantee of positive returns. It seeks pools where fee income has a conservative, measurable chance to exceed estimated inventory drag and entry/exit costs.

Preset:
- Entry: **hybrid** — pool fee economics + 5m/30m market confirmation + two distinct, verified Meteora LP-add wallet groups.
- Style: **balanced LP** — 0.3% equity risk per position, 0.6% aggregate open risk, maximum two positions, maximum 12.5% equity allocation per position.
- Exit: **dynamic LP** — stress-adjusted hard stop; +2.5% trailing activation with 1 percentage-point giveback; persistent out-of-range; two 30m trend-reversal confirmations; two low-fee confirmations; tracked-wallet withdrawal convergence; 8% net take-profit; and seven-day time stop.
- Range: symmetric range whose half-width is derived from ATR and observed 24h volatility. The output is a paper planning range, not a transaction instruction.

## Entry checklist

A pool is eligible only when all hard gates pass:

1. **Pool quality and freshness:** TVL at least $25k, active TVL available, volume at least $10k, pool metrics no older than 90 seconds.
2. **Active liquidity:** active TVL at least 30% of total TVL; volume/active-TVL between 0.20 and 4.5.
3. **Fee persistence:** both 24h and 7d pool fees must exist. Whole-pool annualized APR on active TVL must be at least 50% for 24h and 60% for 7d; this is only a market sanity filter, never the LP position's expected return. 24h fee pace must not be more than 2.5× the seven-day daily average or below half its baseline.
4. **Net fee edge:** the proposed range's own per-bin PositionV2 fee replay must show at least 120% 24h position APR and 150% 7d position APR. The 7d projection uses the lower position APR, 65% fee capture, 30 bps round-trip costs and bin-simulated 7d inventory drag. Projected net edge must exceed 1.0% of deployed capital and fee projection must cover inventory drag + round-trip cost by at least 2x.
5. **Pair age and rug/liquidity risk:** exact DEX pair age >=14 days; market cap >=$250k; FDV/market cap <=2.5; pair liquidity >=$50k and >=8% of market cap; at least 50 transactions/24h and 15 sells; sell/buy ratio 0.35–3.5; price change between -18% and +45%. These are conservative screening thresholds, not proof against rugs. Pair evidence must match the exact pool + mint and be <=120 seconds old.
6. **Volatility and liquidity trend:** 24h realized volatility no more than 7%; liquidity outflow no worse than -8%.
7. **Token security:** verified metadata; mint and freeze authorities disabled; explicit honeypot=false and scam=false; security snapshot <=300 seconds; top 10 holder concentration <=35%; top 10 dev-wallet concentration <=15%; at least 200 holders; token age >=14 days; token-level market cap >=$250k.
8. **Market context:** 60 completed candles for both 5m and 30m; data age within configured limits; bullish recursive Supertrend on both timeframes; 30m close above EMA50; 5m MACD bullish; 5m RSI 42–65; 30m ADX 8–30; 5m volume ratio 0.8–3.5; price not excessively extended within the Bollinger envelope.
9. **Wallet confirmation:** at least two distinct wallet groups add quote-side liquidity to the exact pool within 120 seconds. Each event must be marked verified and successful, include the canonical Meteora DLMM program ID, signature, instruction index, and quote-side USD amount >=$25. The engine rejects unverified events; this flag must only be set by a transaction parser that validates the actual instruction and transaction metadata.
10. **Bin-level risk simulation:** an independently verified Meteora bin simulator must supply stress loss <=8%, seven-day inventory drag <=1.0%, 24h and 7d position-specific fee APR from the proposed bin distribution, fee model source `meteora-position-v2-bin-fee-replay`, and >=90% simulated range coverage. Without these, the engine deliberately refuses entry.

### Fee-farming hurdle example (7-day horizon)

The engine forecasts position fees from the proposed range's own per-bin fee APR:

`grossFeePct = min(positionAPR24h, positionAPR7d) × 168 / 8760 × 65%`

`netEdgePct = grossFeePct - 7dInventoryDragPct - 0.30% roundTripCost`

`coverage = grossFeePct / (7dInventoryDragPct + 0.30%)`

At a 150% position APR, the conservative fee forecast is approximately **1.87%** of deployed capital for seven days after the 35% capture haircut. With 0.50% modeled inventory drag and 0.30% round-trip cost, net edge is about **+1.07%**, with 2.33× fee coverage. At 0.90% inventory drag, the same APR leaves only about +0.67% net and fails both the 1.0% edge and 2× coverage hurdles. With 1.0% inventory drag, it is rejected. These calculations are model assumptions, not a promise of realized fees.

For a 1.0% net target, 65% fee capture, 168-hour horizon and 30 bps costs, the required conservative position APR is approximately 144% when 7d inventory drag is 0.50%, and approximately 185% when drag is 1.00%. This is why a high pool APR alone must not trigger an LP position.

## Position sizing

Position size is computed from the smaller of the 0.3% single-position equity budget and unused 0.6% portfolio risk budget. The loss denominator is the larger of the planned stop and bin stress loss, plus the 30 bps round-trip cost. Final size is also capped at 12.5% equity and available paper cash.

This is an intended risk budget, not a guaranteed maximum loss. Gaps, stale prices, missing bins and model error can exceed it. A live LP would need execution-specific slippage and exit liquidity modelling.

## Exit and position management

- **Hard stop:** net paper position return reaches the stress-adjusted stop (4–7.5%, linked to the bin stress estimate).
- **Profit lock:** peak net return reaches +2.5%, then gives back at least 1 percentage point while still positive.
- **Take profit:** net return reaches +8%.
- **Out of range:** position remains out of range for at least 15 minutes.
- **Trend reversal:** two consecutive 30m Supertrend bearish observations with ADX >=22.
- **Fee decay:** after 45 minutes, captured position-level fee APR is below 75% or below 60% of entry APR for two consecutive updates.
- **Tracked-wallet withdrawal:** two distinct verified tracked-wallet groups remove quote-side liquidity from the same pool during the 120-second window.
- **Forward economics:** after 45 minutes, current fee projection net of remaining inventory drag and close cost is <=0.
- **Time stop:** position is closed after seven days if none of the above triggered.
- **Cooldown:** the same pool cannot be re-entered for 30 minutes.

The strategy does not automatically rebalance. It paper-closes on exit conditions and requires a new complete entry evaluation before a later paper entry.

## Snapshot input contract

The stdin worker consumes one JSON object per line. Required fields:

- \`timestamp\`: Unix milliseconds or ISO timestamp.
- \`pool\`: \`poolAddress\`, \`tokenMint\`, \`tvlUsd\`, \`activeTvlUsd\`, \`volume24hUsd\`, \`fees24hUsd\`, \`fees7dUsd\`, \`dataAgeSec\`, \`volatility24hPct\`, \`liquidityTrend24hPct\`, \`symbol\`, and \`chain\`.
- \`security\`: \`verified\`, \`mintAuthorityDisabled\`, \`freezeAuthorityDisabled\`, \`honeypot\`, \`scam\`, \`dataAgeSec\`, \`top10HoldersPct\`, \`top10DevWalletPct\`, \`holders\`, \`tokenAgeDays\`, \`marketCapUsd\`.
- \`marketData\`: \`candles5mAgeSec\`, \`candles30mAgeSec\`.
- \`candles5m\`, \`candles30m\`: at least 60 completed OHLCV candles each.
- \`walletSignals\`: signature, instruction index, wallet or wallet group, exact pool, exact program ID, event type, timestamp, success=true, verified=true, quoteSide=true and quoteAmountUsd.
- \`lpRisk\`: verified=true, source=\`meteora-bin-stress-simulator\`, stressLossPct, expectedInventoryDragPct7d, simulatedRangeCoveragePct.
- For open position marks, prefer \`lpMark.inventoryPnlUsd\`, \`lpMark.feesSinceLastUsd\`, \`lpMark.inRange\` and optional \`lpMark.closeCostUsd\`. Otherwise PnL falls back to a simplified CLMM estimate and is explicitly labelled approximate.

**Integration limitation:** the existing Helius watcher does not yet decode and normalize verified Meteora liquidity instructions, and no completed bin-stress simulator currently generates the required \`lpRisk\` evidence. This engine therefore cannot safely create entries from raw Helius or Meteora snapshots yet. An adapter and bin-level stress simulator are still necessary. Never manufacture \`verified=true\` from an unparsed log or transfer.

## Accounting assumptions

The whole-pool APR is a coarse sanity filter only. Entry estimates use the lower of position-specific 24h and 7d fee APR values generated by replaying swap volume through the proposed DLMM bins and the position's liquidity share. Forecast fee capture is haircut by 35%; fees must cover modeled 7d inventory drag plus 30 bps round-trip cost with a 2x coverage margin and leave at least 1.0% projected net return over seven days. At runtime, fee accrual is accepted only from verified `lpMark` updates with source `meteora-position-v2-bin-fee-replay`, exact `feesSinceLastUsd`, and per-position fee APR values. Missing/unverified fee marks are never replaced with pool TVL share estimates; after two consecutive missing marks the paper position exits. Inventory PnL is exact only when a trusted bin-level mark is supplied; the fallback remains an approximate CLMM model and is not exact Meteora PositionV2 accounting.

The Meteora DLMM position account stores per-bin liquidity shares and fee checkpoints/pending amounts. Use decoded PositionV2 and bin/fee state rather than treating raw pool TVL as a position share. See the official docs linked in the project README.

## Run

Set \`PAPER_STARTING_EQUITY_USD\` or supply \`SOL_PRICE_USD\` to convert \`STARTING_EQUITY_SOL\` to USD. The worker fails closed if there is no positive USD equity mark.

\`\`\`bash
npm run paper:worker < fixtures/paper-snapshots.jsonl
npm test
\`\`\`

The paper worker never loads a signing key, creates transactions, signs, swaps, adds liquidity, removes liquidity, claims fees, or broadcasts transactions. AI is a post-decision analyst only and cannot change any deterministic decision.
