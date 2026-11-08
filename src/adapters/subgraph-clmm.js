import { postJson } from '../providers/http.js';
/** Generic read-only Uniswap V3-compatible GraphQL adapter.
 * Provide a chain-specific, currently indexed endpoint and verify schema/deployment.
 */
export function createV3SubgraphAdapter({ chain, endpoint, fetchImpl = fetch, protocol='uniswap-v3' }) {
  if (!['base','bsc','robinhood'].includes(chain) || !endpoint) throw new Error('Valid EVM chain and subgraph endpoint required');
  return {
    chain, protocol, readOnly:true,
    async getPools({ first=100, minTvlUsd=0 } = {}) {
      const poolQuery = `query Pools($first:Int!){ pools(first:$first, orderBy:totalValueLockedUSD, orderDirection:desc) {
        id feeTier liquidity sqrtPrice tick totalValueLockedUSD token0 { id symbol decimals }
        token1 { id symbol decimals } } }`;
      const response = await postJson(endpoint, { query:poolQuery, variables:{first} }, { fetchImpl });
      const data=response.data ?? response;
      const basePools=(data.pools ?? []).filter(p=>Number(p.totalValueLockedUSD)>=minTvlUsd);
      if (!basePools.length) return [];
      // Do not mistake all-time pool volume/fees for 24h metrics.
      const ids=basePools.map(p=>p.id.toLowerCase());
      const dailyQuery=`query Daily($ids:[String!]) { poolDayDatas(first:1000, orderBy:date, orderDirection:desc, where:{pool_in:$ids}) {
        id date volumeUSD feesUSD tvlUSD pool { id } } }`;
      let dailyByPool=new Map();
      try {
        const dailyResponse=await postJson(endpoint,{query:dailyQuery,variables:{ids}},{fetchImpl});
        const daily=dailyResponse.data ?? dailyResponse;
        for (const d of (daily.poolDayDatas ?? [])) {
          const key=d.pool?.id?.toLowerCase();
          if (key && !dailyByPool.has(key)) dailyByPool.set(key,d);
        }
      } catch { /* missing daily metrics stay zero and are rejected by screener */ }
      return basePools.map(p=>{
        const d=dailyByPool.get(p.id.toLowerCase());
        return { chain, protocol, poolAddress:p.id, token0:p.token0?.id, token1:p.token1?.id,
          symbol:`${p.token0?.symbol}/${p.token1?.symbol}`, tvlUsd:Number(p.totalValueLockedUSD),
          volume24hUsd:d?Number(d.volumeUSD):0, fees24hUsd:d?Number(d.feesUSD):0,
          feeTier:Number(p.feeTier), liquidity:p.liquidity, sqrtPrice:p.sqrtPrice,
          tick:Number(p.tick), dataQuality:d?'daily-snapshot':'daily-metrics-unavailable', raw:p };
      });
    },
    async getCandles(poolAddress, { first=48 } = {}) {
      const query=`query Hourly($pool:String!, $first:Int!) { poolHourDatas(first:$first, orderBy:periodStartUnix, orderDirection:desc, where:{pool:$pool}) {
        periodStartUnix open high low close volumeUSD } }`;
      const response=await postJson(endpoint,{query,variables:{pool:poolAddress.toLowerCase(),first}},{fetchImpl});
      const data=response.data ?? response;
      return (data.poolHourDatas ?? []).reverse().map(c=>({
        timestamp:Number(c.periodStartUnix)*1000, open:Number(c.open), high:Number(c.high),
        low:Number(c.low), close:Number(c.close), volume:Number(c.volumeUSD), volumeUsd:Number(c.volumeUSD)
      }));
    }
  };
}
