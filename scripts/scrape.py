#!/usr/bin/env python3
"""
scrape.py — 抓取澳門註冊心理治療師執業資料。

資料來源：澳門特別行政區政府衛生局 — 從事私人醫務活動專業人員名冊
    https://www.ssm.gov.mo/pubssmweb/Utlap/frmUtlapLic.aspx?licode=11&t=

說明：
    本腳本使用 Playwright 模擬真實瀏覽器訪問衛生局的 ASP.NET 頁面，
    繞過 Cloudflare Turnstile 防爬蟲驗證，自動進行分頁爬取，並將 116 筆心理治療師執業資料完整抓回。

輸出：scripts/raw.json（後續由 build_data.py 加工）
"""

import asyncio
import json
import re
import sys
import time
from pathlib import Path
from playwright.async_api import async_playwright

URL = "https://www.ssm.gov.mo/pubssmweb/Utlap/frmUtlapLic.aspx?licode=11&t="
OUTPUT = Path(__file__).resolve().parent / "raw.json"

# ----------------------------------------------------------------
# 欄位處理工具
# ----------------------------------------------------------------

def normalize_license(raw: str) -> str:
    """正規化牌照號：補 dash。空字串則保留空。"""
    if not raw:
        return ""
    s = raw.strip().upper()
    m = re.match(r"^(T|PE|PI)-?(\d{3,5})$", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    return s


def clean_phone(raw: str) -> str:
    """清理電話欄：去除空白，補澳門區碼格式。"""
    if not raw:
        return ""
    # 去除所有非數字字元
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 8 and not digits.startswith("853"):
        return f"+853 {digits[:4]} {digits[4:]}"
    return raw.strip()


async def scrape_data():
    async with async_playwright() as p:
        print("[scrape] 正在啟動隱身模式瀏覽器繞過 Cloudflare...")
        browser = await p.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
            ignore_default_args=["--enable-automation"]
        )
        context = await browser.new_context()
        page = await context.new_page()
        
        print(f"[scrape] 正在加載 {URL}...")
        await page.goto(URL, timeout=60000)
        
        # 等待繞過 Cloudflare
        print("[scrape] 等待繞過 Cloudflare 驗證與載入表格...")
        try:
            await page.wait_for_selector("#MainGrid", timeout=45000)
            print("[scrape] 成功繞過 Cloudflare，表格已加載！")
        except Exception as e:
            # 失敗時截圖並報錯
            screenshot_path = Path(__file__).resolve().parent / "cloudflare_timeout.png"
            await page.screenshot(path=str(screenshot_path))
            print(f"[scrape] ✗ 載入表格超時。已將偵錯截圖保存至 {screenshot_path}")
            await browser.close()
            raise e

        # 開始分頁爬取
        records = []
        
        # 我們將循環爬取所有 6 頁
        for current_page in range(1, 7):
            print(f"[scrape] 正在抓取第 {current_page} 頁的資料...")
            await page.wait_for_selector("#MainGrid tr", timeout=10000)
            
            rows = await page.query_selector_all("#MainGrid tr")
            # 扣除表頭列
            print(f"[scrape] 本頁包含 {len(rows) - 1} 筆記錄")
            
            for row in rows[1:]:
                cells = await row.query_selector_all("td")
                if len(cells) < 8:
                    continue
                
                # 提取各單元格 HTML/文字
                lic_type = (await cells[1].inner_html()).strip().replace("<br>", "\n").replace("<br/>", "\n")
                lic_no = (await cells[2].text_content()).strip()
                category_raw = (await cells[3].inner_html()).strip().replace("<br>", "\n").replace("<br/>", "\n")
                name_raw = (await cells[4].inner_html()).strip().replace("<br>", "\n").replace("<br/>", "\n")
                address_raw = (await cells[5].inner_html()).strip().replace("<br>", "\n").replace("<br/>", "\n")
                phone_raw = (await cells[6].text_content()).strip()
                hours_raw = (await cells[7].inner_html()).strip().replace("<br>", "\n").replace("<br/>", "\n")
                
                # 1. 牌照號與分類
                lic_no = normalize_license(lic_no)
                lic_type = lic_type.split("\n")[0].strip()
                category = category_raw.split("\n")[0].strip()
                
                # 2. 姓名切分 (中文 \n 英文)
                name_parts = [p.strip() for p in name_raw.split("\n") if p.strip()]
                name_zh = name_parts[0] if len(name_parts) > 0 else ""
                name_en = name_parts[1] if len(name_parts) > 1 else ""
                
                # 3. 地址切分 (中文 \n 葡文)
                address_parts = [p.strip() for p in address_raw.split("\n") if p.strip()]
                address_zh_full = address_parts[0] if len(address_parts) > 0 else ""
                address_pt = address_parts[1] if len(address_parts) > 1 else ""
                
                # 4. 地址二次整理：從 "機構名 - 地址" 中拆出機構名與實際地址
                place_name = ""
                address_zh = ""
                if " - " in address_zh_full:
                    addr_split = address_zh_full.split(" - ", 1)
                    place_name = addr_split[0].strip()
                    address_zh = addr_split[1].strip()
                else:
                    place_name = address_zh_full.strip()
                    address_zh = ""
                
                # 清洗尾隨的 dash
                place_name = place_name.rstrip(" -—").strip()
                address_zh = address_zh.rstrip(" -—").strip()
                address_pt = address_pt.rstrip(" -—").strip()
                
                # 5. 電話與時間
                phone = clean_phone(phone_raw)
                
                hours_parts = [p.strip() for p in hours_raw.split("\n") if p.strip()]
                hours = " / ".join(hours_parts) if hours_parts else ""
                
                records.append({
                    "licenseNo": lic_no,
                    "licenseType": lic_type,
                    "categoryRaw": f"{category}Psicólogo",
                    "nameZh": name_zh,
                    "nameEn": name_en,
                    "placeName": place_name,
                    "addressZh": address_zh,
                    "addressPt": address_pt,
                    "phone": phone,
                    "hours": hours,
                })
            
            # 若不是最後一頁，點擊下一頁按鈕
            if current_page < 6:
                next_page = current_page + 1
                next_btn_id = f"#rptPager_lnkPage_{next_page}"
                print(f"[scrape] 點擊前往第 {next_page} 頁 ({next_btn_id})...")
                await page.click(next_btn_id)
                # 等待 PostBack 加載完成 (等待 3 秒讓表格更新)
                await page.wait_for_timeout(3000)
                
        print(f"[scrape] 抓取完成！共取得 {len(records)} 筆記錄")
        await browser.close()
        return records


def main():
    print("[scrape] 開始抓取官方衛生局心理治療師名冊...")
    try:
        records = asyncio.run(scrape_data())
    except Exception as e:
        print(f"[scrape] ✗ 抓取失敗: {e}")
        sys.exit(1)

    payload = {
        "_meta": {
            "source": "澳門衛生局牌照註冊資料查詢網頁",
            "sourceUrl": URL,
            "originalSource": "澳門特別行政區政府衛生局 — 從事私人醫務活動專業人員名冊",
            "note": "資料直接採集自衛生局官方登記系統。最新資訊請以官方為準。",
            "scrapedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "count": len(records),
            "withLicense": sum(1 for r in records if r["licenseNo"]),
        },
        "records": records,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[scrape] 已成功寫入原始資料到 {OUTPUT}")


if __name__ == "__main__":
    main()
