#!/usr/bin/env python3
"""
import_roster_csv.py — 把人工匯出的名冊 CSV 轉為 raw.json（scrape.py 的替代入口）。

為什麼需要這支腳本
------------------
scrape.py 走 Playwright 直接抓衛生局頁面，但在 GitHub Actions 的機房 IP 上
100% 被 Cloudflare 擋下（偵察證實 ssm.gov.mo 與 cps.gov.mo 全數 403，
純 HTTP 與真 Chrome 皆然，強化瀏覽器指紋亦無效）。家用網路 IP 則可正常存取。

因此實務上的採集路徑是：在本機瀏覽器取得名冊、匯出 CSV，再由本腳本
接回既有的資料管線。scrape.py 保留不動，本機仍可使用。

CSV 欄位（衛生局「從事私人醫務活動專業人員名冊」原始欄序）：
    序號, 執照類別, 執照編號, 中文姓名, 外文姓名,
    執業地點及地址, 電話, 診症時間, 84/90/M准照編號, 准照批示日期

用法：
    python scripts/import_roster_csv.py <名冊.csv>

產出：
    scripts/raw.json       —— 與 scrape.py 相同結構，供 build_data.py 使用
    scripts/geocoded.json  —— 以現有 data.json 的座標預先填好，
                              只有真正的新地址才需要另跑 geocode.py

座標沿用策略（重要）
--------------------
名冊本身沒有座標，每次重新 geocode 全部地址既浪費高德額度、也讓整條
管線硬相依於 AMAP_WEB_KEY。本腳本改為從現有 data.json 沿用：

    1. 正規化地址完全相同     → 直接沿用
    2. 地址不同但機構名相同   → 沿用，但僅限該機構名在現有資料中
                               對應唯一座標（避免同名分店取到錯的點）
    3. 都對不上               → 列為待 geocode，由使用者另行處理

第 2 條處理的是同一地點的細微文字差異（例如「永添新邨」/「永第新邨」、
「友聯大廈1G」/「友聯大廈G1」、澳大同棟樓的不同房號），這些不是新地點，
不該重新 geocode。
"""

import argparse
import csv
import json
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
DEFAULT_DATA = SCRIPTS_DIR.parent / "data" / "data.json"
RAW_OUT = SCRIPTS_DIR / "raw.json"
GEOCODED_OUT = SCRIPTS_DIR / "geocoded.json"

EXPECTED_HEADER_PREFIX = ["序號", "執照類別", "執照編號", "中文姓名", "外文姓名", "執業地點及地址"]


# ----------------------------------------------------------------
# 欄位正規化
# 與 scrape.py 的同名函式保持一致 —— 兩條入口必須產出相同格式的
# raw.json，否則 build_data.py 算出的 id 會漂移、既有深連結會失效。
# ----------------------------------------------------------------

