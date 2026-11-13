# Bawaan Aries Router: ProxyVault + Residential + WARP egress rotation
- pv_pool_sync.py (tiap 30 menit, timer aries-router-pv-sync):
  ProxyVault export -> health-check -> pool proxyPools -> assignment per akun
  (providerConnection.connectionProxyUrl, TANPA group proxy). Proxy/WARP mati
  auto-diganti (health-check). Guard: skip bila koneksi >150k (indikasi banjir).
- warp_rotate.sh (tiap hari 04:00, timer aries-router-warp-rotate): re-registration
  WARP -> fresh egress, flock + poll egress siap.
- seed_bridge.py: seed pool bridge OpenCode (:20129) dari proxy.json.
- Failover runtime: open-sse/utils/proxyFetch.js PV-FAILOVER (spares dari
  ~/.aries-router/pv_pool.json, lalu WARP; tidak pernah direct).
- Residential fresh: ~/resi-fresh-alive.txt (49 proxy terverifikasi) diinjek ke
  pool failover + bridge; klasifikasi via ip-api (hosting=false).
