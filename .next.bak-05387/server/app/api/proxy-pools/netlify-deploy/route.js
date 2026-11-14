"use strict";(()=>{var e={};e.id=766,e.ids=[766,9112],e.modules={85890:e=>{e.exports=require("better-sqlite3")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},80470:e=>{e.exports=require("sql.js")},67174:e=>{e.exports=require("bun:sqlite")},84770:e=>{e.exports=require("crypto")},17702:e=>{e.exports=require("events")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},6005:e=>{e.exports=require("node:crypto")},87561:e=>{e.exports=require("node:fs")},49411:e=>{e.exports=require("node:path")},55467:e=>{e.exports=require("node:sqlite")},5040:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>U,patchFetch:()=>A,requestAsyncStorage:()=>w,routeModule:()=>v,serverHooks:()=>C,staticGenerationAsyncStorage:()=>b});var o={};r.r(o),r.d(o,{POST:()=>P,dynamic:()=>g});var n=r(49303),s=r(88716),a=r(60670),i=r(87070),d=r(39112),l=r(6005);let u="https://api.netlify.com/api/v1",f="relay",y=`exports.handler = async (event) => {
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) {
    headers[k.toLowerCase()] = v;
  }

  const target = headers["x-relay-target"];
  const relayPath = headers["x-relay-path"] || "/";

  if (!target) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Missing x-relay-target header" }),
    };
  }

  const targetUrl = target.replace(/\\/$/, "") + relayPath;
  const forwardHeaders = { ...event.headers };
  for (const k of Object.keys(forwardHeaders)) {
    const lower = k.toLowerCase();
    if (lower === "x-relay-target" || lower === "x-relay-path" || lower === "host") {
      delete forwardHeaders[k];
    }
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: forwardHeaders,
      body: event.httpMethod !== "GET" && event.httpMethod !== "HEAD" && event.body
        ? event.isBase64Encoded
          ? Buffer.from(event.body, "base64")
          : event.body
        : undefined,
    });
    // Lambda response body must be a string: returning the stream object
    // fails with cannot-unmarshal-object-into-Go-struct-field (live 502).
    // So buffer here: text for API payloads (JSON/SSE), base64 for binary.
    // Tradeoff vs the other relays: SSE arrives buffered, stays valid SSE.
    const responseHeaders = {};
    upstream.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    const contentType = upstream.headers.get("content-type") || "";
    const isText = new RegExp("^(text/|[^;]*json|[^;]*event-stream|[^;]*javascript|[^;]*xml|[^;]*urlencoded)", "i").test(contentType);
    const rawBody = await upstream.arrayBuffer();
    const responseBody = isText
      ? Buffer.from(rawBody).toString("utf8")
      : Buffer.from(rawBody).toString("base64");
    return {
      statusCode: upstream.status,
      headers: responseHeaders,
      body: responseBody,
      isBase64Encoded: !isText,
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: error.message || "Relay fetch failed" }),
    };
  }
};
`,p=`<!doctype html>
<html><head><meta charset="utf-8"><title>Aries Relay</title></head>
<body><p>Aries relay function lives at <code>/.netlify/functions/relay</code>.</p></body></html>
`,c=(()=>{let e=new Uint32Array(256);for(let t=0;t<256;t+=1){let r=t;for(let e=0;e<8;e+=1)r=1&r?3988292384^r>>>1:r>>>1;e[t]=r>>>0}return e})();function h(e){return{Authorization:`Bearer ${e}`,"User-Agent":"Aries"}}async function m(e,t,r=fetch,o=12e4,n=3e3){let s=Date.now();for(;;){let a=await r(`${u}/deploys/${e}`,{headers:h(t)}),i=await a.json().catch(()=>({}));if("ready"===i.state)return i;if("error"===i.state)throw Error(i.error_message||"Netlify deploy failed");if(Date.now()-s>o)throw Error("Netlify deploy timed out");await new Promise(e=>setTimeout(e,n))}}let g="force-dynamic";async function x(e,t){let r=await e.json().catch(()=>({}));return r.message||r.error||t}async function P(e){try{let t=await e.json(),r=t.netlifyToken?.trim?.()??t.netlifyToken,o=function(e){let t="string"==typeof e?e.trim().toLowerCase():"";return t&&t.replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"")||`relay-${Date.now().toString(36)}`}(t.projectName??t.siteName);if(!r)return i.NextResponse.json({error:"Netlify API token is required"},{status:400});let n={...h(r),"Content-Type":"application/json"},s=await fetch(`${u}/sites`,{method:"POST",headers:n,body:JSON.stringify({name:o})});if(!s.ok){let e=await x(s,"Failed to create Netlify site"),t=422===s.status?409:s.status,r=422===s.status?` Site name "${o}" is taken — choose a different name.`:"";return i.NextResponse.json({error:`${e}.${r}`},{status:t})}let a=await s.json(),g=a.id||a.site_id,P=a.ssl_url||a.url;if(!g||!P)return i.NextResponse.json({error:"Netlify site created but no site URL returned"},{status:502});let{zip:v,sha256:w}=function(){let e=function(e){let t=new TextEncoder,r=[],o=[],n=0;for(let{name:s,data:a}of e){let e=t.encode(s),i=a instanceof Uint8Array?a:t.encode(String(a??"")),d=function(e){let t=4294967295;for(let r=0;r<e.length;r+=1)t=c[(t^e[r])&255]^t>>>8;return(4294967295^t)>>>0}(i),l=new DataView(new ArrayBuffer(30));l.setUint32(0,67324752,!0),l.setUint16(4,20,!0),l.setUint16(6,2048,!0),l.setUint16(8,0,!0),l.setUint32(14,d,!0),l.setUint32(18,i.length,!0),l.setUint32(22,i.length,!0),l.setUint16(26,e.length,!0),r.push(Buffer.from(l.buffer),Buffer.from(e),Buffer.from(i));let u=new DataView(new ArrayBuffer(46));u.setUint32(0,33639248,!0),u.setUint16(8,2048,!0),u.setUint16(10,0,!0),u.setUint32(16,d,!0),u.setUint32(20,i.length,!0),u.setUint32(24,i.length,!0),u.setUint16(28,e.length,!0),u.setUint32(42,n,!0),o.push(Buffer.from(u.buffer),Buffer.from(e)),n+=30+e.length+i.length}let s=n,a=o.reduce((e,t)=>e+t.length,0),i=new DataView(new ArrayBuffer(22));return i.setUint32(0,101010256,!0),i.setUint16(8,e.length,!0),i.setUint16(10,e.length,!0),i.setUint32(12,a,!0),i.setUint32(16,s,!0),Buffer.concat([...r,...o,Buffer.from(i.buffer)])}([{name:`${f}.js`,data:new TextEncoder().encode(y)}]);return{zip:e,sha256:(0,l.createHash)("sha256").update(e).digest("hex")}}(),{content:b,sha1:C}=function(){let e=new TextEncoder().encode(p);return{content:e,sha1:(0,l.createHash)("sha1").update(e).digest("hex")}}(),U=await fetch(`${u}/sites/${g}/deploys`,{method:"POST",headers:n,body:JSON.stringify({files:{"/index.html":C},functions:{[f]:w}})});if(!U.ok)return i.NextResponse.json({error:await x(U,"Failed to create Netlify deploy")},{status:U.status});let A=await U.json(),N=A.id;if(!N)return i.NextResponse.json({error:"Netlify deploy created but no deploy ID returned"},{status:502});let B=new Set(A.required||[]),j=new Set(A.required_functions||[]);if(B.has(C)){let e=await fetch(`${u}/deploys/${N}/files/index.html`,{method:"PUT",headers:{...h(r),"Content-Type":"application/octet-stream"},body:Buffer.from(b)});if(!e.ok)return i.NextResponse.json({error:await x(e,"Failed to upload site file to Netlify")},{status:e.status})}if(j.has(w)){let e=await fetch(`${u}/deploys/${N}/functions/${f}?runtime=js`,{method:"PUT",headers:{...h(r),"Content-Type":"application/octet-stream"},body:v});if(!e.ok)return i.NextResponse.json({error:await x(e,"Failed to upload relay function to Netlify")},{status:e.status})}await m(N,r);let S=`${String(P||"").replace(/\/$/,"")}/.netlify/functions/relay`,q=await (0,d.createProxyPool)({name:o,proxyUrl:S,type:"netlify",noProxy:"",isActive:!0,strictProxy:!1});return i.NextResponse.json({proxyPool:q,deployUrl:S},{status:201})}catch(e){return console.log("Error deploying Netlify relay:",e),i.NextResponse.json({error:e.message||"Deploy failed"},{status:500})}}let v=new n.AppRouteRouteModule({definition:{kind:s.x.APP_ROUTE,page:"/api/proxy-pools/netlify-deploy/route",pathname:"/api/proxy-pools/netlify-deploy",filename:"route",bundlePath:"app/api/proxy-pools/netlify-deploy/route"},resolvedPagePath:"/opt/aries-router/src/app/api/proxy-pools/netlify-deploy/route.js",nextConfigOutput:"standalone",userland:o}),{requestAsyncStorage:w,staticGenerationAsyncStorage:b,serverHooks:C}=v,U="/api/proxy-pools/netlify-deploy/route";function A(){return(0,a.patchFetch)({serverHooks:C,staticGenerationAsyncStorage:b})}},39112:(e,t,r)=>{r.r(t),r.d(t,{addCustomModel:()=>o.addCustomModel,createApiKey:()=>o.createApiKey,createCombo:()=>o.createCombo,createProviderConnection:()=>o.createProviderConnection,createProviderNode:()=>o.createProviderNode,createProxyPool:()=>o.createProxyPool,createProxyPools:()=>o.createProxyPools,deleteApiKey:()=>o.deleteApiKey,deleteCombo:()=>o.deleteCombo,deleteCustomModel:()=>o.deleteCustomModel,deleteModelAlias:()=>o.deleteModelAlias,deleteProviderConnection:()=>o.deleteProviderConnection,deleteProviderConnectionsByProvider:()=>o.deleteProviderConnectionsByProvider,deleteProviderNode:()=>o.deleteProviderNode,deleteProxyPool:()=>o.deleteProxyPool,deleteProxyPools:()=>o.deleteProxyPools,getApiKeys:()=>o.getApiKeys,getComboById:()=>o.getComboById,getComboByName:()=>o.getComboByName,getCombos:()=>o.getCombos,getCustomModels:()=>o.getCustomModels,getMitmAlias:()=>o.getMitmAlias,getModelAliases:()=>o.getModelAliases,getProviderConnectionById:()=>o.getProviderConnectionById,getProviderConnections:()=>o.getProviderConnections,getProviderNodeById:()=>o.getProviderNodeById,getProviderNodes:()=>o.getProviderNodes,getProxyPoolById:()=>o.getProxyPoolById,getProxyPools:()=>o.getProxyPools,isCloudEnabled:()=>o.isCloudEnabled,setMitmAliasAll:()=>o.setMitmAliasAll,setModelAlias:()=>o.setModelAlias,updateCombo:()=>o.updateCombo,updateProviderConnection:()=>o.updateProviderConnection,updateProviderNode:()=>o.updateProviderNode,updateProxyPool:()=>o.updateProxyPool,validateApiKey:()=>o.validateApiKey});var o=r(81891)},6468:(e,t,r)=>{r.d(t,{S:()=>n});let o=[];for(let e=0;e<256;++e)o.push((e+256).toString(16).slice(1));function n(e,t=0){return(o[e[t+0]]+o[e[t+1]]+o[e[t+2]]+o[e[t+3]]+"-"+o[e[t+4]]+o[e[t+5]]+"-"+o[e[t+6]]+o[e[t+7]]+"-"+o[e[t+8]]+o[e[t+9]]+"-"+o[e[t+10]]+o[e[t+11]]+o[e[t+12]]+o[e[t+13]]+o[e[t+14]]+o[e[t+15]]).toLowerCase()}},39964:(e,t,r)=>{r.d(t,{Z:()=>d});var o=r(6005);let n={randomUUID:o.randomUUID},s=new Uint8Array(256),a=s.length;var i=r(6468);let d=function(e,t,r){return!n.randomUUID||t||e?function(e,t,r){let n=(e=e||{}).random??e.rng?.()??(a>s.length-16&&((0,o.randomFillSync)(s),a=0),s.slice(a,a+=16));if(n.length<16)throw Error("Random bytes length must be >= 16");if(n[6]=15&n[6]|64,n[8]=63&n[8]|128,t){if((r=r||0)<0||r+16>t.length)throw RangeError(`UUID byte range ${r}:${r+15} is out of buffer bounds`);for(let e=0;e<16;++e)t[r+e]=n[e];return t}return(0,i.S)(n)}(e,t,r):n.randomUUID()}}};var t=require("../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),o=t.X(0,[8948,5972,1703,3951],()=>r(5040));module.exports=o})();