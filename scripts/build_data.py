#!/usr/bin/env python3
"""
build_data.py — 將 raw.json + geocoded.json 合併為前端使用的 data.json。

處理：
    1. 治療師去重（同牌照號合併）
    2. 地址去重 → Location（同地址合併為一個地點）
    3. 建立 Practice 關聯（therapist ↔ location）
    4. 依機構名關鍵字自動分類 category
    5. 產出 ../data/data.json

執行順序：scrape.py → geocode.py → build_data.py
"""

import hashlib
import json
import re
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
RAW = SCRIPTS_DIR / "raw.json"
GEOCODED = SCRIPTS_DIR / "geocoded.json"
OUTPUT = SCRIPTS_DIR.parent / "data" / "data.json"

# ----------------------------------------------------------------
# 機構分類規則（依機構名關鍵字，順序重要：先比對優先級高的）
# ----------------------------------------------------------------
CATEGORY_RULES = [
    ("hospital", ["醫院", "hospital", "centro hospitalar", "衛生中心"]),
    ("university", ["大學", "universidade", "university", "學院"]),
    ("social", ["協會", "總會", "聯合會", "服務", "扶康", "街坊", "新青協", "婦聯",
                "工聯", "基督教", "團契", "特奧", "復康", "康復",
                "聖類斯", "聖路濟亞", "聖瑪嘉烈", "主教山", "旭日中心",
                "associação", "federação", "social", "lar "]),
    ("psych_center", ["心理治療中心", "心理中心", "心理輔導", "心理",
                      "centro de psicoterapia", "psicoterapia"]),
    ("med_center", ["醫療中心", "centro médico", "診所", "clinic", "醫務所",
                    "治療中心", "診療所", "治療所", "tratamento", "terapia"]),
    ("gov", ["市政署", "社工局", "衛生局", "公共醫療機構", "政府", "governo", "iapf", "社會工作局"]),
]


def classify(name: str) -> str:
    """依機構名判斷分類。"""
    n = (name or "").lower()
    for cat, keywords in CATEGORY_RULES:
        for kw in keywords:
            if kw.lower() in n:
                return cat
    return "other"


# ----------------------------------------------------------------
# 工具
# ----------------------------------------------------------------

def make_id(prefix: str, seed: str) -> str:
    """由 seed 產生穩定 id（同 seed 永遠同 id），用於去重合併。"""
    h = hashlib.md5(seed.encode("utf-8")).hexdigest()[:8]
    return f"{prefix}_{h}"


def normalize_license(lic: str) -> str:
    """牌照號正規化：T-0776。"""
    if not lic:
        return ""
    s = lic.strip().upper()
    # 補 dash：T0776 -> T-0776
    m = re.match(r"^(T)(\d{3,5})$", s)
    if m:
        s = f"{m.group(1)}-{m.group(2)}"
    return s


def normalize_addr(addr: str) -> str:
    """地址正規化（用於去重 key）：去空白、統全形。"""
    if not addr:
        return ""
    return re.sub(r"\s+", "", addr.strip())


# ----------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------

