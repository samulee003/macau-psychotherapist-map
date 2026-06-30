#!/usr/bin/env python3
"""
geocode.py — 將地址轉為經緯度座標（高德 Web 服務 geocoding API）。

輸入：scripts/raw.json（scrape.py 產出）
輸出：scripts/geocoded.json（每筆地址附上 lng/lat）

⚠️ 本腳本使用高德「Web 服務」API key（與前端 JS API key 不同）。
   請在環境變數 AMAP_WEB_KEY 設定，或修改下方 DEFAULT_KEY。
   此 key 僅在本地採集流程使用，不會進入前端。

   取得方式：https://lbs.amap.com/dev/
   → 應用管理 → 建立「Web服務」類型應用 → 取得 key

高德 geocoding 對澳門地址可能不夠精確，產出後務必用 preview.html 人工校驗。
"""

import json
import os
import re
import sys
import time
from pathlib import Path

import requests

# ----------------------------------------------------------------
# 設定
# ----------------------------------------------------------------

AMAP_WEB_KEY = os.environ.get("AMAP_WEB_KEY", "YOUR_AMAP_WEB_SERVICE_KEY")
GEOCODE_URL = "https://restapi.amap.com/v3/geocode/geo"

RAW = Path(__file__).resolve().parent / "raw.json"
OUTPUT = Path(__file__).resolve().parent / "geocoded.json"

# 澳門經緯度合理範圍（用來過濾明顯錯誤的 geocoding 結果）
MACAO_BBOX = {
    "lng_min": 113.52, "lng_max": 113.60,
    "lat_min": 22.10, "lat_max": 22.22,
}

REQUEST_DELAY = 0.25  # 高德免費額度 QPS 限制，保守一點


# ----------------------------------------------------------------
# 核心
# ----------------------------------------------------------------

def clean_address_for_geocoding(address: str) -> str:
    """
    清理地址，提高高德 geocoding 命中率。

    主要處理：
      1. 切掉中文地址後黏著的葡文段落（用葡文關鍵字錨點）
      2. 去除結尾的雜訊（-、多餘空白、括號房號如 (E31)）
      3. 統一「中國澳門」「澳門」前綴
    """
    if not address:
        return ""
    addr = address.replace("\xa0", " ").strip()

    # 切掉葡文段：從第一個葡文關鍵字之後全部移除
    pt_keywords = [
        "CENTRO", "ASSOCIA", "INSTITUTO", "POLICLÍNICA", "POLICLINICA",
        "LAR", "COMPLEXO", "EDIFÍCIO", "EDIF.", "EDF", "HOSPITAL",
        "WE POINT", "FUNG HONG", "ISTMO", "ROOM", "MACAU",
    ]
    earliest_pt = None
    addr_upper = addr.upper()
    for kw in pt_keywords:
        idx = addr_upper.find(kw)
        if idx != -1 and (earliest_pt is None or idx < earliest_pt):
            earliest_pt = idx
    if earliest_pt is not None:
        addr = addr[:earliest_pt].strip()

    # 去除結尾雜訊
    addr = addr.rstrip(" -—")
    # 去除獨立的房號括號如 (E31)
    addr = re.sub(r"\s*\([A-Z]?\d*\)\s*", " ", addr).strip()

    # 統一前綴為「澳門」
    addr = re.sub(r"^.*?澳門", "澳門", addr, count=1)
    if not addr.startswith("澳門"):
        addr = "澳門" + addr
    return addr.strip()


def simplify_address(addr: str) -> str:
    """
    簡化地址作為 fallback 查詢。

    高德對某些格式（如「14-A號」）解析失敗，簡化策略：
      1. 去除門牌號中的連字號後綴（14-A號 → 14號）
      2. 若仍含具體門牌，嘗試只用「街道+大廈名」
    """
    if not addr:
        return ""
    # 去除門牌號的 -X 後綴 (不區分大小寫)
    s = re.sub(r"(\d+)-[a-zA-Z]", r"\1", addr)
    return s.strip()


def _do_geocode_request(addr: str) -> dict:
    """實際發送高德 geocoding 請求，回傳座標 dict 或 {}。"""
    params = {
        "key": AMAP_WEB_KEY,
        "address": addr,
        "city": "澳門",
        "output": "json",
    }

    try:
        resp = requests.get(GEOCODE_URL, params=params, timeout=15)
        data = resp.json()
    except Exception as e:
        print(f"  [geocode] 請求失敗 {addr!r}: {e}")
        return {}

    if data.get("status") != "1" or int(data.get("count", 0)) < 1:
        return {}

    geo = data["geocodes"][0]
    location = geo.get("location", "")  # "lng,lat"
    if "," not in location:
        return {}

    lng_str, lat_str = location.split(",")
    try:
        lng, lat = float(lng_str), float(lat_str)
    except ValueError:
        return {}

    if not in_macao(lng, lat):
        print(f"  [geocode] ⚠ 座標超出澳門範圍，可能不準: {addr!r} -> ({lng},{lat})")

    return {
        "lng": round(lng, 6),
        "lat": round(lat, 6),
        "formatted": geo.get("formatted_address", ""),
        "level": geo.get("level", ""),
    }


