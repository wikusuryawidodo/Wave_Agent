# Wave_Agent — Balanced LP paper strategy

## Strategy intent

This is an experimental **paper-only LP selection and management model**, not a promise or guarantee of positive returns. It seeks pools where fee income has a conservative, measurable chance to exceed estimated inventory drag and entry/exit costs.

Preset:
- Entry: **hybrid** — pool fee economics + 5m/30m market confirmation + two distinct, verified Meteora LP-add wallet groups.
- Style: **capital-capped LP** — 0.3% equity risk per position and 0.6% aggregate open risk remain independent controls; maximum two positions; 45% maximum capital allocation per position; 90% maximum total capital utilization across positions and rebalances, leaving at least 10% unallocated.
- Exit: **asymmetric LP** — paper rebalance at -15%, -30%, and -45% spot drawdown from entry; hard stop at -50%; plus +2.5% trailing activation with 1 percentage-point giveback, persistent out-of-range, two 30m trend-reversal confirmations, two low-fee confirmations, tracked-wallet withdrawal convergence, 8% net take-profit, and seven-day time stop.
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
8. **Meridian-style token/pool screening:** organic token score >=60; bot-holder rate <=30%; token priority/Jito fee activity >=30 SOL; launchpad allow/block lists; pool TVL $25k–$150k; Meteora bin step 80–125; quote-side organic score >=60; fee/active-TVL ratio >=0.05. Existing stricter token authority, top-holder, pair age and market-cap rules remain in force.
9. **Market context:** 60 completed candles for both 5m and 30m; data age within configured limits; bullish recursive Supertrend on both timeframes; 30m close above EMA50; 5m MACD bullish; 5m RSI 42–65; 30m ADX 8–30; 5m volume ratio 0.8–3.5; price not excessively extended within the Bollinger envelope.
10. **Top LP wallet confirmation:** at least two distinct ranked wallet groups add quote-side liquidity to the exact pool within 120 seconds. Wallet rank comes from a fresh trusted `top-lp-wallet-index` record containing closed-position count, realized PnL, fees, win rate, range efficiency and drawdown. Each event must be verified/successful, include canonical Meteora DLMM program ID, signature, instruction index, and quote-side USD amount >=$25. Raw transfer/log activity never qualifies.
11. **Bin-level risk simulation:** an independently verified Meteora bin simulator must supply stress loss <=8%, seven-day inventory drag <=1.0%, 24h and 7d position-specific fee APR from the proposed bin distribution, fee model source `meteora-position-v2-bin-fee-replay`, and >=90% simulated range coverage. Without these, the engine deliberately refuses entry.

### Fee-farming hurdle example (7-day horizon)

The engine forecasts position fees from the proposed range's own per-bin fee APR:

`grossFeePct = min(positionAPR24h, positionAPR7d) × 168 / 8760 × 65%`

`netEdgePct = grossFeePct - 7dInventoryDragPct - 0.30% roundTripCost`

`coverage = grossFeePct / (7dInventoryDragPct + 0.30%)`

At a 150% position APR, the conservative fee forecast is approximately **1.87%** of deployed capital for seven days after the 35% capture haircut. With 0.50% modeled inventory drag and 0.30% round-trip cost, net edge is about **+1.07%**, with 2.33× fee coverage. At 0.90% inventory drag, the same APR leaves only about +0.67% net and fails both the 1.0% edge and 2× coverage hurdles. With 1.0% inventory drag, it is rejected. These calculations are model assumptions, not a promise of realized fees.

For a 1.0% net target, 65% fee capture, 168-hour horizon and 30 bps costs, the required conservative position APR is approximately 144% when 7d inventory drag is 0.50%, and approximately 185% when drag is 1.00%. This is why a high pool APR alone must not trigger an LP position.

## Position sizing

Position size is computed from the smaller of the 0.3% single-position equity budget and unused 0.6% portfolio risk budget. The loss denominator is the larger of the planned stop and bin stress loss, plus the 30 bps round-trip cost. Final size is also capped at 45% equity, available cash, and remaining headroom under the 90% portfolio capital-utilization ceiling. Capital utilization is distinct from the loss-risk budget: 90% is an absolute ceiling, not a target. The 10% reserve is never committed to LP positions or rebalance operations.

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

