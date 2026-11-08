import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeliusReadOnlyAdapter } from '../src/adapters/helius-readonly.js';
import { createAiProvider } from '../src/ai/provider.js';
import { createMarketAnalyst } from '../src/ai/analyst.js';

test('Helius adapter sends JSON-RPC read calls only', async()=>{
  const requests=[];
  const fetchImpl=async(url,opts)=>{
    requests.push({url,body:JSON.parse(opts.body)});
    return new Response(JSON.stringify({jsonrpc:'2.0',id:requests.length,result:987}),{status:200});
  };
  const h=createHeliusReadOnlyAdapter({apiKey:'test-key',fetchImpl});
  assert.equal(await h.getSlot(),987);
  assert.equal(await h.getBalance('wallet'),987);
  assert.equal(requests[0].body.method,'getSlot');
  assert.equal(requests[1].body.method,'getBalance');
  assert.equal(h.readOnly,true);
  assert.equal(h.sendTransaction,undefined);
});

test('OpenRouter is preferred and uses OpenAI-compatible chat completions',async()=>{
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    calls.push({url,headers:opts.headers,body:JSON.parse(opts.body)});
    return new Response(JSON.stringify({choices:[{message:{content:'{"score":81,"recommendation":"watch","risk_flags":[],"summary":"ok","evidence":[],"missing_data":[]}'}}]}),{status:200});
  };
  const provider=createAiProvider({env:{AI_PROVIDER:'openrouter',OPENROUTER_API_KEY:'or-key',
    OPENROUTER_MODEL:'provider/model',OPENAI_API_KEY:'oa-key',OPENAI_MODEL:'gpt-model'},fetchImpl});
  const result=await provider.complete({messages:[{role:'user',content:'test'}]});
  assert.equal(result.provider,'openrouter');
  assert.match(calls[0].url,/openrouter.ai\/api\/v1\/chat\/completions$/);
  assert.equal(calls[0].body.model,'provider/model');
});

test('AI analyst rejects execution authority and filters input fields',async()=>{
  let sent;
  const provider={complete:async(args)=>{sent=args;return {provider:'openrouter',model:'test',
    content:JSON.stringify({score:81,recommendation:'watch',risk_flags:[],summary:'ok',evidence:[],missing_data:[]})};}};
  const analyst=createMarketAnalyst(provider);
  const result=await analyst.analyzePool({poolAddress:'pool',tvlUsd:10,privateKey:'never-send'});
  assert.equal(result.executionAllowed,false);
  assert.equal(JSON.parse(sent.messages[1].content).privateKey,undefined);
});

test('AI analyst rejects malformed or out-of-range model response',async()=>{
  const analyst=createMarketAnalyst({complete:async()=>({provider:'openrouter',model:'x',content:'{"score":999,"recommendation":"watch"}'})});
  await assert.rejects(()=>analyst.analyzePool({}),/score outside/);
});