def geocode_address(address: str) -> dict:
    """
    對單一地址呼叫高德 geocoding，含 fallback 重試。
    回傳 {"lng": float, "lat": float, "formatted": str, "level": str} 或 {} 失敗。
    """
    if not address or not address.strip():
        return {}

    addr = clean_address_for_geocoding(address)
    if not addr:
        return {}

    # 第一次嘗試：清理後的完整地址
    result = _do_geocode_request(addr)
    if result:
        return result

    # fallback 1：簡化地址（去門牌 -X 後綴等）重試
    simplified = simplify_address(addr)
    if simplified and simplified != addr:
        print(f"  [geocode] 重試簡化地址: {simplified!r}")
        result = _do_geocode_request(simplified)
        if result:
            return result

    # fallback 2：截斷具體大樓單元或樓層房號，只保留至主體地標或門牌號（例如：地下、樓、室、座、舖 等）
    # 尋找最後一個代表主要地標、大廈、中心或門牌號的關鍵字，切除其後的具體室/房號
    m = re.search(r"(\d+號|大廈|中心|廣場|社屋|樂群樓|永添新邨|信和廣場|雙鑽|東方中心|時代商業中心|羅德禮商業大廈|寶龍花園|富麗苑|照麗安大廈|美林花園|綠楊花園|宏建大廈|友聯大廈|活動中心|大馬路|街|巷|里)", addr)
    if m:
        coarser = addr[:m.end()].strip()
        if coarser and coarser != addr and coarser != simplified:
            print(f"  [geocode] 重試更粗略地址: {coarser!r}")
            result = _do_geocode_request(coarser)
            if result:
                return result

    print(f"  [geocode] 無結果 {addr!r}")
    return {}


def in_macao(lng: float, lat: float) -> bool:
    return (
        MACAO_BBOX["lng_min"] <= lng <= MACAO_BBOX["lng_max"]
        and MACAO_BBOX["lat_min"] <= lat <= MACAO_BBOX["lat_max"]
    )


# ----------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------

def main():
    if AMAP_WEB_KEY == "YOUR_AMAP_WEB_SERVICE_KEY":
        print("[geocode] ⚠ 未設定 AMAP_WEB_KEY 環境變數。")
        print("[geocode]   請執行: export AMAP_WEB_KEY=你的高德Web服務key")
        sys.exit(1)

    if not RAW.exists():
        print(f"[geocode] 找不到 {RAW}，請先執行 scrape.py")
        sys.exit(1)

    raw = json.loads(RAW.read_text(encoding="utf-8"))
    records = raw.get("records", [])
    print(f"[geocode] 載入 {len(records)} 筆原始記錄")

    # 收集所有不重複的地址去 geocode（多位治療師可能同一地址）
    addr_to_coord = {}
    unique_addrs = {}
    for rec in records:
        addr = (rec.get("addressZh") or "").strip()
        place = (rec.get("placeName") or "").strip()
        if not addr:
            continue
        key = addr
        if key not in unique_addrs:
            unique_addrs[key] = place

    print(f"[geocode] 共 {len(unique_addrs)} 個不重複地址需要 geocode")

    for i, (addr, place) in enumerate(unique_addrs.items(), 1):
        print(f"[{i}/{len(unique_addrs)}] {addr}  ({place})")
        coord = geocode_address(addr)
        addr_to_coord[addr] = coord
        time.sleep(REQUEST_DELAY)

    # 輸出
    payload = {
        "_meta": {
            "geocodedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "totalAddresses": len(unique_addrs),
            "resolved": sum(1 for v in addr_to_coord.values() if v),
        },
        "addresses": [
            {"address": a, "placeName": unique_addrs[a], **coord}
            for a, coord in addr_to_coord.items()
        ],
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[geocode] 已寫入 {OUTPUT}")
    print(f"[geocode] 成功解析 {payload['_meta']['resolved']}/{payload['_meta']['totalAddresses']} 個地址")
    print("[geocode] ⚠ 請執行 preview.html 人工校驗座標準確度")


if __name__ == "__main__":
    main()
