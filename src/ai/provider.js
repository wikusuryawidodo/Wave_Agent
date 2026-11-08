import { postJson } from '../providers/http.js';

export function createAiProvider({env=process.env,fetchImpl=fetch}={}) {
  const primary=String(env.AI_PROVIDER ?? 'openrouter').toLowerCase();
  const providers={
    openrouter:{base:env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',key:env.OPENROUTER_API_KEY,model:env.OPENROUTER_MODEL},
    openai:{base:env.OPENAI_BASE_URL || 'https://api.openai.com/v1',key:env.OPENAI_API_KEY,model:env.OPENAI_MODEL}
  };
  const order=primary==='openai'?['openai','openrouter']:['openrouter','openai'];
  async function complete({messages,temperature=0.1,maxTokens=700,jsonMode=true}={}) {
    if(!Array.isArray(messages)||!messages.length)throw new Error('messages are required');
    const errors=[];
    for(const name of order) {
      const p=providers[name];
      if(!p.key||!p.model) {errors.push(`${name}: missing API key or model`);continue;}
      try {
        const body={model:p.model,messages,temperature,max_tokens:maxTokens};
        if(jsonMode) body.response_format={type:'json_object'};
        const headers={authorization:`Bearer ${p.key}`};
        if(name==='openrouter') {
          headers['HTTP-Referer']=env.OPENROUTER_SITE_URL || 'https://localhost';
          headers['X-Title']=env.OPENROUTER_APP_NAME || 'Meridian AI DLMM';
        }
        const result=await postJson(`${p.base.replace(/\/$/,'')}/chat/completions`,body,{headers,fetchImpl});
        const content=result.choices?.[0]?.message?.content;
        if(typeof content!=='string')throw new Error('Provider returned no message content');
        return {provider:name,model:p.model,content,usage:result.usage ?? null};
      } catch(e) { errors.push(`${name}: ${e.message}`); }
    }
    throw new Error(`All configured AI providers failed: ${errors.join(' | ')}`);
  }
  return {primary,available:order.filter(n=>providers[n].key&&providers[n].model),complete};
}
