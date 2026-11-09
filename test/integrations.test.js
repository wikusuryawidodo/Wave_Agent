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


import { createGmgnReadOnlyProvider } from '../src/adapters/gmgn-readonly.js';
import { rankGmgnDiscoveryTokens } from '../src/core/gmgn-discovery.js';

test('GMGN adapter fetches trending, signal, trenches and hot-searches through read-only bridge', async () => {
  const calls = [];
  const gmgn = createGmgnReadOnlyProvider({
    apiKey: 'test-key',
    invokeSkill: async (skill, args) => {
      calls.push({ skill, args });
      return { ok: true };
    }
  });
  await gmgn.getTrending('sol', {
    interval: '5m',
    limit: 40,
    orderBy: 'volume',
    filterTags: ['renounced', 'frozen', 'not_wash_trading'],
    filters: { minLiquidity: 50_000, minSmartDegenCount: 1, maxInsiderRate: 0.3, minCreated: '14d' },
    platforms: ['pool_meteora']
  });
  await gmgn.getSignals('sol', { signalTypes: [12, 13, 20], marketCapMin: 250_000, limit: 30 });
  await gmgn.getTrenches('sol', { types: ['completed'], filterPreset: 'safe', sortBy: 'volume_24h' });
  await gmgn.getHotSearches({ chains: ['sol', 'bsc'], interval: '1h', limit: 100 });
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.skill === 'gmgn-market'));
  assert.equal(calls[0].args.action, 'trending');
  assert.equal(calls[0].args.interval, '5m');
  assert.equal(calls[0].args.filters.minLiquidity, 50_000);
  assert.deepEqual(calls[1].args.signalTypes, [12, 13, 20]);
  assert.equal(calls[2].args.action, 'trenches');
  assert.deepEqual(calls[3].args.chains, ['sol', 'bsc']);
});

test('GMGN adapter rejects unsupported intervals, bad filters and invalid signal types', async () => {
  const gmgn = createGmgnReadOnlyProvider({ apiKey: 'test-key', invokeSkill: async () => ({}) });
  await assert.rejects(() => gmgn.getTrending('sol', { interval: '30m' }), /interval is unsupported/);
  await assert.rejects(() => gmgn.getTrending('sol', { filters: { minBogus: 1 } }), /Unsupported/);
  await assert.rejects(() => gmgn.getTrending('sol', { filters: { minCreated: '14' } }), /duration/);
  await assert.rejects(() => gmgn.getTrending('sol', { filterTags: ['not_honeypot'] }), /Unsupported GMGN filter tag/);
  await assert.rejects(() => gmgn.getSignals('sol', { signalTypes: [14] }), /14, 15 and 16/);
  await assert.rejects(() => gmgn.getSignals('base', { signalTypes: [12] }), /signal chain is unsupported/);
});

test('GMGN discovery ranks qualified tokens but blocks rug, wash trading and missing evidence', () => {
  const now = 1_800_000_000_000;
  const mature = {
    address: 'token-good',
    chain: 'sol',
    symbol: 'GOOD',
    exchange: 'meteora_damm_v2',
    launchpad_platform: 'pool_meteora',
    rank: 3,
    creation_timestamp: Math.floor((now - 30 * 86_400_000) / 1000),
    market_cap: 2_000_000,
    liquidity: 400_000,
    volume: 500_000,
    swaps: 5_000,
    buys: 3_000,
    sells: 2_000,
    rug_ratio: 0.05,
    is_wash_trading: false,
    is_honeypot: null,
    top_10_holder_rate: 0.2,
    rat_trader_amount_rate: 0.1,
    bundler_rate: 0.1,
    smart_degen_count: 4,
    renowned_count: 2,
    hot_level: 70,
    price_change_percent: 15
  };
  const risky = { ...mature, address: 'token-rug', rug_ratio: 0.55, is_wash_trading: true };
  const unknown = { ...mature, address: 'token-unknown', rug_ratio: undefined, is_wash_trading: undefined };
  const ranked = rankGmgnDiscoveryTokens([risky, unknown, mature], { now });
  assert.equal(ranked[0].address, 'token-good');
  assert.equal(ranked[0].eligibleForMeteoraPoolLookup, true);
  assert.equal(ranked.find(x => x.address === 'token-rug').eligibleForMeteoraPoolLookup, false);
  assert.equal(ranked.find(x => x.address === 'token-unknown').eligibleForMeteoraPoolLookup, false);
  assert.equal(ranked[0].stage, 'research');
  assert.equal(ranked[0].sellBuyRatio, 2 / 3);
});


import { createGmgnCliReadOnlyProvider } from '../src/adapters/gmgn-cli-readonly.js';

test('GMGN CLI provider checks config once and runs trending and signals as read-only commands', async () => {
  const calls = [];
  const cli = createGmgnCliReadOnlyProvider({
    execFileImpl: async (binary, args) => {
      calls.push({ binary, args });
      if (args[0] === 'config') return { stdout: 'configured' };
      return { stdout: JSON.stringify({ data: { rank: [] } }) };
    }
  });
  await cli.getTrending('sol', {
    interval: '5m',
    limit: 25,
    orderBy: 'volume',
    filterTags: ['renounced', 'frozen'],
    platforms: ['pool_meteora'],
    filters: { minLiquidity: 50_000, minSmartDegenCount: 1, maxInsiderRate: 0.3, minCreated: '14d' }
  });
  await cli.getSignals('sol', { signalTypes: [12, 13, 20], marketCapMin: 250_000 });
  assert.equal(calls.filter(x => x.args[0] === 'config').length, 1);
  assert.equal(calls[1].args[0], 'market');
  assert.ok(calls[1].args.includes('trending'));
  assert.ok(calls[1].args.includes('--min-liquidity'));
  assert.ok(calls[1].args.includes('--max-insider-rate'));
  assert.ok(calls[1].args.includes('--min-created'));
  assert.ok(calls[1].args.includes('--raw'));
  assert.ok(calls[2].args.includes('--signal-type'));
  assert.ok(calls[2].args.includes('--mc-min'));
  assert.equal(cli.readOnly, true);
  assert.equal(cli.swap, undefined);
});

test('GMGN CLI provider surfaces missing CLI config and validates unsafe parameters', async () => {
  const missing = createGmgnCliReadOnlyProvider({
    execFileImpl: async () => { const error = new Error('not configured'); error.stderr = 'API key missing'; throw error; }
  });
  await assert.rejects(() => missing.getTrending('sol'), /configuration check failed.*API key missing/);

  const cli = createGmgnCliReadOnlyProvider({ execFileImpl: async (_binary, args) => ({
    stdout: args[0] === 'config' ? 'configured' : '{"ok":true}'
  }) });
  await assert.rejects(() => cli.getSignals('sol', { signalTypes: [14] }), /do not request 14/);
  await assert.rejects(() => cli.getTrending('sol', { filters: { minCreated: '14' } }), /duration/);
  await assert.rejects(() => cli.getTrending('sol', { interval: '30m' }), /Unsupported trending interval/);
});

