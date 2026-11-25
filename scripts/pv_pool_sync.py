#!/usr/bin/env python3
"""
pv_pool_sync.py -- 9router upstream module style: per-provider dedicated fresh
residential egress + real WARP identity rotation.

- mode default / --skip-warp : refresh residential pool + heal per-provider direct bindings
  (unique verified residential endpoint per provider, proxyPoolId=NULL, no group pools)
- mode --skip-proxy          : WARP identity rotation ONLY
  (warp-cli registration delete + new -> genuinely fresh Cloudflare egress IP, NOT just reconnect)
"""
import json
import re
import subprocess
import sys

sys.path.insert(0, "/opt/aries-router/scripts")
import refresh_fresh_residential


def warp_rotate() -> dict:
    """Real WARP fresh-identity rotation: delete registration, register new, connect, verify egress."""
    log_lines = []
    try:
        subprocess.run(["warp-cli", "--accept-tos", "disconnect"], capture_output=True, timeout=30)
        subprocess.run(["warp-cli", "--accept-tos", "registration", "delete"], capture_output=True, timeout=30)
        subprocess.run(["warp-cli", "--accept-tos", "registration", "new"], capture_output=True, timeout=60)
        subprocess.run(["warp-cli", "--accept-tos", "connect"], capture_output=True, timeout=30)
        import time
        time.sleep(6)
        st = subprocess.run(["warp-cli", "--accept-tos", "status"], capture_output=True, text=True, timeout=30)
        connected = "Connected" in (st.stdout or "")
        import urllib.request
        proxy = urllib.request.ProxyHandler({"https": "socks5h://127.0.0.1:40000", "http": "socks5h://127.0.0.1:40000"})
        opener = urllib.request.build_opener(proxy)
        ip = None
        try:
            ip = opener.open("https://api.ipify.org", timeout=15).read().decode().strip()
        except Exception:
            pass
        print(f"[WARP] alive: {connected and bool(ip)} | egress: {ip}")
        return {"warpAlive": bool(connected and ip), "warpEgress": ip}
    except Exception as e:
        print(f"[WARP] rotate failed: {e}")
        return {"warpAlive": False, "warpEgress": None}


def main():
    args = sys.argv[1:]
    skip_proxy = "--skip-proxy" in args
    skip_warp = "--skip-warp" in args or not skip_proxy

    if not skip_proxy:
        # residential refresh + per-provider direct heal
        refresh_fresh_residential.main()
        # keep the manual Apply Proxy picker in sync with the Proxy Manager pool
        try:
            subprocess.run([sys.executable, "/opt/aries-router/scripts/pool_manager_sync.py"],
                           capture_output=True, timeout=60)
        except Exception as e:
            print(f"[pool-sync] failed: {e}")
    else:
        print("[resi] skipped (warp-only mode)")

    if not skip_warp:
        warp_rotate()


if __name__ == "__main__":
    main()
