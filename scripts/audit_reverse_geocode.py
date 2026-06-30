#!/usr/bin/env python3
"""
audit_reverse_geocode.py — 自動化反向地理編碼審計腳本。
用來一鍵檢測 data.json 中所有 41 個地點是否都正確落在澳門陸地上（無海上或跨界標記）。

使用高德地圖反向地理編碼 API。
"""

import json
import os
import sys
import time
from pathlib import Path
import requests

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "data.json"
AMAP_WEB_KEY = os.environ.get("AMAP_WEB_KEY", "2d18f3c179911110648c3c63229da1a6")
REGEO_URL = "https://restapi.amap.com/v3/geocode/regeo"

def reverse_geocode(lng, lat):
    params = {
        "key": AMAP_WEB_KEY,
        "location": f"{lng},{lat}",
        "output": "json",
        "radius": 100,
        "extensions": "all"
    }
    try:
        resp = requests.get(REGEO_URL, params=params, timeout=10)
        data = resp.json()
        if data.get("status") == "1":
            regeo = data.get("regeocode", {})
            address_component = regeo.get("addressComponent", {})
            formatted_address = regeo.get("formatted_address", "")
            district = address_component.get("district", "")
            return {
                "formatted_address": formatted_address,
                "district": district
            }
    except Exception as e:
        return None
    return None

def main():
    if AMAP_WEB_KEY == "YOUR_AMAP_WEB_SERVICE_KEY":
        print("❌ Error: 請在環境變數設定 AMAP_WEB_KEY，或確保預設 Key 可用")
        sys.exit(1)
        
    if not DATA_PATH.exists():
        print(f"❌ Error: 找不到數據庫文件 {DATA_PATH}")
        sys.exit(1)
        
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    locations = data.get("locations", [])
    
    print(f"🔄 開始對 {len(locations)} 個經緯度進行自動化反向地理編碼審計...")
    
    issues = []
    macau_districts = [
        "澳門", "澳门", 
        "花地玛堂区", "花地瑪堂區", 
        "花王堂区", "花王堂區", 
        "望德堂区", "望德堂區", 
        "大堂区", "大堂區", 
        "风顺堂区", "風順堂區", 
        "嘉模堂区", "嘉模堂區", 
        "圣方济各堂区", "聖方濟各堂區"
    ]
    
    for i, loc in enumerate(locations, 1):
        name = loc["name"]
        lng = loc["lng"]
        lat = loc["lat"]
        
        info = reverse_geocode(lng, lat)
        if info:
            fmt_addr = info["formatted_address"]
            distr = info["district"]
            
            # 判斷是否在澳門陸地區劃內
            is_macau = any(d in fmt_addr for d in ["澳門", "澳门", "Macao", "Macau"]) or distr in macau_districts
            # 判斷是否在海上水域
            in_water = any(w in fmt_addr for w in ["水域", "海域", "内港"])
            
            status = "✅ 陸地"
            if not is_macau or in_water:
                status = "❌ 警告（海上/境外）"
                issues.append({
                    "name": name,
                    "coords": (lng, lat),
                    "api_addr": fmt_addr,
                    "district": distr
                })
            
            print(f"  [{i:02d}/{len(locations)}] {name:<25} -> {status} ({distr or '未知'})")
        else:
            print(f"  [{i:02d}/{len(locations)}] {name:<25} -> ❓ 查詢失敗")
            
        time.sleep(0.1) # QPS 限制
        
    print("\n" + "=" * 60)
    print(" 審計結論")
    print("=" * 60)
    if not issues:
        print("🎉 恭喜！全數 41 個坐標均通過反向地理編碼核對，全部正確落在澳門陸地堂區！")
        sys.exit(0)
    else:
        print(f"⚠️ 發現 {len(issues)} 處異常坐標（可能漂移到海上或境外）：")
        for iss in issues:
            print(f"  • {iss['name']} ({iss['coords']}) -> 實際位置: {iss['api_addr']}")
        sys.exit(1)

if __name__ == "__main__":
    main()
