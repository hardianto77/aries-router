"use strict";(()=>{var e={};e.id=3864,e.ids=[3864],e.modules={85890:e=>{e.exports=require("better-sqlite3")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},80470:e=>{e.exports=require("sql.js")},67174:e=>{e.exports=require("bun:sqlite")},84770:e=>{e.exports=require("crypto")},17702:e=>{e.exports=require("events")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},6005:e=>{e.exports=require("node:crypto")},87561:e=>{e.exports=require("node:fs")},49411:e=>{e.exports=require("node:path")},55467:e=>{e.exports=require("node:sqlite")},79995:(e,t,o)=>{o.r(t),o.d(t,{originalPathname:()=>g,patchFetch:()=>b,requestAsyncStorage:()=>l,routeModule:()=>p,serverHooks:()=>u,staticGenerationAsyncStorage:()=>c});var n={};o.r(n),o.d(n,{GET:()=>d});var r=o(49303),a=o(88716),i=o(60670),s=o(32584);async function d(e,{params:t}){let{connectionId:o}=t,n=null;if(o&&"undefined"!==o&&"null"!==o&&"default"!==o&&(n=await (0,s.gI)(o)),!n){let e=await (0,s.cq)();n=e.find(e=>"glm"===e.provider&&e.providerSpecificData?.zcodeJwtToken)||e.find(e=>"glm"===e.provider)||e.find(e=>"zcode"===e.provider||"zc"===e.provider)||null}if(!n)return new Response('<!DOCTYPE html><html><body style="background:#0b0f17;color:#fff;font-family:sans-serif;padding:40px;text-align:center;"><h2>Connection Not Found</h2><p>GLM connection ID is invalid or was removed.</p></body></html>',{status:404,headers:{"Content-Type":"text/html; charset=utf-8"}});let r=String(n.email||n.name||"GLM Account").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"),a=n.providerSpecificData?.zcodeJwtToken||n.providerSpecificData?.zaiBusinessToken||"",i=n.accessToken||n.apiKey||n.providerSpecificData?.zaiBusinessToken||"",d=`localStorage.setItem('zcodejwttoken', '${a}');
localStorage.setItem('oauth:zai:access_token', '${i}');
localStorage.setItem('oauth:active_provider', 'zai');
location.reload();`;return new Response(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ZCode Web Claim Launcher - ${r}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0B0F17;
      color: #E2E8F0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px 16px;
    }
    .card {
      width: 100%;
      max-width: 500px;
      background: #151D2C;
      border: 1px solid #233045;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .header {
      margin-bottom: 18px;
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 3px 8px;
      background: rgba(59, 130, 246, 0.15);
      color: #60A5FA;
      border-radius: 6px;
      margin-bottom: 6px;
    }
    h1 {
      font-size: 18px;
      font-weight: 700;
      color: #F8FAFC;
    }
    .account {
      font-size: 12px;
      color: #94A3B8;
      margin-top: 2px;
      font-family: monospace;
    }
    .alert-box {
      font-size: 12px;
      color: #CBD5E1;
      line-height: 1.5;
      margin-bottom: 18px;
      background: rgba(59, 130, 246, 0.08);
      border-left: 3px solid #3B82F6;
      padding: 10px 12px;
      border-radius: 4px;
    }
    .step-box {
      background: #0F1622;
      border: 1px solid #233045;
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 14px;
    }
    .step-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .step-num {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #2563EB;
      color: #FFF;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      shrink: 0;
    }
    .step-title {
      font-size: 13px;
      font-weight: 600;
      color: #F1F5F9;
    }
    .step-desc {
      font-size: 12px;
      color: #94A3B8;
      line-height: 1.4;
      margin-bottom: 10px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease;
      border: none;
    }
    .btn-primary {
      background: #2563EB;
      color: #FFF;
    }
    .btn-primary:hover {
      background: #1D4ED8;
    }
    .btn-green {
      background: #059669;
      color: #FFF;
    }
    .btn-green:hover {
      background: #047857;
    }
    .btn-secondary {
      background: #1E293B;
      color: #E2E8F0;
      border: 1px solid #334155;
    }
    .btn-secondary:hover {
      background: #334155;
    }
    .divider {
      text-align: center;
      font-size: 11px;
      color: #64748B;
      margin: 16px 0 12px;
      position: relative;
    }
    .divider::before, .divider::after {
      content: "";
      position: absolute;
      top: 50%;
      width: 38%;
      height: 1px;
      background: #233045;
    }
    .divider::before { left: 0; }
    .divider::after { right: 0; }
    .toast {
      font-size: 11px;
      color: #10B981;
      text-align: center;
      margin-top: 6px;
      min-height: 16px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <span class="badge">ZCode Web Claim</span>
      <h1>Klaim Voucher ZCode di Browser</h1>
      <div class="account">${r}</div>
    </div>

    <div class="alert-box">
      The ZCode Rewards page requires a browser login session. Follow the 2 steps below to open it directly:
    </div>

    <!-- Step 1 -->
    <div class="step-box">
      <div class="step-header">
        <span class="step-num">1</span>
        <span class="step-title">Login ke ZCode (Satu Kali)</span>
      </div>
      <p class="step-desc">
        Buka halaman login ZCode di bawah, lalu klik tombol <b>"Continue with Z.ai"</b> menggunakan akun yang sama:
      </p>
      <a href="https://zcode.z.ai/en/login" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
        Buka Login ZCode Web
      </a>
    </div>

    <!-- Step 2 -->
    <div class="step-box">
      <div class="step-header">
        <span class="step-num">2</span>
        <span class="step-title">Buka Halaman Rewards & Voucher</span>
      </div>
      <p class="step-desc">
        Setelah login di Langkah 1 selesai, buka halaman Rewards. Popup tiket 500M / reward task akan langsung muncul dan siap diklaim:
      </p>
      <a href="https://zcode.z.ai/en/rewards?embedded=app&theme=zai-dark" target="_blank" rel="noopener noreferrer" class="btn btn-green">
        Buka Halaman Rewards & Voucher 500M
      </a>
    </div>

    <div class="divider">PENGGUNA PC / LAPTOP</div>

    <div style="background:#0F1622;border:1px solid #233045;border-radius:10px;padding:12px;">
      <p style="font-size:11px;color:#94A3B8;margin-bottom:8px;">
        On a PC/laptop, you can skip the login by pasting the token script into the Console (F12):
      </p>
      <button type="button" class="btn btn-secondary" onclick="copyConsoleSnippet()">
        Salin Script Console (F12)
      </button>
      <div class="toast" id="toastMsg"></div>
    </div>
  </div>

  <script>
    const consoleSnippet = ${JSON.stringify(d)};

    function copyConsoleSnippet() {
      navigator.clipboard.writeText(consoleSnippet).then(() => {
        showToast("Script Console disalin! Buka tab ZCode, tekan F12 -> Console -> Paste & Enter.");
      }).catch(() => {
        fallbackCopy(consoleSnippet);
      });
    }

    function showToast(msg) {
      const el = document.getElementById("toastMsg");
      el.textContent = msg;
      setTimeout(() => { el.textContent = ""; }, 4000);
    }

    function fallbackCopy(text) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("Berhasil disalin ke clipboard!");
    }
  </script>
</body>
</html>`,{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store, no-cache, must-revalidate"}})}let p=new r.AppRouteRouteModule({definition:{kind:a.x.APP_ROUTE,page:"/api/usage/[connectionId]/zcode-bridge/route",pathname:"/api/usage/[connectionId]/zcode-bridge",filename:"route",bundlePath:"app/api/usage/[connectionId]/zcode-bridge/route"},resolvedPagePath:"/opt/aries-router/src/app/api/usage/[connectionId]/zcode-bridge/route.js",nextConfigOutput:"standalone",userland:n}),{requestAsyncStorage:l,staticGenerationAsyncStorage:c,serverHooks:u}=p,g="/api/usage/[connectionId]/zcode-bridge/route";function b(){return(0,i.patchFetch)({serverHooks:u,staticGenerationAsyncStorage:c})}},49303:(e,t,o)=>{e.exports=o(30517)},6468:(e,t,o)=>{o.d(t,{S:()=>r});let n=[];for(let e=0;e<256;++e)n.push((e+256).toString(16).slice(1));function r(e,t=0){return(n[e[t+0]]+n[e[t+1]]+n[e[t+2]]+n[e[t+3]]+"-"+n[e[t+4]]+n[e[t+5]]+"-"+n[e[t+6]]+n[e[t+7]]+"-"+n[e[t+8]]+n[e[t+9]]+"-"+n[e[t+10]]+n[e[t+11]]+n[e[t+12]]+n[e[t+13]]+n[e[t+14]]+n[e[t+15]]).toLowerCase()}},39964:(e,t,o)=>{o.d(t,{Z:()=>d});var n=o(6005);let r={randomUUID:n.randomUUID},a=new Uint8Array(256),i=a.length;var s=o(6468);let d=function(e,t,o){return!r.randomUUID||t||e?function(e,t,o){let r=(e=e||{}).random??e.rng?.()??(i>a.length-16&&((0,n.randomFillSync)(a),i=0),a.slice(i,i+=16));if(r.length<16)throw Error("Random bytes length must be >= 16");if(r[6]=15&r[6]|64,r[8]=63&r[8]|128,t){if((o=o||0)<0||o+16>t.length)throw RangeError(`UUID byte range ${o}:${o+15} is out of buffer bounds`);for(let e=0;e<16;++e)t[o+e]=r[e];return t}return(0,s.S)(r)}(e,t,o):r.randomUUID()}}};var t=require("../../../../../webpack-runtime.js");t.C(e);var o=e=>t(t.s=e),n=t.X(0,[8948,1703,3951],()=>o(79995));module.exports=n})();