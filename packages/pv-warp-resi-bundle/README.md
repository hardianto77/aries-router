# PV-WARP-Residential Bundle (no .env)
One-package bundle: ProxyVault + Residential fresh IPs + WARP egress rotation.
1. ProxyVault: venv + pip install -r requirements, python3 run.py -> :8022 (systemd user unit included). Set admin password via env/config — NOT committed.
2. Residential: resi-fresh-alive.txt -> /home/ubuntu/resi-fresh-alive.txt
3. WARP: warp_rotate.sh (flock + poll egress) daily 04:00 via systemd timers included.
4. pv_pool_sync.py every 30 min: ProxyVault + residential -> health-check -> pool -> per-account assignment (no proxy groups). Dead proxies/WARP auto-replaced.
Restore units: cp *service *timer /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now aries-router-pv-sync.timer aries-router-warp-rotate.timer
