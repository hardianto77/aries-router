// proxyIpBlocker — blokir IP proxy / VPN / datacenter / TOR exit (anti-farming)
// Sumber statis harian, tanpa API key. Dipakai halaman klaim voucher.
// Deps: none (node builtin only) — bisa dipanggil node langsung utk seeding.

import fs from "node:fs";
import path from "node:path";

const BLOCK_DIR = path.join(process.cwd(), "data", "blocklists");
const META_FILE = path.join(BLOCK_DIR, "meta.json");
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // refresh tiap 24 jam
const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

// tipe: "ip"   = satu IP per baris
//       "cidr" = CIDR per baris
const SOURCES = [
  { name: "speedx-http", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt", type: "ip" },
  { name: "speedx-socks4", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt", type: "ip" },
  { name: "speedx-socks5", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt", type: "ip" },
  { name: "monosans-http", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt", type: "ip" },
  { name: "monosans-socks4", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt", type: "ip" },
  { name: "monosans-socks5", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt", type: "ip" },
  { name: "x4b-datacenter", url: "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv4.txt", type: "cidr" },
  { name: "x4b-vpn", url: "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt", type: "cidr" },
  { name: "tor-onionoo", url: "https://onionoo.torproject.org/details?type=relay&running=true&fields=fingerprint,or_addresses", type: "onionoo" },
  { name: "tor-danme", url: "https://www.dan.me.uk/torlist/?exit", type: "ip" },
];

/** ranges = flat sorted Uint32 pairs [start0, end0, start1, end1, ...] */
let ranges = null;
let meta = { fetchedAt: 0, counts: {}, ok: false };
let refreshing = null;

function ipToInt(ip) {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const seg of p) {
    const v = Number(seg);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

// Range privat/reserved — JANGAN pernah diblok (cegah kunci diri sendiri / LAN / carrier NAT)
function isPrivateRange(s, e) {
  const priv = [
    [ipToInt("0.0.0.0"), ipToInt("0.255.255.255")],
    [ipToInt("10.0.0.0"), ipToInt("10.255.255.255")],
    [ipToInt("100.64.0.0"), ipToInt("100.127.255.255")], // CGNAT
    [ipToInt("127.0.0.0"), ipToInt("127.255.255.255")],
    [ipToInt("169.254.0.0"), ipToInt("169.254.255.255")],
    [ipToInt("172.16.0.0"), ipToInt("172.31.255.255")],
    [ipToInt("192.168.0.0"), ipToInt("192.168.255.255")],
    [ipToInt("198.18.0.0"), ipToInt("198.19.255.255")],
    [ipToInt("224.0.0.0"), ipToInt("255.255.255.255")],
  ];
  return priv.some(([ps, pe]) => s <= pe && e >= ps);
}

function parseBlock(text, type, out) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    let s, e;
    if (type === "cidr") {
      const [base, bitsRaw] = line.split("/");
      const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
      const b = ipToInt(base);
      if (b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      s = (b & mask) >>> 0;
      e = (b | (~mask >>> 0)) >>> 0;
    } else {
      // format "ip" bisa berupa "1.2.3.4" atau "1.2.3.4:8080" (host:port)
      if (line.startsWith("[")) continue; // ipv6 literal
      const host = line.includes(":") ? line.split(":")[0] : line;
      s = ipToInt(host);
      if (s === null) continue;
      e = s;
    }
    if (isPrivateRange(s, e)) continue;
    out.push([s, e]);
  }
}

function mergeRanges(pairs) {
  if (pairs.length === 0) return new Uint32Array(0);
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  let [cs, ce] = pairs[0];
  for (let i = 1; i < pairs.length; i++) {
    const [s, e] = pairs[i];
    if (s <= ce + 1) {
      if (e > ce) ce = e;
    } else {
      merged.push(cs, ce);
      cs = s;
      ce = e;
    }
  }
  merged.push(cs, ce);
  return Uint32Array.from(merged);
}

async function fetchSource(src) {
  const res = await fetch(src.url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${src.name}: HTTP ${res.status}`);
  let text;
  if (src.type === "onionoo") {
    const json = await res.json();
    const ips = [];
    for (const relay of json.relays || []) {
      for (const addr of relay.or_addresses || []) {
        if (addr.startsWith("[")) continue;
        ips.push(addr.split(":")[0]);
      }
    }
    text = ips.join("\n");
  } else {
    text = await res.text();
  }
  if (text.length < 10) throw new Error(`${src.name}: empty`);
  fs.writeFileSync(path.join(BLOCK_DIR, `${src.name}.txt`), text);
  return text;
}

async function refreshAll() {
  fs.mkdirSync(BLOCK_DIR, { recursive: true });
  const counts = {};
  let anyOk = false;
  for (const src of SOURCES) {
    try {
      const text = await fetchSource(src);
      const pairs = [];
      parseBlock(text, src.type, pairs);
      counts[src.name] = pairs.length;
      anyOk = true;
    } catch (err) {
      // pakai cache lama utk source ini
      counts[src.name] = `ERR: ${err.message}`;
    }
  }
  if (anyOk) {
    await compileFromDisk();
    meta = { fetchedAt: Date.now(), counts, ok: true };
    fs.writeFileSync(META_FILE, JSON.stringify(meta));
  }
  return meta;
}

async function compileFromDisk() {
  const pairs = [];
  for (const src of SOURCES) {
    const f = path.join(BLOCK_DIR, `${src.name}.txt`);
    if (!fs.existsSync(f)) continue;
    parseBlock(fs.readFileSync(f, "utf8"), src.type, pairs);
  }
  ranges = mergeRanges(pairs);
}

function scheduleRefresh() {
  if (refreshing) return refreshing;
  refreshing = refreshAll()
    .catch((err) => {
      console.error("[proxyIpBlocker] refresh failed:", err.message);
      return meta;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function loadMeta() {
  try {
    meta = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
  } catch {}
}

/** Lazy init — block dulu dari cache, refresh di background kalo udah >24 jam */
async function ensureLoaded() {
  loadMeta();
  if (!ranges) {
    const anyFile = SOURCES.some((s) => fs.existsSync(path.join(BLOCK_DIR, `${s.name}.txt`)));
    if (anyFile) {
      await compileFromDisk();
      if (Date.now() - meta.fetchedAt > MAX_AGE_MS) scheduleRefresh();
    } else {
      await scheduleRefresh(); // first run: sinkron sekali
    }
  } else if (Date.now() - meta.fetchedAt > MAX_AGE_MS) {
    scheduleRefresh();
  }
}

/**
 * true kalau IP masuk daftar proxy/VPN/datacenter/TOR.
 * Fail-open: list belum siap / IP bukan v4 valid → false.
 */
export async function isKnownProxyIp(ip) {
  try {
    await ensureLoaded();
    if (!ranges || ranges.length === 0) return false;
    const n = ipToInt(String(ip || "").split("/")[0]);
    if (n === null) return false;
    // binary search interval terakhir dengan start <= n
    let lo = 0, hi = ranges.length / 2 - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ranges[mid * 2] <= n) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (ans < 0) return false;
    return n <= ranges[ans * 2 + 1];
  } catch (err) {
    console.error("[proxyIpBlocker] check error:", err.message);
    return false;
  }
}

export function getProxyBlockStats() {
  return {
    ok: meta.ok,
    fetchedAt: meta.fetchedAt ? new Date(meta.fetchedAt).toISOString() : null,
    totalRanges: ranges ? ranges.length / 2 : 0,
    counts: meta.counts,
  };
}

/** dipakai script seeding: force download semua sumber */
export async function forceRefreshAll() {
  return refreshAll();
}
