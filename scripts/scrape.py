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


async def launch_browser(p):
    """
    啟動瀏覽器。優先使用系統安裝的真・Google Chrome。

    Cloudflare 會比對瀏覽器指紋，Playwright 內建的 Chromium 與真正的
    Chrome 在建構標記、字型清單、codec 支援上都不同，較容易被判定為
    自動化工具。GitHub Actions 的 runner 預裝了 Google Chrome，優先用它；
    本機若沒裝則退回內建 Chromium。

    注意：**不要**覆寫 User-Agent。Cloudflare 會交叉比對 UA 與
    Client Hints（sec-ch-ua）等標頭，硬塞一個版本號不一致的 UA
    反而是明確的機器人特徵。讓瀏覽器報自己真實的身分即可。
    """
    launch_kwargs = {
        "headless": False,  # 搭配 workflow 的 xvfb-run 使用
        "args": ["--disable-blink-features=AutomationControlled"],
        "ignore_default_args": ["--enable-automation"],
    }
    try:
        browser = await p.chromium.launch(channel="chrome", **launch_kwargs)
        print("[scrape] 使用系統安裝的 Google Chrome")
        return browser
    except Exception as e:
        print(f"[scrape] 找不到 Google Chrome（{e.__class__.__name__}），改用內建 Chromium")
        return await p.chromium.launch(**launch_kwargs)


async def scrape_data():
    async with async_playwright() as p:
        print("[scrape] 正在啟動隱身模式瀏覽器繞過 Cloudflare...")
        browser = await launch_browser(p)
        # 與 workflow 的 xvfb 螢幕（1280x1024）一致，並宣告澳門的
        # 語言與時區 —— 預設的 en-US / UTC 與澳門政府網站的訪客不符。
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1024},
            locale="zh-HK",
            timezone_id="Asia/Macau",
        )
        page = await context.new_page()

        print(f"[scrape] 正在加載 {URL}...")
        await page.goto(URL, timeout=60000)

        # 等待繞過 Cloudflare。
        # challenge 通常 5–10 秒放行；給到 90 秒是為了容忍機房 IP 被要求
        # 做較重的運算挑戰。每 15 秒回報一次頁面標題，讓 log 看得出是
        # 「一直卡在 challenge」還是「過了但表格沒出現」。
        print("[scrape] 等待繞過 Cloudflare 驗證與載入表格...")
        try:
            deadline = time.monotonic() + 90
            while True:
                try:
                    await page.wait_for_selector("#MainGrid", timeout=15000)
                    break
                except Exception:
                    if time.monotonic() >= deadline:
                        raise
                    print(f"[scrape]   仍在等待… 目前標題: {await page.title()!r}")
            print("[scrape] 成功繞過 Cloudflare，表格已加載！")
        except Exception as e:
            # 失敗時保存偵錯素材並報錯。
            # 光看「timeout waiting for #MainGrid」無法分辨三種成因：
            # Cloudflare 擋下、官網改版換了表格 id、或整頁 5xx。
            # 截圖 + HTML + 標題/網址三者一起看才判斷得出來。
            # CI 會把這些檔案上傳為 artifact（見 update_data.yml）。
            debug_dir = Path(__file__).resolve().parent
            screenshot_path = debug_dir / "cloudflare_timeout.png"
            html_path = debug_dir / "cloudflare_timeout.html"
            try:
                await page.screenshot(path=str(screenshot_path), full_page=True)
                html_path.write_text(await page.content(), encoding="utf-8")
                print(f"[scrape] 頁面標題: {await page.title()!r}")
                print(f"[scrape] 最終網址: {page.url}")
            except Exception as dump_err:
                # 偵錯素材存不下來不應蓋掉原始錯誤
                print(f"[scrape] ⚠ 偵錯素材保存失敗: {dump_err}")
            print(f"[scrape] ✗ 載入表格超時。偵錯素材: {screenshot_path}, {html_path}")
            await browser.close()
            raise e

        # 開始分頁爬取
        records = []
        current_page = 1
        seen_page_signatures = set()

        while True:
            print(f"[scrape] 正在抓取第 {current_page} 頁的資料...")
            await page.wait_for_selector("#MainGrid tr", timeout=10000)
            
            rows = await page.query_selector_all("#MainGrid tr")
            # 扣除表頭列
            print(f"[scrape] 本頁包含 {len(rows) - 1} 筆記錄")
            page_licenses = []
            
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
                page_licenses.append(lic_no)
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

            page_signature = tuple(page_licenses)
            if page_signature in seen_page_signatures:
                raise RuntimeError(f"分頁內容未更新（第 {current_page} 頁），停止以避免重複資料")
            seen_page_signatures.add(page_signature)

            # 依頁碼按鈕是否存在動態判斷是否還有下一頁，不假設固定頁數。
            next_page = current_page + 1
            next_btn_id = f"#rptPager_lnkPage_{next_page}"
            next_btn = page.locator(next_btn_id)
            if await next_btn.count() == 0 or not await next_btn.first.is_visible():
                break

            print(f"[scrape] 點擊前往第 {next_page} 頁 ({next_btn_id})...")
            await next_btn.first.click()
            # 等待 PostBack 加載完成 (等待 3 秒讓表格更新)
            await page.wait_for_timeout(3000)
            current_page = next_page
                
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
            "source": "澳門衛生局",
            "sourceUrl": "https://www.ssm.gov.mo/",
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
