export async function getJson(url,{headers={},timeoutMs=15000,fetchImpl=fetch}={}) {
  return requestJson(url,{method:'GET',headers,timeoutMs,fetchImpl});
}
export async function postJson(url,body,{headers={},timeoutMs=15000,fetchImpl=fetch}={}) {
  return requestJson(url,{method:'POST',headers,body:JSON.stringify(body),timeoutMs,fetchImpl});
}
async function requestJson(url,{method,headers,body,timeoutMs,fetchImpl}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetchImpl(url,{method,headers:{accept:'application/json',...headers},
      ...(body===undefined?{}:{body}),signal:controller.signal});
    let data, raw='';
    try {
      if(typeof response.text==='function') { raw=await response.text(); data=raw ? JSON.parse(raw) : {}; }
      else if(typeof response.json==='function') data=await response.json();
      else throw new Error('Fetch response has no text/json reader');
    } catch {
      throw new Error(`Expected JSON from ${new URL(url).host}; HTTP ${response.status}`);
    }
    if(!response.ok) throw new Error(`HTTP ${response.status}: ${data?.error?.message ?? data?.message ?? raw.slice(0,300)}`);
    return data;
  } finally { clearTimeout(timer); }
}
