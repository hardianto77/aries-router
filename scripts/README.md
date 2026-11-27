# Active Proxy Harvest & Pure-Residential Scripts

- `refresh_fresh_residential.py`: 3-stage pure-residential harvester & verifier (3/3 HTTPS TLS + jitter + dual-provider ASN + proxyFlagged=false), updates `residential_fresh_pool.json` & `/home/ubuntu/resi-fresh-alive.txt`, syncs per-connection round-robin direct bindings, and reloads `Proxy Resi` (`127.0.0.1:20189/reload`).
- `sync_direct_proxies.py`: CLI wrapper/helper for direct per-connection pure-residential proxy synchronization.
