#!/usr/bin/env python3
"""
validate.py — 校驗 data.json 的完整性與一致性。

檢查項目：
    1. 結構完整性（必填欄位）
    2. 缺座標的地點（需人工補）
    3. 孤立的關聯（practice 指向不存在的 therapist/location）
    4. 重複的治療師 / 地點
    5. 座標是否落在澳門合理範圍
    6. 分類是否合法
    7. （可選）與基準線比較的資料漂移守衛：
       --baseline <舊 data.json 路徑>
       若治療師或地點數量相較基準線驟減超過 30%，判定為採集異常
       （如官網改版導致解析失敗），以錯誤退出，阻止自動更新覆蓋好資料。

非零退出碼代表有錯誤；警告不影響退出碼。
"""

import argparse
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "data.json"

MACAO_BBOX = {
    "lng_min": 113.52, "lng_max": 113.60,
    "lat_min": 22.10, "lat_max": 22.22,
}
VALID_CATEGORIES = {"hospital", "med_center", "psych_center", "social", "university", "gov", "other"}


# 資料漂移守衛：數量相較基準線驟減超過此比例即判定採集異常
DRIFT_MAX_DROP_RATIO = 0.30


def check_drift(baseline_path, therapists, locations):
    """與基準線比較數量，回傳錯誤訊息清單（正常時為空）。"""
    errors = []
    path = Path(baseline_path)
    if not path.exists():
        # 無基準線（如首次執行）不視為錯誤
        print(f"[validate] 基準線不存在，略過漂移檢查: {path}")
        return errors

    try:
        old = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        print(f"[validate] 基準線讀取失敗，略過漂移檢查: {e}")
        return errors

    for label, old_count, new_count in [
        ("治療師", len(old.get("therapists", [])), len(therapists)),
        ("地點", len(old.get("locations", [])), len(locations)),
    ]:
        if old_count == 0:
            continue
        if new_count == 0:
            errors.append(f"資料漂移：{label} 數量歸零（基準線 {old_count}），採集很可能失敗")
        elif (old_count - new_count) / old_count > DRIFT_MAX_DROP_RATIO:
            errors.append(
                f"資料漂移：{label} 數量由 {old_count} 驟減至 {new_count}"
                f"（超過 {int(DRIFT_MAX_DROP_RATIO * 100)}% 上限），疑似官網改版導致解析異常"
            )
    return errors


def main():
    parser = argparse.ArgumentParser(description="校驗 data.json")
    parser.add_argument("--baseline", help="舊版 data.json 路徑，啟用資料漂移守衛")
    args = parser.parse_args()

    if not DATA.exists():
        print(f"[validate] ✗ 找不到 {DATA}")
        sys.exit(2)

    data = json.loads(DATA.read_text(encoding="utf-8"))
    therapists = data.get("therapists", [])
    locations = data.get("locations", [])
    practices = data.get("practices", [])

    errors = []
    warnings = []

    t_ids = {t["id"] for t in therapists}
    l_ids = {l["id"] for l in locations}

    # 1. 治療師必填欄位
    for t in therapists:
        if not t.get("id"):
            errors.append(f"治療師缺 id: {t}")
        if not t.get("nameZh") and not t.get("nameEn"):
            warnings.append(f"治療師無姓名: {t.get('id')}")
        if t.get("id"):
            tid = t["id"]
            if sum(1 for x in therapists if x.get("id") == tid) > 1:
                errors.append(f"治療師 id 重複: {tid}")

    # 2. 地點必填欄位 + 座標
    seen_loc = set()
    for l in locations:
        if not l.get("id"):
            errors.append(f"地點缺 id: {l}")
            continue
        if l["id"] in seen_loc:
            errors.append(f"地點 id 重複: {l['id']}")
        seen_loc.add(l["id"])

        if not l.get("name"):
            warnings.append(f"地點缺名稱: {l['id']}")
        if not l.get("addressZh"):
            warnings.append(f"地點缺地址: {l['id']} ({l.get('name')})")

        has_coord = l.get("lng") is not None and l.get("lat") is not None
        if not has_coord:
            warnings.append(f"地點缺座標（無法在地圖顯示）: {l['id']} — {l.get('name')}")
        else:
            lng, lat = l["lng"], l["lat"]
            if not (MACAO_BBOX["lng_min"] <= lng <= MACAO_BBOX["lng_max"]
                    and MACAO_BBOX["lat_min"] <= lat <= MACAO_BBOX["lat_max"]):
                warnings.append(
                    f"地點座標超出澳門範圍（可能不準）: {l['id']} — ({lng},{lat})"
                )

        if l.get("category") not in VALID_CATEGORIES:
            errors.append(f"地點分類不合法: {l['id']} category={l.get('category')}")

    # 3. 關聯完整性
    for p in practices:
        if p.get("therapistId") not in t_ids:
            errors.append(f"關聯指向不存在的治療師: {p.get('therapistId')}")
        if p.get("locationId") not in l_ids:
            errors.append(f"關聯指向不存在的地點: {p.get('locationId')}")

    # 4. 無關聯的孤兒
    locs_in_practice = {p["locationId"] for p in practices}
    therapists_in_practice = {p["therapistId"] for p in practices}
    for l in locations:
        if l["id"] not in locs_in_practice:
            warnings.append(f"地點無任何治療師關聯: {l['id']} — {l.get('name')}")
    for t in therapists:
        if t["id"] not in therapists_in_practice:
            warnings.append(f"治療師無任何執業地點: {t.get('id')} — {t.get('nameZh')}")

    # 5. 資料漂移守衛（僅在提供 --baseline 時執行）
    if args.baseline:
        errors.extend(check_drift(args.baseline, therapists, locations))

    # 報告
    print("=" * 56)
    print("  data.json 校驗報告")
    print("=" * 56)
    stats = data.get("meta", {}).get("stats", {})
    print(f"  治療師: {len(therapists)}  地點: {len(locations)}  關聯: {len(practices)}")
    geocoded = sum(1 for l in locations if l.get("lng") is not None)
    print(f"  已定位地點: {geocoded}/{len(locations)}")
    print("-" * 56)

    if errors:
        print(f"\n✗ 錯誤 ({len(errors)}):")
        for e in errors:
            print(f"  • {e}")

    if warnings:
        print(f"\n⚠ 警告 ({len(warnings)}):")
        for w in warnings:
            print(f"  • {w}")

    if not errors and not warnings:
        print("\n✓ 一切正常，無錯誤無警告。")
    elif not errors:
        print(f"\n✓ 無錯誤（{len(warnings)} 項警告可忽略或後續處理）")

    print("=" * 56)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
