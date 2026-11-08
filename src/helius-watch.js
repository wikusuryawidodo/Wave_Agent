import { createHeliusReadOnlyAdapter } from './adapters/helius-readonly.js';
const address=process.env.WATCH_WALLET_ADDRESS;
if(!address) {console.error('Set WATCH_WALLET_ADDRESS to a public Solana address');process.exit(2);}
const helius=createHeliusReadOnlyAdapter();
console.log(JSON.stringify({event:'watch_start',address,slot:await helius.getSlot()}));
const sub=await helius.subscribeLogs(address,{
  onNotification:n=>process.stdout.write(JSON.stringify({event:'logs',address,result:n})+'\\n'),
  onError:e=>console.error(JSON.stringify({event:'websocket_error',message:e?.message ?? String(e)}))
});
process.on('SIGINT',()=>{sub.close();process.exit(0);});
process.on('SIGTERM',()=>{sub.close();process.exit(0);});