def normalize_license(raw: str) -> str:
    """正規化牌照號：PI0042 -> PI-0042。空字串保留。"""
    if not raw:
        return ""
    s = raw.strip().upper()
    m = re.match(r"^(T|PE|PI)-?(\d{3,5})$", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    return s


def clean_phone(raw: str) -> str:
    """清理電話欄：單一 8 位數補澳門區碼格式，其餘（多組號碼等）原樣保留。"""
    if not raw:
        return ""
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 8 and not digits.startswith("853"):
        return f"+853 {digits[:4]} {digits[4:]}"
    return raw.strip()


def normalize_addr(addr: str) -> str:
    """地址正規化（比對用）：去除所有空白。與 build_data.py 一致。"""
    if not addr:
        return ""
    return re.sub(r"\s+", "", addr.strip())


def split_place_and_address(combo: str):
    """
    拆解「執業地點及地址」欄。

    來源格式為「機構名 - 地址」；部分機構（如衛生局、澳門公共醫療機構）
    只有機構名而無地址。以第一個 ' - ' 為界，避免地址內含連字號時誤切。
    """
    combo = (combo or "").strip()
    if " - " in combo:
        place, addr = combo.split(" - ", 1)
        return place.strip(), addr.strip()
    return combo, ""


# ----------------------------------------------------------------
# 讀取
# ----------------------------------------------------------------

def read_csv(path: Path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    if not rows:
        sys.exit(f"[import] {path} 是空檔案")

    header = [h.strip() for h in rows[0]]
    for i, want in enumerate(EXPECTED_HEADER_PREFIX):
        if i >= len(header) or header[i] != want:
            sys.exit(
                f"[import] CSV 欄位不符預期。\n"
                f"  第 {i + 1} 欄預期 {want!r}，實際 {header[i] if i < len(header) else '（缺欄）'!r}\n"
                f"  完整表頭：{header}"
            )

    records = []
    for lineno, r in enumerate(rows[1:], start=2):
        if not any(c.strip() for c in r):
            continue
        if len(r) < 8:
            print(f"[import] ⚠ 第 {lineno} 行欄數不足（{len(r)}），已略過：{r}")
            continue
        place, addr = split_place_and_address(r[5])
        name_zh = r[3].strip()
        name_en = r[4].strip()
        records.append({
            "licenseNo": normalize_license(r[2]),
            "licenseType": r[1].strip(),
            # 中文姓名可能為空（如 PI-0085 只有外文姓名）。
            # 前端以 nameZh 顯示，留空會變成「（未具名）」，故回退至外文姓名 ——
            # 這也與先前 scrape.py 產出的資料一致。
            "nameZh": name_zh or name_en,
            "nameEn": name_en,
            "placeName": place,
            "addressZh": addr,
            "addressPt": "",  # 本 CSV 已去除葡文欄
            "phone": clean_phone(r[6]),
            "hours": r[7].strip(),
        })
    return records


# ----------------------------------------------------------------
# 座標沿用
# ----------------------------------------------------------------

def build_coord_index(data_path: Path):
    """從現有 data.json 建立：正規化地址 -> 座標、機構名 -> 座標（唯一時）。"""
    if not data_path.exists():
        print(f"[import] 找不到 {data_path}，將不沿用任何座標")
        return {}, {}, {}

    data = json.loads(data_path.read_text(encoding="utf-8"))
    by_addr = {}
    name_coords = defaultdict(set)
    name_addr = {}
    for loc in data.get("locations", []):
        lng, lat = loc.get("lng"), loc.get("lat")
        addr = normalize_addr(loc.get("addressZh", ""))
        name = loc.get("name", "")
        if lng is not None and lat is not None:
            if addr:
                by_addr[addr] = (lng, lat)
            name_coords[name].add((lng, lat))
        if name and addr:
            name_addr.setdefault(name, loc.get("addressZh", ""))

    # 只保留座標唯一的機構名，避免同名不同點取錯
    by_name = {n: next(iter(c)) for n, c in name_coords.items() if len(c) == 1}
    return by_addr, by_name, name_addr


def resolve_coords(records, by_addr, by_name):
    """回傳 (addr_to_coord, 統計)。addr_to_coord 供 geocoded.json 使用。"""
    seen = {}   # 正規化地址 -> placeName（取第一個）
    for rec in records:
        if rec["licenseNo"].startswith("PE-"):
            continue  # 實習執照不計入（build_data.py 也會過濾）
        a = normalize_addr(rec["addressZh"])
        if a:
            seen.setdefault(a, rec["placeName"])

    resolved, by_name_hits, missing = {}, [], []
    for addr, place in seen.items():
        if addr in by_addr:
            resolved[addr] = by_addr[addr]
        elif place in by_name:
            resolved[addr] = by_name[place]
            by_name_hits.append((place, addr))
        else:
            missing.append((place, addr))
    return resolved, by_name_hits, missing


# ----------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="把名冊 CSV 轉為 raw.json + geocoded.json")
    ap.add_argument("csv", type=Path, help="名冊 CSV 路徑")
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA, help="現有 data.json（沿用座標與地址）")
    ap.add_argument("--raw-out", type=Path, default=RAW_OUT)
    ap.add_argument("--geocoded-out", type=Path, default=GEOCODED_OUT)
    # build_data.py 會把 scrapedAt 原樣寫進 data.json 的 meta，前端頁尾會顯示。
    # 名冊是人工匯出的，實際擷取時間未必等於執行本腳本的時間，故可指定。
    ap.add_argument("--scraped-at", default=time.strftime("%Y-%m-%d %H:%M:%S"),
                    help="名冊擷取時間，預設為現在")
    args = ap.parse_args()

    if not args.csv.exists():
        sys.exit(f"[import] 找不到 {args.csv}")

    records = read_csv(args.csv)
    full = [r for r in records if not r["licenseNo"].startswith("PE-")]
    print(f"[import] 讀入 {len(records)} 筆（完全執照 {len(full)}、實習 {len(records) - len(full)}）")
    print(f"[import] 不重複執照編號: {len({r['licenseNo'] for r in records if r['licenseNo']})}")

    by_addr, by_name, name_addr = build_coord_index(args.data)

    # 來源未提供地址、但現有資料有的，沿用舊地址（否則會平白弄丟資訊）
    carried = []
    for rec in records:
        if not rec["addressZh"] and rec["placeName"] in name_addr:
            rec["addressZh"] = name_addr[rec["placeName"]]
            carried.append(rec["placeName"])
    for place in sorted(set(carried)):
        print(f"[import] 沿用現有地址: {place} -> {name_addr[place]}")

    resolved, by_name_hits, missing = resolve_coords(records, by_addr, by_name)

    print(f"\n[import] 座標沿用：{len(resolved)} 個地址已有座標")
    if by_name_hits:
        print(f"[import]   其中 {len(by_name_hits)} 個靠機構名比對（地址有細微差異）:")
        for place, addr in by_name_hits:
            print(f"[import]     {place}  {addr[:50]}")
    if missing:
        print(f"[import] ⚠ {len(missing)} 個地址查無座標，需另跑 geocode.py:")
        for place, addr in missing:
            print(f"[import]     [{place}] {addr}")
    else:
        print("[import] 所有地址都有座標，不需要 geocode。")

    raw_payload = {
        "_meta": {
            "source": "澳門衛生局",
            "sourceUrl": "https://www.ssm.gov.mo/",
            "originalSource": "澳門特別行政區政府衛生局 — 從事私人醫務活動專業人員名冊",
            "note": "資料直接採集自衛生局官方登記系統。最新資訊請以官方為準。",
            "scrapedAt": args.scraped_at,
            "count": len(records),
            "withLicense": sum(1 for r in records if r["licenseNo"]),
            "importedFrom": args.csv.name,
        },
        "records": records,
    }
    args.raw_out.parent.mkdir(parents=True, exist_ok=True)
    args.raw_out.write_text(json.dumps(raw_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[import] 已寫入 {args.raw_out}")

    geo_payload = {
        "_meta": {
            "geocodedAt": args.scraped_at,
            "totalAddresses": len(resolved) + len(missing),
            "resolved": len(resolved),
            "reusedFrom": str(args.data),
        },
        "addresses": [
            {"address": addr, "placeName": "", "lng": lng, "lat": lat}
            for addr, (lng, lat) in resolved.items()
        ],
    }
    args.geocoded_out.write_text(json.dumps(geo_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[import] 已寫入 {args.geocoded_out}")
    print("\n[import] 下一步：python scripts/build_data.py && python scripts/validate.py --baseline <舊 data.json>")


if __name__ == "__main__":
    main()
