const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

export function assessPairRisk({
  pairEvidence,
  poolAddress,
  tokenMint,
  now = Date.now(),
  minPairAgeDays = 14,
  maxPairEvidenceAgeSec = 120,
  minMarketCapUsd = 250_000,
  maxMarketCapUsd = 10_000_000,
  maxFdvToMarketCap = 2.5,
  minPairLiquidityUsd = 50_000,
  minLiquidityToMarketCap = 0.08,
  minTransactions24h = 50,
  minSells24h = 15,
  minSellBuyRatio = 0.35,
  maxSellBuyRatio = 3.5,
  minPriceChange24hPct = -18,
  maxPriceChange24hPct = 45
} = {}) {
  const failures = [];
  if (!pairEvidence || pairEvidence.source !== 'dexscreener') {
    return { eligible: false, failures: ['exact DEX pair evidence missing or unsupported'], evidence: null };
  }
  if (String(pairEvidence.pairAddress ?? '').toLowerCase() !== String(poolAddress ?? '').toLowerCase()) {
    failures.push('DEX pair address does not exactly match Meteora pool address');
  }
  if (pairEvidence.chainId !== 'solana') failures.push('DEX pair is not on Solana');
  const baseMint = pairEvidence.baseToken?.address;
  const quoteMint = pairEvidence.quoteToken?.address;
  if (![baseMint, quoteMint].some(address => String(address ?? '').toLowerCase() === String(tokenMint ?? '').toLowerCase())) {
    failures.push('target token mint does not match either exact DEX pair token');
  }

  const retrievedAt = Number(pairEvidence.dataRetrievedAt);
  if (!finite(retrievedAt) || retrievedAt > now || now - retrievedAt > maxPairEvidenceAgeSec * 1000) {
    failures.push('DEX pair evidence is stale or has invalid retrieval time');
  }

  const createdAt = Number(pairEvidence.pairCreatedAtMs);
  const pairAgeDays = (now - createdAt) / 86_400_000;
  if (!finite(createdAt) || createdAt <= 0 || createdAt > now) failures.push('pair creation timestamp missing or invalid');
  else if (pairAgeDays < minPairAgeDays) failures.push('pair age below minimum');
  
  const marketCapUsd = Number(pairEvidence.marketCapUsd);
  const fdvUsd = Number(pairEvidence.fdvUsd);
  const liquidityUsd = Number(pairEvidence.liquidityUsd);
  if (!finite(marketCapUsd) || marketCapUsd < minMarketCapUsd || marketCapUsd > maxMarketCapUsd) failures.push('market cap outside allowed range or unavailable');
  if (!finite(fdvUsd) || !finite(marketCapUsd) || marketCapUsd <= 0 || fdvUsd < marketCapUsd) {
    failures.push('FDV/market cap evidence invalid or unavailable');
  } else if (fdvUsd / marketCapUsd > maxFdvToMarketCap) {
    failures.push('FDV to market cap ratio indicates material dilution');
  }
  if (!finite(liquidityUsd) || liquidityUsd < minPairLiquidityUsd) failures.push('DEX pair liquidity below minimum');
  if (finite(liquidityUsd) && finite(marketCapUsd) && marketCapUsd > 0 &&
      liquidityUsd / marketCapUsd < minLiquidityToMarketCap) {
    failures.push('pair liquidity is too small relative to market cap');
  }

  const txns = pairEvidence.txns24h ?? {};
  const buys = Number(txns.buys);
  const sells = Number(txns.sells);
  if (![buys, sells].every(Number.isFinite) || buys + sells < minTransactions24h || sells < minSells24h) {
    failures.push('24h transaction count or sell-side activity too low');
  }
  const sellBuyRatio = buys > 0 ? sells / buys : 0;
  if (buys > 0 && (sellBuyRatio < minSellBuyRatio || sellBuyRatio > maxSellBuyRatio)) {
    failures.push('buy/sell transaction balance outside healthy band');
  }

  const priceChange24hPct = Number(pairEvidence.priceChange24hPct);
  if (!finite(priceChange24hPct) || priceChange24hPct < minPriceChange24hPct ||
      priceChange24hPct > maxPriceChange24hPct) {
    failures.push('24h price move indicates dump or late pump risk');
  }

  return {
    eligible: failures.length === 0,
    failures,
    pairAgeDays: finite(createdAt) && createdAt > 0 ? pairAgeDays : null,
    marketCapUsd: finite(marketCapUsd) ? marketCapUsd : null,
    fdvUsd: finite(fdvUsd) ? fdvUsd : null,
    fdvToMarketCap: finite(fdvUsd) && finite(marketCapUsd) && marketCapUsd > 0 ? fdvUsd / marketCapUsd : null,
    liquidityUsd: finite(liquidityUsd) ? liquidityUsd : null,
    liquidityToMarketCap: finite(liquidityUsd) && finite(marketCapUsd) && marketCapUsd > 0 ? liquidityUsd / marketCapUsd : null,
    sellBuyRatio: buys > 0 && Number.isFinite(sells) ? sellBuyRatio : null,
    priceChange24hPct: finite(priceChange24hPct) ? priceChange24hPct : null,
    evidence: pairEvidence
  };
}
