#!/bin/bash
# Rotasi WARP -> fresh IP (re-registration), flock + poll egress siap
exec 9>/home/ubuntu/.warp_rotate.lock
flock -w 150 9 || exit 0

# skip kalau baru dirotasi <120 detik lalu
LAST=$(tail -1 /home/ubuntu/warp_rotate.log 2>/dev/null | awk '{print $1" "$2}')
[ -n "$LAST" ] && [ $(( $(date +%s) - $(date -d "$LAST" +%s 2>/dev/null || echo 0) )) -lt 120 ] && {
  IP=$(curl -s -m 10 -x http://127.0.0.1:8118 https://api.ipify.org)
  [ -n "$IP" ] && { echo "$(date '+%F %T') WARP keep: $IP (recent)" >> /home/ubuntu/warp_rotate.log; exit 0; }
}

echo y | script -qec "warp-cli --accept-tos registration delete" /dev/null >/dev/null 2>&1
sleep 2
echo y | script -qec "warp-cli --accept-tos registration new" /dev/null >/dev/null 2>&1
sleep 3
echo y | script -qec "warp-cli connect" /dev/null >/dev/null 2>&1
sleep 5

# poll sampai egress via :8118 siap (maks 60 detik)
IP=""
for i in $(seq 1 30); do
  IP=$(curl -s -m 6 -x http://127.0.0.1:8118 https://api.ipify.org)
  [ -n "$IP" ] && break
  sleep 2
done
echo "$(date '+%F %T') WARP fresh egress: ${IP:-NOT-READY}" >> /home/ubuntu/warp_rotate.log
