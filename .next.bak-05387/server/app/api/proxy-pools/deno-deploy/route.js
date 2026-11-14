"use strict";(()=>{var e={};e.id=8822,e.ids=[8822,9112],e.modules={85890:e=>{e.exports=require("better-sqlite3")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},80470:e=>{e.exports=require("sql.js")},67174:e=>{e.exports=require("bun:sqlite")},84770:e=>{e.exports=require("crypto")},17702:e=>{e.exports=require("events")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},6005:e=>{e.exports=require("node:crypto")},87561:e=>{e.exports=require("node:fs")},49411:e=>{e.exports=require("node:path")},55467:e=>{e.exports=require("node:sqlite")},54666:(e,t,o)=>{o.r(t),o.d(t,{originalPathname:()=>h,patchFetch:()=>x,requestAsyncStorage:()=>m,routeModule:()=>c,serverHooks:()=>P,staticGenerationAsyncStorage:()=>g});var r={};o.r(r),o.d(r,{POST:()=>y,dynamic:()=>l});var s=o(49303),a=o(88716),n=o(60670),i=o(87070),d=o(39112);let l="force-dynamic",p="https://api.deno.com/v2",u=`Deno.serve(async (request) => {
  const target = request.headers.get("x-relay-target");
  const relayPath = request.headers.get("x-relay-path") || "/";

  if (!target) {
    return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const targetUrl = target.replace(/\\/$/, "") + relayPath;
  const newHeaders = new Headers(request.headers);
  newHeaders.delete("x-relay-target");
  newHeaders.delete("x-relay-path");
  newHeaders.delete("host");

  const init = {
    method: request.method,
    headers: newHeaders,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  try {
    const response = await fetch(targetUrl, init);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
});`;async function y(e){try{let t=await e.json(),o=t.denoToken?.trim(),r=t.orgDomain?.trim(),s=t.projectName?.trim()||`relay-${Date.now().toString(36)}`;if(!r)return i.NextResponse.json({error:"Organization domain is required"},{status:400});if(!o)return i.NextResponse.json({error:"Deno Deploy API token is required"},{status:400});let a={Authorization:`Bearer ${o}`,"Content-Type":"application/json"},n=await fetch(`${p}/apps`,{method:"POST",headers:a,body:JSON.stringify({slug:s,labels:{"custom.kind":"9router-relay"},config:{install:"deno install",runtime:{type:"dynamic",entrypoint:"main.ts"}}})});if(!n.ok){let e=await n.text().catch(()=>"");if(409===n.status)return i.NextResponse.json({error:`App "${s}" already exists. Choose a different name.`},{status:409});return i.NextResponse.json({error:`Failed to create app (${n.status}): ${e}`},{status:n.status})}let l=await n.json(),y=await fetch(`${p}/apps/${l.id}/deploy`,{method:"POST",headers:a,body:JSON.stringify({assets:{"main.ts":{kind:"file",content:u,encoding:"utf-8"}}})});if(!y.ok){let e=await y.text().catch(()=>"");return console.error("Deno Deploy error:",y.status,e),await fetch(`${p}/apps/${l.id}`,{method:"DELETE",headers:{Authorization:`Bearer ${o}`}}).catch(()=>{}),i.NextResponse.json({error:`Deploy failed (${y.status}): ${e}`},{status:y.status})}let c=await y.json(),m=c.id,g=c.status,P=0;for(;"queued"===g||"building"===g;){if(P>=30)throw Error("Deploy timed out after 60 seconds");await new Promise(e=>setTimeout(e,2e3));let e=await fetch(`${p}/revisions/${m}`,{headers:{Authorization:`Bearer ${o}`}});if(!e.ok)break;g=(await e.json()).status,P++}if("succeeded"!==g)return await fetch(`${p}/apps/${l.id}`,{method:"DELETE",headers:{Authorization:`Bearer ${o}`}}).catch(()=>{}),i.NextResponse.json({error:`Deploy failed with status: ${g}`},{status:500});let h=r.split(".")[0],x=`https://${s}.${h}.deno.net`;console.log("Deno deployUrl:",x);let f=await (0,d.createProxyPool)({name:s,proxyUrl:x,type:"deno",noProxy:"",isActive:!0,strictProxy:!1});return i.NextResponse.json({proxyPool:f,deployUrl:x},{status:201})}catch(e){return console.log("Error deploying Deno Deploy relay:",e),i.NextResponse.json({error:e.message||"Deploy failed"},{status:500})}}let c=new s.AppRouteRouteModule({definition:{kind:a.x.APP_ROUTE,page:"/api/proxy-pools/deno-deploy/route",pathname:"/api/proxy-pools/deno-deploy",filename:"route",bundlePath:"app/api/proxy-pools/deno-deploy/route"},resolvedPagePath:"/opt/aries-router/src/app/api/proxy-pools/deno-deploy/route.js",nextConfigOutput:"standalone",userland:r}),{requestAsyncStorage:m,staticGenerationAsyncStorage:g,serverHooks:P}=c,h="/api/proxy-pools/deno-deploy/route";function x(){return(0,n.patchFetch)({serverHooks:P,staticGenerationAsyncStorage:g})}},39112:(e,t,o)=>{o.r(t),o.d(t,{addCustomModel:()=>r.addCustomModel,createApiKey:()=>r.createApiKey,createCombo:()=>r.createCombo,createProviderConnection:()=>r.createProviderConnection,createProviderNode:()=>r.createProviderNode,createProxyPool:()=>r.createProxyPool,createProxyPools:()=>r.createProxyPools,deleteApiKey:()=>r.deleteApiKey,deleteCombo:()=>r.deleteCombo,deleteCustomModel:()=>r.deleteCustomModel,deleteModelAlias:()=>r.deleteModelAlias,deleteProviderConnection:()=>r.deleteProviderConnection,deleteProviderConnectionsByProvider:()=>r.deleteProviderConnectionsByProvider,deleteProviderNode:()=>r.deleteProviderNode,deleteProxyPool:()=>r.deleteProxyPool,deleteProxyPools:()=>r.deleteProxyPools,getApiKeys:()=>r.getApiKeys,getComboById:()=>r.getComboById,getComboByName:()=>r.getComboByName,getCombos:()=>r.getCombos,getCustomModels:()=>r.getCustomModels,getMitmAlias:()=>r.getMitmAlias,getModelAliases:()=>r.getModelAliases,getProviderConnectionById:()=>r.getProviderConnectionById,getProviderConnections:()=>r.getProviderConnections,getProviderNodeById:()=>r.getProviderNodeById,getProviderNodes:()=>r.getProviderNodes,getProxyPoolById:()=>r.getProxyPoolById,getProxyPools:()=>r.getProxyPools,isCloudEnabled:()=>r.isCloudEnabled,setMitmAliasAll:()=>r.setMitmAliasAll,setModelAlias:()=>r.setModelAlias,updateCombo:()=>r.updateCombo,updateProviderConnection:()=>r.updateProviderConnection,updateProviderNode:()=>r.updateProviderNode,updateProxyPool:()=>r.updateProxyPool,validateApiKey:()=>r.validateApiKey});var r=o(81891)},6468:(e,t,o)=>{o.d(t,{S:()=>s});let r=[];for(let e=0;e<256;++e)r.push((e+256).toString(16).slice(1));function s(e,t=0){return(r[e[t+0]]+r[e[t+1]]+r[e[t+2]]+r[e[t+3]]+"-"+r[e[t+4]]+r[e[t+5]]+"-"+r[e[t+6]]+r[e[t+7]]+"-"+r[e[t+8]]+r[e[t+9]]+"-"+r[e[t+10]]+r[e[t+11]]+r[e[t+12]]+r[e[t+13]]+r[e[t+14]]+r[e[t+15]]).toLowerCase()}},39964:(e,t,o)=>{o.d(t,{Z:()=>d});var r=o(6005);let s={randomUUID:r.randomUUID},a=new Uint8Array(256),n=a.length;var i=o(6468);let d=function(e,t,o){return!s.randomUUID||t||e?function(e,t,o){let s=(e=e||{}).random??e.rng?.()??(n>a.length-16&&((0,r.randomFillSync)(a),n=0),a.slice(n,n+=16));if(s.length<16)throw Error("Random bytes length must be >= 16");if(s[6]=15&s[6]|64,s[8]=63&s[8]|128,t){if((o=o||0)<0||o+16>t.length)throw RangeError(`UUID byte range ${o}:${o+15} is out of buffer bounds`);for(let e=0;e<16;++e)t[o+e]=s[e];return t}return(0,i.S)(s)}(e,t,o):s.randomUUID()}}};var t=require("../../../../webpack-runtime.js");t.C(e);var o=e=>t(t.s=e),r=t.X(0,[8948,5972,1703,3951],()=>o(54666));module.exports=r})();