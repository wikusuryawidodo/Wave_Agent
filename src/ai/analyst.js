const SYSTEM=`You are Meridian's market research analyst. You do not execute trades.
Analyze only the supplied data. Never invent on-chain facts. If fields are missing, state uncertainty.
Return JSON with: score (0-100), recommendation (watch|reject|research), risk_flags (string[]),
summary (string), evidence (string[]), missing_data (string[]).
Do not return transaction instructions, private-key requests, or an execution approval.`;

export function createMarketAnalyst(aiProvider) {
  return {
    async analyzePool(snapshot) {
      const safe=pickAllowedSnapshot(snapshot);
      const result=await aiProvider.complete({messages:[
        {role:'system',content:SYSTEM},
        {role:'user',content:JSON.stringify(safe)}
      ],temperature:0.1,maxTokens:700,jsonMode:true});
      let parsed;
      try {parsed=JSON.parse(result.content);} catch {throw new Error('AI response was not valid JSON');}
      if(!Number.isFinite(parsed.score)||parsed.score<0||parsed.score>100)throw new Error('AI score outside 0..100');
      if(!['watch','reject','research'].includes(parsed.recommendation))throw new Error('Invalid AI recommendation');
      return {...parsed,provider:result.provider,model:result.model,executionAllowed:false,
        disclaimer:'AI research only. Deterministic risk rules remain authoritative.'};
    }
  };
}
function pickAllowedSnapshot(s={}) {
  const allowed=['chain','protocol','poolAddress','symbol','tokenName','priceUsd','tvlUsd',
    'volume24hUsd','fees24hUsd','activeBinId','binStep','binCount','walletCount',
    'buySellRatio','volatilityPct','securityFlags','timestamp'];
  return Object.fromEntries(allowed.filter(k=>s[k]!==undefined).map(k=>[k,s[k]]));
}