The asymmetric policy watches spot drawdown from entry: -15%, -30%, and -45% each create one rebalance stage; -50% is the hard stop. A rebalance is applied to paper state only after a fresh, verified `read-only-router-quote` matches the exact pool, has <=50 bps impact, <=5% residual imbalance, and a new range containing current price. It reuses existing position inventory and forbids additional capital top-ups/averaging down. Without that quote, the stage remains pending and no range is changed. Actual DLMM remove/swap/add transactions are not sent.

## Snapshot input contract

The stdin worker consumes one JSON object per line. Required fields:

- \`timestamp\`: Unix milliseconds or ISO timestamp.
- \`pool\`: \`poolAddress\`, \`tokenMint\`, \`tvlUsd\`, \`activeTvlUsd\`, \`volume24hUsd\`, \`fees24hUsd\`, \`fees7dUsd\`, \`dataAgeSec\`, \`volatility24hPct\`, \`liquidityTrend24hPct\`, \`symbol\`, and \`chain\`.
- \`security\`: \`verified\`, \`mintAuthorityDisabled\`, \`freezeAuthorityDisabled\`, \`honeypot\`, \`scam\`, \`dataAgeSec\`, \`top10HoldersPct\`, \`top10DevWalletPct\`, \`holders\`, \`tokenAgeDays\`, \`marketCapUsd\`.
- \`marketData\`: \`candles5mAgeSec\`, \`candles30mAgeSec\`.
- \`candles5m\`, \`candles30m\`: at least 60 completed OHLCV candles each.
- \`walletSignals\`: signature, outer and inner instruction indices, wallet or wallet group, exact pool, exact program ID, event type, timestamp, success=true, verified=true, quoteSide=true, quoteAmountUsd and verified top-wallet rank fields.
- \`walletActivity\`: a fresh generated 24h summary from verified Helius LP events with `source=helius-wallet-monitor`, `generatedAt`, `uniqueActiveWallets24h`, `walletActivityScore` and `netQuoteFlowUsd`. This is mandatory by default; missing or stale summaries fail closed.
- \`lpRisk\`: verified=true, source=\`meteora-bin-stress-simulator\`, stressLossPct, expectedInventoryDragPct7d, simulatedRangeCoveragePct.
- For open position marks, prefer \`lpMark.inventoryPnlUsd\`, \`lpMark.feesSinceLastUsd\`, \`lpMark.inRange\` and optional \`lpMark.closeCostUsd\`. Otherwise PnL falls back to a simplified CLMM estimate and is explicitly labelled approximate.

**Integration limitation:** the read-only Helius/Meteora wallet decoder and PositionV2 resolver contract are now present, but they are not wired as a turnkey live snapshot producer. A local `PAPER_SNAPSHOT_PROVIDER_MODULE` must join verified wallet events, trusted wallet performance ranking, security, pair evidence, candles, pool metrics, bin fee marks, bin stress marks and any router quote. No completed bin-stress or PositionV2 historical fee replay provider is included yet. Never manufacture `verified=true` from an unparsed log or transfer.

## Accounting assumptions

The whole-pool APR is a coarse sanity filter only. Entry estimates use the lower of position-specific 24h and 7d fee APR values generated by replaying swap volume through the proposed DLMM bins and the position's liquidity share. Forecast fee capture is haircut by 35%; fees must cover modeled 7d inventory drag plus 30 bps round-trip cost with a 2x coverage margin and leave at least 1.0% projected net return over seven days. At runtime, fee accrual is accepted only from verified `lpMark` updates with source `meteora-position-v2-bin-fee-replay`, exact `feesSinceLastUsd`, and per-position fee APR values. Missing/unverified fee marks are never replaced with pool TVL share estimates; after two consecutive missing marks the paper position exits. Inventory PnL is exact only when a trusted bin-level mark is supplied; the fallback remains an approximate CLMM model and is not exact Meteora PositionV2 accounting.

The Meteora DLMM position account stores per-bin liquidity shares and fee checkpoints/pending amounts. Use decoded PositionV2 and bin/fee state rather than treating raw pool TVL as a position share. See the official docs linked in the project README.

## Run

Set \`PAPER_STARTING_EQUITY_USD\` or supply \`SOL_PRICE_USD\` to convert \`STARTING_EQUITY_SOL\` to USD. The worker fails closed if there is no positive USD equity mark.

\`\`\`bash
npm run paper:worker < fixtures/paper-snapshots.jsonl
npm test
\`\`\`

The paper worker never loads a signing key, creates transactions, signs, swaps, adds liquidity, removes liquidity, claims fees, or broadcasts transactions. AI is a post-decision analyst only and cannot change any deterministic decision. Run `npm run paper:fee-analysis` for fee/IL sensitivity cases. Liquidity-mining reward emissions are excluded from fee APR and would need a separate conservative reward-price/claimability model.



## Alternative strategy: trending pools + one-token zap

This module is separate from the balanced-LP engine and is **paper-only**.

### Pool discovery and ranking

Rank candidates by 24h volume, 1h volume velocity versus the 24h hourly average, volume/active-TVL utilization, and consistency of 24h fees versus the trailing seven-day daily average. Reject low-depth pools, volume bursts that are too extreme, missing fee history, and fee pace outside 0.5×–2.5× its seven-day baseline. Trending volume is a discovery signal, not token-safety evidence; all existing age, market-cap, FDV, liquidity and token-security gates still apply.

### One-token funding modes

- **Quote/stable zap in-range:** input only an explicitly allowlisted quote asset (e.g. USDG or WETH; WETH is volatile and is not treated as a stablecoin). Require a fresh read-only router quote for the exact input/output mint, price impact <=50 bps, auto-balance residual <=5%, expected output and minimum output. The quoted route is expected to convert part of the input asset so the position is two-sided and in-range immediately. If no approved zap quote exists, reject the candidate.
- **Directional single-sided range:** a token-only position is placed fully above spot for bullish direction or fully below spot for bearish direction. It is not an active fee-farming position while price remains outside the range. Require an SDK read-only one-sided composition quote for the exact mint before treating the plan as viable. Directional inventory risk and missed fee opportunity must be included; this is closer to a range order than immediate stable-yield farming.

The implementation does not assume that a generic one-token input magically becomes two-sided. The \`stable-zap-inrange\` flow needs integration with a router or platform that returns a verifiable quote. Meteora's DLMM instruction set supports \`add_liquidity*\` flows including one-sided parameters, and has separate swap instructions; however, constructing a zap requires quoting and sizing the required swap as well as the LP deposit. No zap transaction is built or sent by this repo.

### Adaptive range presets

- Stable, quiet and tokenized-stock profiles: ±6%.
- Normal trending token profile: ±15%.
- High-volatility profile: ±30–50%, calculated as \`clamp(2.5 × volatility24hPct, 30, 50)\`.

These are starting presets, not universal optimal ranges. The high-volatility preset does not waive the 14-day pair-age and token-security restrictions. For a new listing, observe it until it passes maturity and security gates rather than using a wider band as a substitute for due diligence. Tokenized-stock candidates additionally require the exact target mint to be in the configured issuer allowlist and a fresh `assetVerification` record with `source=issuer-allowlist`.

For directional single-sided ranges, the range is placed fully beyond spot with a volatility-dependent activation buffer. It does not earn swap fees until price trades into that range. This is distinct from stable-only zap into a range that already contains spot.

### Five-minute position monitor

Every 5 minutes, evaluate current price versus range, fee delta, inventory mark and expected close cost:
- In range and verified fees increasing: hold, subject to net-edge and risk gates.
- Within the outer 15% of the range: \`prepare-close\` warning; watch for an exit or reduce decision.
- First confirmed mark outside the range: \`close-and-rotate\` recommendation.
- Three consecutive 5-minute marks without fee growth trigger a rotate recommendation; any supplied minimum net-PnL hurdle is checked on every mark.

This monitor is advisory. It does not submit removal, swap or zap transactions. Rotation should only occur when a replacement pool independently passes the same safety and net-fee tests; do not rotate into a lower-quality pool simply to avoid idle time.

### Portfolio sizing

Keep two open positions under the existing 0.6% aggregate risk budget. A third position is not enabled by default: adding one without reducing per-position risk would breach the aggregate cap. For small capital, quote/stable-only entry can be easier to budget, but router price impact and fee coverage still determine whether it is worthwhile.

### Required inputs and integration status

The candidate snapshot needs:
- Pool: base/quote mint, TVL, active TVL, volume24h, volume1h, fees24h, fees7d, volatility and freshness.
- Exact pair evidence and token security snapshot meeting the existing maturity thresholds.
- \`lpRisk\` from a verified per-bin fee and stress replay.
- For quote/stable zap: \`zapQuote\` with \`source=read-only-router-quote\`, exact mints, quote timestamp, input USD amount, expected output, minimum output, price-impact bps and residual balance error.
- For directional single-sided: \`singleSidedQuote\` from the read-only Meteora SDK adapter confirming the single input mint and bin composition.

No USDG mint address, WETH mint address, router, Zenith API or SDK zap quote has been hardcoded. The caller must explicitly configure allowed quote mints and quote providers. This avoids treating a token symbol as proof of a stable asset or implying that Zenith integration exists.

The module exports \`rankTrendingPools\`, \`chooseTrendingZapRange\`, \`chooseDirectionalSingleSidedRange\`, \`evaluateTrendingZapCandidate\` and \`evaluateZapPositionMark\`.


## GMGN Trending, Market Signals and FOMO distinction

The repository now exposes two read-only GMGN integration paths:
- \`gmgnCli\`: invokes only the official CLI's \`config --check\` and \`market\` read commands. It supports trending, trenches, signals, hot searches and K-lines.
- \`gmgn\`: injectable Skills/MCP bridge adapter for deployments that already have an approved read-only GMGN tool bridge.

Before use, install/update the official \`gmgn-cli\`, configure the API key using the CLI's documented configuration flow, and confirm \`gmgn-cli config --check\` succeeds. The CLI adapter checks configuration once before the first market request. Rate limits are managed by GMGN; respect 429 reset information rather than retrying aggressively.

GMGN feeds have different meanings:
- **Trending:** top tokens ranked by swap activity, with 1m/5m/1h/6h/24h windows. Useful to discover momentum candidates.
- **Hot Searches:** top searched tokens ranked by visiting count. This is attention/search interest, not executed buy volume.
- **Market Signals:** discrete events such as price spikes, ATH, Dex trending-bar/ad/boost, smart money buy, platform call and KOL buy. Types 14–16 are excluded from explicit type requests because the documented API rejects them.
- **Trenches:** launchpad lifecycle groups: new creation, near completion and completed/graduated pools.

The helper \`rankGmgnDiscoveryTokens\` adds a fail-closed shortlist using GMGN market cap, liquidity, token age, rug ratio, wash-trading flag, top-10 concentration, insider/bundler ratios, volume, smart-degen and renowned counts. It only nominates tokens for further research; it does not authorize an LP entry.

### FOMO Thesis and Fomo Top

Fomo Thesis and Fomo Top are separate chart marker datasets, not documented fields in GMGN's standard Market Signal API:
- **Fomo Thesis** is a post written on FOMO by a user who is holding the token.
- **Fomo Top** is a transfer marker for an address indexed as a FOMO top wallet. A transfer-in does not prove a market buy; it can be a transfer.

The current GMGN CLI adapter therefore does not claim to fetch Fomo Thesis/Fomo Top. They require a separate supported FOMO/FomoScan data integration. Do not synthesize these markers from regular GMGN smart-money signals.

### How Wave_Agent uses the GMGN data

1. Fetch GMGN Trending 5m/1h and Market Signals (smart-money buy, KOL/platform call, price spike/Dex trending bar).
2. Optionally use Hot Searches as a secondary attention signal, never as trade volume.
3. Rank tokens with \`rankGmgnDiscoveryTokens\`; reject high rug ratio, wash trading and incomplete safety fields.
4. Resolve each token mint to exact Meteora LB pool(s). A trending token without a verified active pool remains discovery-only.
5. Recalculate pair age, pair liquidity, market cap/FDV, security, 5m/30m market structure, bin-specific position fee APR, inventory drag and zap quote. GMGN is never sufficient by itself to pass the LP entry gate.


## Asymmetric stop and rebalance ladder

Drawdown levels are measured from the entry spot price, not from wallet equity:
- -15%: first paper range-rebalance stage
- -30%: second paper range-rebalance stage
- -45%: third paper range-rebalance stage
- -50%: hard-stop exit

Each stage can occur only once per position. The engine does not silently change ranges: it requires a matching, fresh quote with `source=read-only-router-quote`, `verified=true`, exact `poolAddress`, `priceImpactBps <= 50`, `residualBalancePct <= 5`, a range containing current price, and `fundingMode=reuse-existing-inventory`. Any non-zero `additionalCapitalUsd` is rejected. In this phase the engine updates only paper state; a future executor must implement remove/swap/add with independent slippage, account, and transaction safeguards.

## Portfolio capital utilization

`maxPortfolioUtilizationPct=0.90` caps the sum of position allocations after every entry and rebalance. At least 10% of current equity is therefore outside LP positions. The existing risk budget (0.3% per position / 0.6% aggregate) is separate and can restrict allocation far below 90%. Do not increase the risk budget just to force capital utilization.

## Top LP wallet and Meridian-style screening

Wallet events must match canonical Meteora DLMM CPI events and a verified PositionV2 ownership/pool record. The wallet must additionally match a fresh trusted `top-lp-wallet-index` score. Rank inputs should include closed-position sample size, realized PnL, fees earned, win rate, max drawdown and range efficiency. The repository includes rank/decoder adapters but no automatic provider for a global top-trader list; configure a trusted index or curated feed.

Token/pool fields now also require organic score, bot-holder ratio, token fee activity, developer blocklist result, launchpad status, Meteora bin step, quote organic score and fee/active-TVL ratio. Missing or stale fields fail closed.

## Read-only PnL and automated paper runtime

`createMeteoraPnLReadOnlyAdapter` reads Meteora portfolio and per-pool PnL endpoints and can use an injected read-only SDK fallback. It does not convert headline PnL into per-interval `PositionV2` fee marks. The engine still accepts exact, independently verified bin-level `lpMark` inputs only.

`npm run paper:runtime` runs the persistent orchestrator. Set `PAPER_SNAPSHOT_PROVIDER_MODULE` to a local module exporting `createSnapshotProvider({ config, env })`. It must return an object with `readOnly: true` and `getSnapshots()`, and must not expose signing or transaction methods. The orchestrator is single-flight, orders snapshots by timestamp, persists state after each snapshot, reports errors and stops cleanly. It does not itself construct the external Blockchain API/Router GPT client; `createPaperDataBridge` defines a read-only provider contract for that future connection.


## HALO behavioural LP profile (paper-only)

The configurable HALO profile translates the supplied 90-day aggregated closed-position observations into measurable guardrails. The report is observational, not causal evidence or a profit guarantee. Wave_Agent does not contain HALO's 1.7m-position dataset or a live HALO API feed; runtime metrics are calculated from Wave_Agent's own closed paper positions.

- **Quote assets:** only canonical wrapped SOL and native USDC mints on Solana mainnet are allowed by default; verify the exact quote mint, not its display symbol.
- **Position shape:** `HALO_POSITION_SHAPE_MODE=auto` tags aligned 5m/30m momentum as Spot and a 5m pullback inside a bullish 30m trend as Bid-Ask. This is a paper intent tag; the current range planner does not yet generate Meteora's exact per-bin Spot/Bid-Ask liquidity distribution.
- **Holding:** soft profit-taking waits at least 20 minutes; 59 minutes is a reference/measurement target, not a mandatory hold. Hard stop, tracked-wallet withdrawal, missing verified fee marks, out-of-range timeout and other risk exits are never delayed.
- **Fee retention:** candidate economics estimates the share of gross position fees left after inventory/IL giveback. Default floor is 40%; realized PnL still includes fees, inventory PnL and round-trip costs.
- **Pool re-entry:** a score bonus is granted only after at least two closed trades in the exact pool, positive combined net PnL and at least 40% fee retention. It never bypasses freshness, security, wallet, fee-replay or risk checks.
- **Concurrency:** up to five paper positions by default. Aggregate risk remains 0.6% equity and capital usage remains capped at 90%; five is a ceiling, not a target.
- **Sizing:** starts at 0.15% equity risk per position. The staged ceiling is 0.30% after 100/200/300 closed positions in the rolling 90-day sample, positive aggregate net PnL, fee retention >=40%, and profit factor >=1.2/1.3/1.4 respectively. The 0.6% aggregate risk budget and 90% capital cap are unchanged.

The paper summary reports median hold time, share closed under 15 minutes, share held at least 24 hours, fee retention after inventory giveback, repeated-pool share, positions per pool, Spot/Bid-Ask share, net PnL and profit factor. HALO-style wallet ranking reduces win-rate weight when behaviour fields are available; without those optional fields, the ranker uses its backward-compatible metric set.

See `.env.example` for `HALO_PROFILE_ENABLED`, `HALO_MIN_HOLD_MINUTES`, `HALO_TARGET_HOLD_MINUTES`, `HALO_MIN_FEE_RETENTION_PCT`, `HALO_POOL_REENTRY_*`, `HALO_POSITION_SHAPE_MODE`, `HALO_ALLOWED_QUOTE_MINTS`, and `HALO_SIZE_UP_*`. The staged size-up is a risk heuristic, not a claim that these thresholds reproduce HALO's winner cohort.
