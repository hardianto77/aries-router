#!/usr/bin/env python3
"""aries-router-oc-infinite: OpenCode Infinite Auto-Rotator (Stable Cursor)
Watches Aries Router and OpenCode Bridge for fresh FreeUsageLimitError (429)
Using --since window to completely prevent stale log thrashing.
"""
import re, subprocess, time, os, sys

LOG_CMD = ["journalctl", "-u", "aries-router", "--since", "15 seconds ago", "--no-pager", "-o", "cat"]
BRIDGE_LOG = "/tmp/opencode-bridge.log"
PATTERNS = re.compile(
    r"FreeUsageLimitError|allowance 429|quota.*exceed",
    re.I
)
COOLDOWN = 30  # minimum 30s between rotations to allow connection to settle
STATE = "/tmp/.oc-infinite.last"

def warp_rotate():
    subprocess.run(["/opt/aries-router/scripts/warp_rotate.sh"], timeout=40)

def last_rotate_age():
    try:
        return time.time() - float(open(STATE).read().strip())
    except Exception:
        return 1e9

def main():
    print("[oc-infinite] OpenCode Infinite Daemon started with 15s sliding window.", flush=True)
    while True:
        try:
            out_ar = subprocess.run(LOG_CMD, capture_output=True, text=True, timeout=10).stdout or ""
        except Exception:
            out_ar = ""
        
        if PATTERNS.search(out_ar) and last_rotate_age() > COOLDOWN:
            open(STATE, "w").write(str(time.time()))
            print(f"[{time.strftime('%H:%M:%S')}] Fresh FreeUsageLimit detected -> rotating WARP IP...", flush=True)
            try:
                warp_rotate()
                print(f"[{time.strftime('%H:%M:%S')}] WARP rotated and pool reset successfully.", flush=True)
            except Exception as e:
                print("rotate failed:", e, flush=True)
        time.sleep(5)

if __name__ == "__main__":
    main()
