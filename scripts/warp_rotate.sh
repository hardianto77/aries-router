#!/bin/bash
exec 9>/home/ubuntu/.warp_rotate.lock
flock -n 9 || exit 0

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [POOL-RESET] Soft resetting pool health..." >> /home/ubuntu/warp_rotate.log
curl -s http://127.0.0.1:20129/api/proxy/reset >/dev/null 2>&1 || true
