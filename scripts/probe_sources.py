#!/usr/bin/env python3
"""
probe_sources.py — 偵察：哪些資料來源路徑沒有被 Cloudflare 擋？

背景：
    scrape.py 目前打 pubssmweb/Utlap/frmUtlapLic.aspx，在 GitHub Actions 的
    機房 IP 上被 Cloudflare 攔在 challenge 頁（標題 'Just a moment...' /
    '請稍候...'），強化瀏覽器指紋後仍無法通過（見 run #12）。

    本腳本不修資料管線，只做偵察：把所有候選入口各打一次，回報
    HTTP 狀態、最終網址、頁面標題、是否為 challenge 頁、以及頁面裡有沒有
    名冊的特徵字串。目的是一次回答「有沒有任何一條路是通的」。

    先用純 HTTP（requests）試，再用 Playwright 真瀏覽器試 —— 兩者結果不同
    本身就是資訊：純 HTTP 過得了代表可以直接抓，不必開瀏覽器。

用法：
    python scripts/probe_sources.py

輸出為純文字報告，供 CI log 直接閱讀。本腳本永遠以 0 退出（偵察不是測試），
以免遮蔽報告。
"""

import asyncio
import re
import sys

import requests

# ----------------------------------------------------------------
# 候選來源
# ----------------------------------------------------------------

CANDIDATES = [
    # 目前 scrape.py 實際使用的（已知被擋，作為對照組）
    ("現行採集目標",
     "https://www.ssm.gov.mo/pubssmweb/Utlap/frmUtlapLic.aspx?licode=11&t="),

    # data.json 的 meta 記錄的「官方來源」，與上面不是同一頁
    ("data.json 記錄的官方來源",
     "https://www.ssm.gov.mo/pubssmweb/register/frmShowRegister.aspx"),

    # 衛生局入口網（另一個應用路徑，未必同一套防護）
    ("衛生局入口網",
     "https://www.ssm.gov.mo/portal/"),

    # 私人醫務活動資訊專頁
    ("私人醫務活動資訊",
     "https://www.ssm.gov.mo/portal1/pcainfo/OqMudr3fsHsHAQhaE1Qrg?lang=ch"),

    # 醫療專業委員會 —— 另一個網域，負責專業資格與註冊，可能自行公佈名冊
    ("醫療專業委員會（另一網域）",
     "https://www.cps.gov.mo/"),

    # 澳門政府開放數據平台
    ("政府開放數據平台",
     "https://data.gov.mo/"),
]

# challenge 頁的標題特徵（Cloudflare 中英文版）
CHALLENGE_TITLES = ("just a moment", "請稍候", "请稍候", "attention required", "checking your browser")

# 名冊頁應該出現的內容特徵
REGISTRY_MARKERS = ("MainGrid", "心理治療師", "治療師", "註冊", "名冊", "licode")

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)


def extract_title(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    return m.group(1).strip()[:120] if m else ""


def is_challenge(title: str) -> bool:
    t = title.lower()
    return any(marker in t for marker in CHALLENGE_TITLES)


def found_markers(html: str) -> list:
    return [m for m in REGISTRY_MARKERS if m in html]


def verdict(status, title, html) -> str:
    if status is None:
        return "連線失敗"
    if is_challenge(title):
        return "✗ Cloudflare challenge"
    if status >= 400:
        return f"✗ HTTP {status}"
    markers = found_markers(html)
    if markers:
        return f"✓ 通過，且含名冊特徵: {markers}"
    return "✓ 通過（但頁面不含名冊特徵，可能只是入口頁）"


# ----------------------------------------------------------------
# 第一輪：純 HTTP
# ----------------------------------------------------------------

def probe_http():
    print("=" * 70)
    print("  第一輪：純 HTTP（requests，不開瀏覽器）")
    print("=" * 70)
    session = requests.Session()
    session.headers.update({
        "User-Agent": UA,
        "Accept-Language": "zh-HK,zh;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    for label, url in CANDIDATES:
        print(f"\n[{label}]\n  {url}")
        try:
            r = session.get(url, timeout=30, allow_redirects=True)
            title = extract_title(r.text)
            print(f"  HTTP {r.status_code} | {len(r.content)} bytes")
            if r.url != url:
                print(f"  最終網址: {r.url}")
            print(f"  標題: {title!r}")
            print(f"  判定: {verdict(r.status_code, title, r.text)}")
        except Exception as e:
            print(f"  判定: 連線失敗 — {e.__class__.__name__}: {e}")


# ----------------------------------------------------------------
# 第二輪：真瀏覽器
# ----------------------------------------------------------------

async def probe_browser():
    print("\n" + "=" * 70)
    print("  第二輪：真瀏覽器（Playwright + Chrome，等 challenge 最多 30 秒）")
    print("=" * 70)
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("\n  未安裝 playwright，略過第二輪。")
        return

    async with async_playwright() as p:
        launch_kwargs = {
            "headless": False,
            "args": ["--disable-blink-features=AutomationControlled"],
            "ignore_default_args": ["--enable-automation"],
        }
        try:
            browser = await p.chromium.launch(channel="chrome", **launch_kwargs)
            print("\n  使用系統安裝的 Google Chrome")
        except Exception:
            browser = await p.chromium.launch(**launch_kwargs)
            print("\n  使用 Playwright 內建 Chromium")

        context = await browser.new_context(
            viewport={"width": 1280, "height": 1024},
            locale="zh-HK",
            timezone_id="Asia/Macau",
        )
        for label, url in CANDIDATES:
            print(f"\n[{label}]\n  {url}")
            page = await context.new_page()
            try:
                resp = await page.goto(url, timeout=45000, wait_until="domcontentloaded")
                status = resp.status if resp else None
                # 給 challenge 一點時間自行放行
                for _ in range(6):
                    title = await page.title()
                    if not is_challenge(title):
                        break
                    await page.wait_for_timeout(5000)
                title = await page.title()
                html = await page.content()
                print(f"  HTTP {status} | {len(html)} chars")
                if page.url != url:
                    print(f"  最終網址: {page.url}")
                print(f"  標題: {title!r}")
                print(f"  判定: {verdict(status, title, html)}")
            except Exception as e:
                print(f"  判定: 失敗 — {e.__class__.__name__}: {str(e)[:200]}")
            finally:
                await page.close()

        await browser.close()


def main():
    print("probe_sources.py — 來源可達性偵察\n")
    probe_http()
    try:
        asyncio.run(probe_browser())
    except Exception as e:
        print(f"\n第二輪整體失敗: {e.__class__.__name__}: {e}")
    print("\n" + "=" * 70)
    print("  偵察結束。任何一列判定為「✓ 通過，且含名冊特徵」即為可用來源。")
    print("=" * 70)
    # 偵察腳本永遠成功退出，避免遮蔽上面的報告
    sys.exit(0)


if __name__ == "__main__":
    main()
