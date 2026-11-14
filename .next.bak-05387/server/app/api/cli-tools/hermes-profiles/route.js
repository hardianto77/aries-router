"use strict";(()=>{var e={};e.id=6768,e.ids=[6768],e.modules={20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},20629:e=>{e.exports=require("fs/promises")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},98601:(e,r,t)=>{t.r(r),t.d(r,{originalPathname:()=>h,patchFetch:()=>f,requestAsyncStorage:()=>c,routeModule:()=>m,serverHooks:()=>$,staticGenerationAsyncStorage:()=>d});var l={};t.r(l),t.d(l,{GET:()=>u,dynamic:()=>p});var a=t(49303),n=t(88716),i=t(60670),o=t(87070),s=t(64032);let p="force-dynamic";async function u(){try{let e=await (0,s.Po)();return o.NextResponse.json({profiles:e})}catch(e){return console.error("Error listing hermes profiles:",e),o.NextResponse.json({error:"Failed to list hermes profiles"},{status:500})}}let m=new a.AppRouteRouteModule({definition:{kind:n.x.APP_ROUTE,page:"/api/cli-tools/hermes-profiles/route",pathname:"/api/cli-tools/hermes-profiles",filename:"route",bundlePath:"app/api/cli-tools/hermes-profiles/route"},resolvedPagePath:"/opt/aries-router/src/app/api/cli-tools/hermes-profiles/route.js",nextConfigOutput:"standalone",userland:l}),{requestAsyncStorage:c,staticGenerationAsyncStorage:d,serverHooks:$}=m,h="/api/cli-tools/hermes-profiles/route";function f(){return(0,i.patchFetch)({serverHooks:$,staticGenerationAsyncStorage:d})}},64032:(e,r,t)=>{t.d(r,{Po:()=>b,iH:()=>f,zc:()=>h});var l=t(20629),a=t.n(l),n=t(55315),i=t.n(n),o=t(19801),s=t.n(o),p=t(67152);let u=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/,m=["config.yaml",".env","SOUL.md","profile.yaml","auth.json","state.db"],c=e=>e||i().join(s().homedir(),".hermes"),d=e=>i().join(c(e),"profiles"),$=e=>"string"==typeof e&&u.test(e)&&"default"!==e.toLowerCase(),h=(e,r)=>{let t=c(r),l="string"==typeof e?e.trim():"";if(!l||"default"===l)return{name:"default",dir:t,configPath:i().join(t,"config.yaml"),envPath:i().join(t,".env"),isDefault:!0};if(!$(l))throw Error("Invalid Hermes profile name (letters, digits, - and _ only, max 64 chars)");let a=i().resolve(d(t)),n=i().resolve(i().join(a,l));if(n!==a&&!n.startsWith(a+i().sep))throw Error("Invalid Hermes profile path");return{name:l,dir:n,configPath:i().join(n,"config.yaml"),envPath:i().join(n,".env"),isDefault:!1}},f=async e=>{try{return(await a().stat(e)).isDirectory()}catch{return!1}},_=async e=>{for(let r of m)try{return await a().stat(i().join(e,r)),!0}catch{}return!1},y=async e=>{try{return await a().readFile(e,"utf-8")}catch(e){if("ENOENT"===e.code)return"";throw e}},g=e=>{let r=e.match(/^display_name:[ \t]*["']?([^"'\r\n]+)["']?/m);return r?r[1].trim():null},v=async(e,r,t)=>{let l=i().join(r,"config.yaml"),a=await y(l),n=(0,p.DK)(a),o=(0,p.ds)(a),s=(0,p.Kr)(a),u=g(await y(i().join(r,"profile.yaml")));return{name:e,dir:r,isDefault:t,displayName:u,command:t?"hermes":`hermes -p ${e}`,alias:t?null:e,model:n?.default||null,baseUrl:n?.base_url||null,hasAries:(0,p._O)(n)||(0,p._O)(o)||Object.values(s).some(p._O)}},b=async e=>{let r=c(e),t=[await v("default",r,!0)],l=[];try{l=await a().readdir(d(r),{withFileTypes:!0})}catch(e){if("ENOENT"!==e.code)throw e;return t}for(let e of l.filter(e=>e.isDirectory()).map(e=>e.name).filter(e=>$(e)).sort((e,r)=>e.localeCompare(r))){let l=i().join(r,"profiles",e);await _(l)&&t.push(await v(e,l,!1))}return t}},67152:(e,r,t)=>{t.d(r,{$e:()=>K,Aq:()=>u,DJ:()=>k,DK:()=>c,J4:()=>s,Kr:()=>y,NL:()=>v,SF:()=>O,_O:()=>x,_t:()=>b,ds:()=>g,fm:()=>E,kH:()=>f,kv:()=>d,mG:()=>h,n1:()=>q,oy:()=>p,ug:()=>_,wg:()=>$});let l=/^model:[ \t]*\r?\n((?:[ \t]+.*\r?\n?|[ \t]*\r?\n)*)/m,a=/^model:[ \t]*[^\r\n]*\r?\n?/m,n=/^delegation:[ \t]*\r?\n((?:[ \t]+.*\r?\n?|[ \t]*\r?\n)*)/m,i=/^auxiliary:[ \t]*\r?\n((?:(?:[ \t]+.*\r?\n?)|(?:[ \t]*\r?\n))*)/m,o=e=>RegExp(`^  ${e}:[ \\t]*\\r?\\n(?:(?:[ \\t]{4,}.*\\r?\\n?)|(?:[ \\t]*\\r?\\n))*`,"m"),s=(e,r)=>`model:
  default: "${e}"
  provider: "custom"
  base_url: "${r}"
  api_key: \${OPENAI_API_KEY}
`,p=(e,r)=>`delegation:
  model: "${e}"
  provider: "custom"
  base_url: "${r}"
  api_key: \${OPENAI_API_KEY}
`,u=(e,r,t)=>`  ${e}:
    provider: "custom"
    model: "${r}"
    base_url: "${t}"
    api_key: \${OPENAI_API_KEY}
`,m=e=>r=>{let t=e.match(RegExp(`^[ \\t]+${r}:[ \\t]*["']?([^"'\\r\\n]+)["']?`,"m"));return t?t[1].trim():null},c=e=>{let r=e.match(l);if(!r)return null;let t=m(r[1]||"");return{default:t("default"),provider:t("provider"),base_url:t("base_url"),api_key:t("api_key")}},d=(e,r)=>l.test(e)?e.replace(l,r):a.test(e)?e.replace(a,r):e.length>0?`${r}
${e}`:r,$=(e,r)=>n.test(e)?e.replace(n,r):e.endsWith("\n")||0===e.length?`${e}${r}`:`${e}
${r}`,h=e=>e.replace(n,""),f=(e,r,t)=>{let l=o(r),a=e.match(i);if(!a){let r=`auxiliary:
${t}`;return e.endsWith("\n")||0===e.length?`${e}${r}`:`${e}
${r}`}let n=l.test(a[1])?a[1].replace(l,t):`${a[1]}${t}`;return e.replace(i,`auxiliary:
${n}`)},_=(e,r)=>{let t=e.match(i);if(!t)return e;let l=t[1].replace(o(r),"");return""===l.trim()?e.replace(i,""):e.replace(i,`auxiliary:
${l}`)},y=e=>{let r;let t=e.match(i);if(!t)return{};let l={},a=/^  ([A-Za-z0-9_]+):[ \t]*\r?\n((?:(?:[ \t]{4,}.*\r?\n?)|(?:[ \t]*\r?\n))*)/gm;for(;r=a.exec(t[1]);){let e=m(r[2]);l[r[1]]={model:e("model"),provider:e("provider"),base_url:e("base_url")}}return l},g=e=>{let r=e.match(n);if(!r)return null;let t=m(r[1]||"");return{model:t("model"),provider:t("provider"),base_url:t("base_url")}},v=e=>l.test(e)?e.replace(l,"").replace(/^\n+/,""):a.test(e)?e.replace(a,"").replace(/^\n+/,""):e,b=(e,r,t)=>{let l=RegExp(`^${r}=.*$`,"m"),a=`${r}=${t}`;return l.test(e)?e.replace(l,a):e.length>0&&!e.endsWith("\n")?`${e}
${a}
`:`${e}${a}
`},x=e=>!!e?.base_url&&"custom"===e.provider&&/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(e.base_url),E=e=>e?.provider==="custom",P=/^stt:[ \t]*\r?\n((?:[ \t]+.*\r?\n?|[ \t]*\r?\n)*)/m,j=e=>RegExp(`^  ${e}:[ \\t]*\\r?\\n((?:(?:[ \\t]{4,}.*\\r?\\n?)|(?:[ \\t]*\\r?\\n))*)`,"m"),w="${OPENAI_API_KEY}",A=e=>e.replace(/^[ \t]*["']|["'][ \t]*$/g,"").trim(),k=e=>{let r=e.match(P);if(!r)return null;let t=(r[1]||"").split(/\r?\n/),l={},a={},n=null;for(let e of t)if(/^  \S/.test(e)){let r=e.match(/^  ([A-Za-z0-9_]+):[ \t]*(.*)$/);n=null,r&&""!==r[2]?l[r[1]]=A(r[2]):r&&(n=r[1])}else if("openai"===n&&/^ {4,}\S/.test(e)){let r=e.match(/^ {4,}([A-Za-z0-9_]+):[ \t]*(.*)$/);r&&""!==r[2]&&(a[r[1]]=A(r[2]))}return{enabled:l.enabled??null,provider:l.provider??null,model:a.model??null,base_url:a.base_url??null,api_key:a.api_key??null}},O=e=>e?.provider==="openai"&&!!e?.base_url&&e?.api_key===w,R=(e,r)=>`stt:
  enabled: true
  provider: "openai"
  openai:
    model: "${e}"
    base_url: "${r}"
    api_key: ${w}
`,N=(e,r,t)=>{let l=RegExp(`^  ${r}:[^\\r\\n]*`,"m");if(l.test(e))return e.replace(l,`  ${r}: ${t}`);let a=`  ${r}: ${t}
`;return e.length>0&&!e.endsWith("\n")?`${e}
${a}`:`${e}${a}`},I=(e,r,t)=>{let l=e.match(j("openai"));if(!l){let l=`  openai:
    ${r}: ${t}
`;return e.length>0&&!e.endsWith("\n")?`${e}
${l}`:`${e}${l}`}let a=RegExp(`^ {4}${r}:[^\\r\\n]*`,"m"),n=a.test(l[1])?l[1].replace(a,`    ${r}: ${t}`):l[1].endsWith("\n")||0===l[1].length?`${l[1]}    ${r}: ${t}
`:`${l[1]}
    ${r}: ${t}
`;return e.replace(j("openai"),`  openai:
${n}`)},q=(e,r,t)=>{let l=e.match(P)?.[1]??null;if(null===l){let l=0===e.length?"":e.endsWith("\n")?e:`${e}
`;return`${l}${R(r,t)}`}return l=N(l,"enabled","true"),l=I(l=N(l,"provider",'"openai"'),"model",`"${r}"`),l=I(l,"base_url",`"${t}"`),l=I(l,"api_key",w),e.replace(P,`stt:
${l}`)},K=e=>{let r=e.match(P);if(!r)return e;let t=r[1]||"",l=(t=(t=t.replace(/^  enabled:[ \t]*["']?true["']?[ \t]*\r?\n?/m,"")).replace(/^  provider:[ \t]*["']?openai["']?[ \t]*\r?\n?/m,"")).match(j("openai"));if(l){let e=l[1]||"";for(let r of["model","base_url","api_key"])e=e.replace(RegExp(`^ {4}${r}:[^\\r\\n]*\\r?\\n?`,"m"),"");t=t.replace(j("openai"),""===e.trim()?"":`  openai:
${e}`)}return""===t.trim()?e.replace(P,"").replace(/^\n+/,""):e.replace(P,`stt:
${t}`)}}};var r=require("../../../../webpack-runtime.js");r.C(e);var t=e=>r(r.s=e),l=r.X(0,[8948,5972],()=>t(98601));module.exports=l})();