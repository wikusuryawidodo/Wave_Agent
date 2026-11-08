import { postJson } from '../providers/http.js';

/** Helius/Solana read-only adapter. No signing, keypair, or sendTransaction. */
export function createHeliusReadOnlyAdapter({
  apiKey=process.env.HELIUS_API_KEY,
  rpcUrl=process.env.HELIUS_RPC_URL,
  enhancedUrl=process.env.HELIUS_ENHANCED_URL,
  fetchImpl=fetch
}={}) {
  const key=apiKey;
  const rpc=rpcUrl || (key ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}` : null);
  const enhanced=enhancedUrl || (key ? `https://api-mainnet.helius-rpc.com/v0/transactions/?api-key=${encodeURIComponent(key)}` : null);
  if(!rpc) throw new Error('HELIUS_API_KEY or HELIUS_RPC_URL is required');
  let nextId=1;
  async function call(method,params=[]) {
    const payload=await postJson(rpc,{jsonrpc:'2.0',id:nextId++,method,params},{fetchImpl});
    if(payload.error) throw new Error(`Helius RPC ${method}: ${payload.error.message ?? JSON.stringify(payload.error)}`);
    return payload.result;
  }
  return {
    provider:'helius',chain:'solana',readOnly:true,
    async getSlot(commitment='confirmed'){return call('getSlot',[{commitment}]);},
    async getBalance(address,commitment='confirmed'){return call('getBalance',[address,{commitment}]);},
    async getAccountInfo(address,commitment='confirmed',encoding='jsonParsed'){
      return call('getAccountInfo',[address,{commitment,encoding}]);
    },
    async getSignaturesForAddress(address,{limit=50,before,until,commitment='confirmed'}={}){
      const opts={limit,commitment}; if(before)opts.before=before;if(until)opts.until=until;
      return call('getSignaturesForAddress',[address,opts]);
    },
    async getTransaction(signature,{commitment='confirmed',maxSupportedTransactionVersion=0,encoding='json'}={}){
      return call('getTransaction',[signature,{commitment,maxSupportedTransactionVersion,encoding}]);
    },
    async getTokenAccountsByOwner(owner,mint=null,commitment='confirmed'){
      const filter=mint?{mint}:{programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'};
      return call('getTokenAccountsByOwner',[owner,filter,{commitment,encoding:'jsonParsed'}]);
    },
    async getAsset(assetId){
      return call('getAsset',[{id:assetId}]);
    },
    async getAssetsByOwner(owner,{page=1,limit=100}={}){
      return call('getAssetsByOwner',[{owner,page,limit}]);
    },
    async getParsedTransactions(signatures){
      if(!enhanced) throw new Error('HELIUS_ENHANCED_URL or HELIUS_API_KEY is required');
      if(!Array.isArray(signatures)||!signatures.length)return [];
      const url=enhanced.includes('?')?enhanced:`${enhanced}?api-key=${encodeURIComponent(key)}`;
      return postJson(url,{transactions:signatures},{fetchImpl});
    },
    async subscribeLogs(address,{onNotification,onError,commitment='confirmed'}={}){
      const WS=globalThis.WebSocket;
      if(typeof WS!=='function') throw new Error('Node.js WebSocket is unavailable; use Node 22+ or inject a WS client');
      const wsUrl=rpc.replace(/^https:/,'wss:').replace(/^http:/,'ws:');
      const ws=new WS(wsUrl);
      let id=1,subscriptionId=null;
      ws.addEventListener('open',()=>ws.send(JSON.stringify({jsonrpc:'2.0',id:id++,method:'logsSubscribe',
        params:[{mentions:[address]},{commitment}]})));
      ws.addEventListener('message',event=>{
        let msg;try{msg=JSON.parse(event.data);}catch{return;}
        if(msg.id && msg.result) subscriptionId=msg.result;
        if(msg.method==='logsNotification') onNotification?.(msg.params?.result);
      });
      ws.addEventListener('error',e=>onError?.(e));
      return {socket:ws,close:()=>ws.close(),get subscriptionId(){return subscriptionId;}};
    }
  };
}
