"use strict";(()=>{var e={};e.id=7142,e.ids=[7142,9112],e.modules={85890:e=>{e.exports=require("better-sqlite3")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},80470:e=>{e.exports=require("sql.js")},67174:e=>{e.exports=require("bun:sqlite")},84770:e=>{e.exports=require("crypto")},17702:e=>{e.exports=require("events")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},6005:e=>{e.exports=require("node:crypto")},87561:e=>{e.exports=require("node:fs")},49411:e=>{e.exports=require("node:path")},55467:e=>{e.exports=require("node:sqlite")},57622:(e,o,t)=>{t.r(o),t.d(o,{originalPathname:()=>g,patchFetch:()=>h,requestAsyncStorage:()=>y,routeModule:()=>c,serverHooks:()=>P,staticGenerationAsyncStorage:()=>m});var r={};t.r(r),t.d(r,{POST:()=>p,dynamic:()=>l});var a=t(49303),s=t(88716),n=t(60670),d=t(87070),i=t(39112);let l="force-dynamic",u=`
export default {
  async fetch(request, env, ctx) {
    const target = request.headers.get("x-relay-target");
    const relayPath = request.headers.get("x-relay-path") || "/";
    
    if (!target) {
      return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const targetUrl = target.replace(/\\/$/, "") + relayPath;
    const newRequestInit = {
      method: request.method,
      headers: new Headers(request.headers),
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      newRequestInit.body = request.body;
      newRequestInit.duplex = "half";
    }

    newRequestInit.headers.delete("x-relay-target");
    newRequestInit.headers.delete("x-relay-path");
    newRequestInit.headers.delete("host");

    try {
      const response = await fetch(targetUrl, newRequestInit);
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
  },
};
`;async function p(e){try{let o=await e.json(),t=o.accountId?.trim(),r=o.apiToken?.trim(),a=o.projectName?.trim()||`relay-${Date.now().toString(36)}`;if(!t||!r)return d.NextResponse.json({error:"Cloudflare Account ID and API Token are required"},{status:400});let s=`https://api.cloudflare.com/client/v4/accounts/${t}/workers/scripts/${a}`,n=new FormData;n.append("index.js",new Blob([u],{type:"application/javascript+module"}),"index.js"),n.append("metadata",new Blob([JSON.stringify({main_module:"index.js",compatibility_date:"2024-03-20",observability:{enabled:!0}})],{type:"application/json"}),"metadata.json");let l=await fetch(s,{method:"PUT",headers:{Authorization:`Bearer ${r}`},body:n});if(!l.ok){let e=await l.json().catch(()=>({}));return console.error("Cloudflare upload error:",e),d.NextResponse.json({error:e.errors?.[0]?.message||"Failed to upload Worker to Cloudflare"},{status:l.status})}let p=await fetch(`${s}/subdomain`,{method:"POST",headers:{Authorization:`Bearer ${r}`,"Content-Type":"application/json"},body:JSON.stringify({enabled:!0})});if(!p.ok){let e=await p.json().catch(()=>({}));console.error("Cloudflare subdomain enable error:",e)}let c="",y=await fetch(`https://api.cloudflare.com/client/v4/accounts/${t}/workers/subdomain`,{method:"GET",headers:{Authorization:`Bearer ${r}`,"Content-Type":"application/json"}});if(y.ok){let e=await y.json();e.result&&e.result.subdomain&&(c=`https://${a}.${e.result.subdomain}.workers.dev`)}if(!c)return d.NextResponse.json({error:"Worker deployed but failed to retrieve workers.dev subdomain. Make sure you have setup a workers.dev subdomain in Cloudflare Dashboard."},{status:400});let m=await (0,i.createProxyPool)({name:a,proxyUrl:c,type:"cloudflare",noProxy:"",isActive:!0,strictProxy:!1});return d.NextResponse.json({proxyPool:m,deployUrl:c},{status:201})}catch(e){return console.log("Error deploying Cloudflare relay:",e),d.NextResponse.json({error:e.message||"Deploy failed"},{status:500})}}let c=new a.AppRouteRouteModule({definition:{kind:s.x.APP_ROUTE,page:"/api/proxy-pools/cloudflare-deploy/route",pathname:"/api/proxy-pools/cloudflare-deploy",filename:"route",bundlePath:"app/api/proxy-pools/cloudflare-deploy/route"},resolvedPagePath:"/opt/aries-router/src/app/api/proxy-pools/cloudflare-deploy/route.js",nextConfigOutput:"standalone",userland:r}),{requestAsyncStorage:y,staticGenerationAsyncStorage:m,serverHooks:P}=c,g="/api/proxy-pools/cloudflare-deploy/route";function h(){return(0,n.patchFetch)({serverHooks:P,staticGenerationAsyncStorage:m})}},39112:(e,o,t)=>{t.r(o),t.d(o,{addCustomModel:()=>r.addCustomModel,createApiKey:()=>r.createApiKey,createCombo:()=>r.createCombo,createProviderConnection:()=>r.createProviderConnection,createProviderNode:()=>r.createProviderNode,createProxyPool:()=>r.createProxyPool,createProxyPools:()=>r.createProxyPools,deleteApiKey:()=>r.deleteApiKey,deleteCombo:()=>r.deleteCombo,deleteCustomModel:()=>r.deleteCustomModel,deleteModelAlias:()=>r.deleteModelAlias,deleteProviderConnection:()=>r.deleteProviderConnection,deleteProviderConnectionsByProvider:()=>r.deleteProviderConnectionsByProvider,deleteProviderNode:()=>r.deleteProviderNode,deleteProxyPool:()=>r.deleteProxyPool,deleteProxyPools:()=>r.deleteProxyPools,getApiKeys:()=>r.getApiKeys,getComboById:()=>r.getComboById,getComboByName:()=>r.getComboByName,getCombos:()=>r.getCombos,getCustomModels:()=>r.getCustomModels,getMitmAlias:()=>r.getMitmAlias,getModelAliases:()=>r.getModelAliases,getProviderConnectionById:()=>r.getProviderConnectionById,getProviderConnections:()=>r.getProviderConnections,getProviderNodeById:()=>r.getProviderNodeById,getProviderNodes:()=>r.getProviderNodes,getProxyPoolById:()=>r.getProxyPoolById,getProxyPools:()=>r.getProxyPools,isCloudEnabled:()=>r.isCloudEnabled,setMitmAliasAll:()=>r.setMitmAliasAll,setModelAlias:()=>r.setModelAlias,updateCombo:()=>r.updateCombo,updateProviderConnection:()=>r.updateProviderConnection,updateProviderNode:()=>r.updateProviderNode,updateProxyPool:()=>r.updateProxyPool,validateApiKey:()=>r.validateApiKey});var r=t(81891)},6468:(e,o,t)=>{t.d(o,{S:()=>a});let r=[];for(let e=0;e<256;++e)r.push((e+256).toString(16).slice(1));function a(e,o=0){return(r[e[o+0]]+r[e[o+1]]+r[e[o+2]]+r[e[o+3]]+"-"+r[e[o+4]]+r[e[o+5]]+"-"+r[e[o+6]]+r[e[o+7]]+"-"+r[e[o+8]]+r[e[o+9]]+"-"+r[e[o+10]]+r[e[o+11]]+r[e[o+12]]+r[e[o+13]]+r[e[o+14]]+r[e[o+15]]).toLowerCase()}},39964:(e,o,t)=>{t.d(o,{Z:()=>i});var r=t(6005);let a={randomUUID:r.randomUUID},s=new Uint8Array(256),n=s.length;var d=t(6468);let i=function(e,o,t){return!a.randomUUID||o||e?function(e,o,t){let a=(e=e||{}).random??e.rng?.()??(n>s.length-16&&((0,r.randomFillSync)(s),n=0),s.slice(n,n+=16));if(a.length<16)throw Error("Random bytes length must be >= 16");if(a[6]=15&a[6]|64,a[8]=63&a[8]|128,o){if((t=t||0)<0||t+16>o.length)throw RangeError(`UUID byte range ${t}:${t+15} is out of buffer bounds`);for(let e=0;e<16;++e)o[t+e]=a[e];return o}return(0,d.S)(a)}(e,o,t):a.randomUUID()}}};var o=require("../../../../webpack-runtime.js");o.C(e);var t=e=>o(o.s=e),r=o.X(0,[8948,5972,1703,3951],()=>t(57622));module.exports=r})();