def main():
    if not RAW.exists():
        print(f"[build] 找不到 {RAW}，請先執行 scrape.py")
        return

    raw = json.loads(RAW.read_text(encoding="utf-8"))
    records = raw.get("records", [])

    # 載入 geocoding 結果（可選；若無則座標留空）
    addr_to_coord = {}
    if GEOCODED.exists():
        geo = json.loads(GEOCODED.read_text(encoding="utf-8"))
        for a in geo.get("addresses", []):
            if a.get("lng") is not None:
                addr_to_coord[normalize_addr(a["address"])] = {
                    "lng": a["lng"], "lat": a["lat"]
                }

    therapists = {}     # id -> therapist dict
    locations = {}      # id -> location dict
    place_to_locid = {} # normalized place name -> location id
    practices = []

    for rec in records:
        lic = normalize_license(rec.get("licenseNo", ""))
        name_zh = (rec.get("nameZh") or "").strip()
        name_en = (rec.get("nameEn") or "").strip()

        # 不計算實習生：過濾實習執照（PE 開頭）
        if lic.startswith("PE"):
            continue

        # 治療師：以牌照號為唯一 key（無牌照號則以中文姓名）
        if lic:
            t_key = lic
            t_id = make_id("T", lic)
        elif name_zh:
            t_key = f"name:{name_zh}"
            t_id = make_id("T", t_key)
        else:
            continue  # 無名無牌照，跳過

        if t_key not in therapists:
            therapists[t_key] = {
                "id": t_id,
                "licenseNo": lic,
                "nameZh": name_zh,
                "nameEn": name_en,
                "status": (rec.get("status") or "").strip() or "有效",
            }
        else:
            # 補充缺失欄位
            t = therapists[t_key]
            if not t["nameEn"] and name_en:
                t["nameEn"] = name_en

        # 地點：以機構名稱去重為優先，無機構名稱才以地址去重
        place_name = (rec.get("placeName") or "").strip()
        addr_raw = (rec.get("addressZh") or "").strip()
        
        # 針對政府公立醫療機構（無具體執業地址者）進行特殊地理編碼與地址映射
        if place_name in ["衛生局", "澳門公共醫療機構"] and not addr_raw:
            addr_raw = "澳門若憲馬路339號"

        if not place_name and not addr_raw:
            continue  # 無地點資訊，無法建立 location

        # 唯一去重 Key：優先使用機構名稱，若無則使用地址
        loc_key = place_name or addr_raw
        loc_key_norm = re.sub(r"\s+", "", loc_key)

        if loc_key_norm in place_to_locid:
            loc_id = place_to_locid[loc_key_norm]
            # 補足先前已建立地點但缺失的電話與時間
            existing_loc = locations[loc_id]
            if not existing_loc.get("phone") and rec.get("phone"):
                existing_loc["phone"] = rec["phone"]
            if not existing_loc.get("hours") and rec.get("hours"):
                existing_loc["hours"] = rec["hours"]
        else:
            loc_id = make_id("loc", loc_key_norm)
            loc = {
                "id": loc_id,
                "name": place_name or "（未知名稱）",
                "addressZh": addr_raw,
                "category": classify(place_name + " " + addr_raw),
                "phone": rec.get("phone", ""),
                "hours": rec.get("hours", ""),
            }
            # 從 geocoding 結果查找坐標（使用此記錄的地址）
            addr_norm = normalize_addr(addr_raw)
            coord = addr_to_coord.get(addr_norm)
            
            # 針對特定的高德 geocoding 偏差或大廈坐標進行手動精準修正
            if "土地廟里" in addr_raw:
                coord = {"lng": 113.543613, "lat": 22.198883}
            elif "望德樓" in addr_raw or "望德樓" in place_name:
                coord = {"lng": 113.5516, "lat": 22.2071}
            elif "九澳聖母馬路" in addr_raw or "聖路濟亞" in place_name:
                coord = {"lng": 113.5855, "lat": 22.1287}
            elif "卓家村天津街" in addr_raw or "聖瑪嘉烈" in place_name or "聖類斯" in place_name:
                coord = {"lng": 113.5594, "lat": 22.1585}
            elif "寶龍花園" in addr_raw or "環宇醫療中心" in place_name:
                coord = {"lng": 113.5583, "lat": 22.1537}
            elif "利達新邨" in addr_raw or "利達新邨" in place_name or "社會工作局" in place_name:
                coord = {"lng": 113.552786, "lat": 22.208034}
            elif not coord and place_name in ["衛生局", "澳門公共醫療機構"]:
                coord = {"lng": 113.550801, "lat": 22.190530}
            
            if coord:
                loc["lng"] = coord["lng"]
                loc["lat"] = coord["lat"]
            locations[loc_id] = loc
            place_to_locid[loc_key_norm] = loc_id

        # 建立關聯（去重）
        practice_key = (t_id, loc_id)
        if not any(p["therapistId"] == t_id and p["locationId"] == loc_id for p in practices):
            practices.append({"therapistId": t_id, "locationId": loc_id})

    # 輸出。來源資訊從 raw.json 的 _meta 動態繼承（scrape.py 寫入），
    # 避免來源變更時 meta 與實際採集來源不一致。
    raw_meta = raw.get("_meta", {})
    payload = {
        "meta": {
            "description": "澳門註冊心理治療師執業地點分布",
            "source": raw_meta.get("source", ""),
            "sourceUrl": raw_meta.get("sourceUrl", ""),
            "officialSource": "澳門特別行政區政府衛生局 — 從事私人醫務活動專業人員名冊",
            "officialSourceUrl": "https://www.ssm.gov.mo/pubssmweb/register/frmShowRegister.aspx",
            "collectedAt": time.strftime("%Y-%m-%d"),
            "scrapedAt": raw_meta.get("scrapedAt", ""),
            "note": raw_meta.get("note", "資料僅供參考；最新資訊請以衛生局官方查詢系統為準。"),
            "disclaimer": "本網站非官方機構，資料可能有延遲或不完整，不構成任何醫療建議或轉介。",
            "stats": {
                "therapists": len(therapists),
                "locations": len(locations),
                "practices": len(practices),
            },
        },
        "therapists": list(therapists.values()),
        "locations": list(locations.values()),
        "practices": practices,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[build] 已寫入 {OUTPUT}")
    print(f"[build] 治療師: {len(therapists)}  地點: {len(locations)}  關聯: {len(practices)}")
    geocoded_count = sum(1 for l in locations.values() if "lng" in l)
    print(f"[build] 已定位地點: {geocoded_count}/{len(locations)}")
    if geocoded_count < len(locations):
        print(f"[build] ⚠ {len(locations) - geocoded_count} 個地點缺座標，請用 preview.html 補上")


if __name__ == "__main__":
    main()
