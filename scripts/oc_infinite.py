#!/usr/bin/env python3
"""aries-router-oc-infinite: bawaan router.
Watch log aries-router: kalau OpenCode lane kena 429/limit -> rotasi WARP fresh
(warp_rotate.sh) -> kunci model otomatis lewat (lock 30s) -> request lanjut
pakai egress WARP baru. Built-in systemd, bukan skrip terpisah.
"""
import re, subprocess, time, os, sys

LOG_CMD = ["journalctl", "-u", "aries-router", "-n", "40", "--no-pager", "-o", "cat"]
PATTERNS = re.compile(r"\[429\]|rate.?limit|There is an error but this error is hidden|quota.*exceed", re.I)
COOLDOWN = 300  # max 1 rotasi / 5 menit
STATE = "/tmp/.oc-infinite.last"

def warp_rotate():
    subprocess.run(["/opt/aries-router/scripts/warp_rotate.sh"], timeout=200)

def last_rotate_age():
    try:
        return time.time() - float(open(STATE).read().strip())
    except Exception:
        return 1e9

def main():
    while True:
        try:
            out = subprocess.run(LOG_CMD, capture_output=True, text=True, timeout=30).stdout
        except Exception:
            out = ""
        if PATTERNS.search(out or "") and last_rotate_age() > COOLDOWN:
            open(STATE, "w").write(str(time.time()))
            print(f"[{time.strftime('%H:%M:%S')}] limit detected -> rotating WARP", flush=True)
            try:
                warp_rotate()
            except Exception as e:
                print("rotate failed:", e, flush=True)
        time.sleep(20)

if __name__ == "__main__":
    main()
