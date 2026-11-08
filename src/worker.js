import { createMeteoraOnchainAdapter } from './adapters/meteora-onchain.js';
const poolAddress=process.env.METEORA_POOL_ADDRESS;
const intervalSec=Math.max(15,Number(process.env.POLL_INTERVAL_SEC ?? 60));
const binsEachSide=Math.max(1,Math.min(70,Number(process.env.BINS_EACH_SIDE ?? 20)));
if(!poolAddress) {
  console.error('Set METEORA_POOL_ADDRESS in .env. Worker will not guess a pool.');
  process.exit(2);
}
const adapter=createMeteoraOnchainAdapter();
let busy=false, stopped=false;
async function tick() {
  if(busy || stopped) return;
  busy=true;
  try {
    const p=await adapter.getPool(poolAddress,{binsEachSide});
    const summary={
      type:'meteora_pool_snapshot', timestamp:new Date().toISOString(),
      poolAddress:p.poolAddress, slot:p.slot, activeBinId:p.activeBinId,
      activeBinPrice:p.activeBinPrice, binStep:p.binStep,
      dynamicFee:p.dynamicFee, feeInfo:p.feeInfo,
      bins:p.bins.map(({raw,...b})=>b)
    };
    process.stdout.write(JSON.stringify(summary)+'\n');
  } catch(e) {
    process.stderr.write(JSON.stringify({type:'read_error',timestamp:new Date().toISOString(),message:e.message})+'\n');
  } finally { busy=false; }
}
const timer=setInterval(tick,intervalSec*1000);
process.on('SIGTERM',()=>{stopped=true;clearInterval(timer);process.exit(0);});
process.on('SIGINT',()=>{stopped=true;clearInterval(timer);process.exit(0);});
await tick();
