import { createMeteoraOnchainAdapter } from './adapters/meteora-onchain.js';
const limit=Number(process.argv[2] ?? 20);
const adapter=createMeteoraOnchainAdapter();
const pools=await adapter.discoverPools({limit});
console.log(JSON.stringify(pools.map(({raw,...p})=>p),null,2));
