import { createAiProvider } from './ai/provider.js';
import { createMarketAnalyst } from './ai/analyst.js';
const provider=createAiProvider();
const analyst=createMarketAnalyst(provider);
const result=await analyst.analyzePool({
  chain:'solana',protocol:'meteora-dlmm',poolAddress:'EXAMPLE_POOL',
  tvlUsd:120000,volume24hUsd:85000,fees24hUsd:210,activeBinId:123,
  binStep:25,binCount:41,walletCount:3,timestamp:new Date().toISOString()
});
console.log(JSON.stringify(result,null,2));
