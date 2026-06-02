#!/usr/bin/env python3
# Hydrax.GG data builder — fetches WhatToMine (GPU + ASIC) + prices, writes
# data/coins.json + data/prices.json for the site to read same-origin.
# Stdlib only (no pip) so the GitHub Action needs no setup.
import json, time, os, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Hydrax.GG data builder; +https://hydrax.gg)"}
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
        return json.loads(r.read().decode("utf-8", "replace"))
def try_get(url):
    try: return get(url)
    except Exception as e: print("warn:", url, e); return None

# prices (for ticker fallback) + BTC/USD (to convert WhatToMine's BTC rates)
cg = try_get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,monero,"
             "ethereum-classic,ravencoin&vs_currencies=usd&include_24hr_change=true") or {}
btc = (cg.get("bitcoin") or {}).get("usd") or 0
if not btc:
    cb = try_get("https://api.coinbase.com/v2/prices/BTC-USD/spot")
    if cb:
        try: btc = float(cb["data"]["amount"])
        except Exception: pass
if not btc:
    raise SystemExit("no BTC/USD price available — aborting")

# default hashrate unit per algorithm (user can override in the UI)
ALGO_UNIT = {
    "SHA-256": ("TH/s", 1e12), "Scrypt": ("GH/s", 1e9), "RandomX": ("kH/s", 1e3),
    "Eaglesong": ("GH/s", 1e9), "Blake3": ("GH/s", 1e9), "kHeavyHash": ("GH/s", 1e9),
    "X11": ("GH/s", 1e9), "Blake (2b-Sia)": ("GH/s", 1e9), "Handshake": ("GH/s", 1e9),
}
def unit_for(algo):
    if algo and algo.startswith("Equihash"): return ("Sol/s", 1)
    return ALGO_UNIT.get(algo, ("MH/s", 1e6))

def build(coins, typ):
    out = []
    for name, c in (coins or {}).items():
        try:
            nethash = float(c.get("nethash") or 0); reward = float(c.get("block_reward") or 0)
            bt = float(c.get("block_time") or 0); er = float(c.get("exchange_rate") or 0)
            curr = (c.get("exchange_rate_curr") or "BTC").upper()
            usd = er * btc if curr == "BTC" else er
            if nethash <= 0 or bt <= 0 or reward <= 0 or usd <= 0: continue
            u, m = unit_for(c.get("algorithm", ""))
            out.append({"name": name, "tag": c.get("tag", ""), "algo": c.get("algorithm", ""),
                        "type": typ, "unit": u, "mult": m, "nethash": nethash,
                        "reward": reward, "blocktime": bt, "price": round(usd, 10)})
        except Exception:
            pass
    return out

gpu = try_get("https://whattomine.com/coins.json") or {"coins": {}}
asic = try_get("https://whattomine.com/asic.json") or {"coins": {}}
coins = build(gpu.get("coins"), "gpu") + build(asic.get("coins"), "asic")
coins.sort(key=lambda x: x["name"].lower())
if len(coins) < 10:
    raise SystemExit("too few coins (%d) — likely a fetch failure, not overwriting" % len(coins))

os.makedirs("data", exist_ok=True)
json.dump({"updated": int(time.time()), "count": len(coins), "btc_usd": btc, "coins": coins},
          open("data/coins.json", "w"), separators=(",", ":"))
json.dump({"updated": int(time.time()), "prices": cg},
          open("data/prices.json", "w"), separators=(",", ":"))
print("wrote data/coins.json (%d coins) + data/prices.json  ·  BTC=$%.0f" % (len(coins), btc))
