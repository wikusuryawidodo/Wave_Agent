import { createMeteoraOnchainAdapter } from './adapters/meteora-onchain.js';
const [poolAddress,binsArg='20']=process.argv.slice(2);
if(!poolAddress) {
  console.error('Usage: npm run meteora:inspect -- <LB_PAIR_ADDRESS> [bins_each_side]');
  process.exit(2);
}
const adapter=createMeteoraOnchainAdapter();
const result=await adapter.getPool(poolAddress,{binsEachSide:Number(binsArg)});
console.log(JSON.stringify({...result,raw:undefined},null,2));
