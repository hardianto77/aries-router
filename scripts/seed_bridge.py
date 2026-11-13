import json, urllib.request
entries = json.load(open('/home/ubuntu/.opencode-free-bridge/proxy.json'))['entries']
req = urllib.request.Request("http://127.0.0.1:20129/api/proxy", data=json.dumps({"entries":entries}).encode(), headers={"Content-Type":"application/json"})
print("bridge seeded:", len(entries), urllib.request.urlopen(req, timeout=20).read().decode()[:80])
