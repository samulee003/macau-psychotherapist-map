#!/usr/bin/env python3
"""
probe_opendata.py — 偵察第二輪：data.gov.mo 的目錄裡有沒有我們要的名冊？

背景：
    probe_sources.py 的結果（run #1）非常明確 ——
    五個 gov.mo 頁面（含另一個網域 cps.gov.mo）在 GitHub 機房 IP 上
    全部 HTTP 403 + Cloudflare challenge，純 HTTP 與真 Chrome 皆然。
    唯一的例外是 data.gov.mo：純 HTTP 回 200，沒有被擋。

    所以開放數據平台是目前唯一還開著的門。本腳本只做一件事：
    問這扇門後面到底有沒有衛生局的專業人員名冊。

    先抓首頁找出 API 線索，再依序試常見的開放資料平台 API 形態
    （CKAN / DKAN / 自訂），最後用關鍵字查詢。

用法：
    python scripts/probe_opendata.py

輸出為純文字報告。永遠以 0 退出（偵察不是測試），以免遮蔽報告。
"""

import json
import re
import sys

import requests

BASE = "https://data.gov.mo"

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)

# 常見開放資料平台的 API 形態，逐一試探。
# 命中哪一種決定了後續怎麼接資料，所以全部都要試、都要印出回應開頭。
API_CANDIDATES = [
    ("CKAN 套件搜尋", f"{BASE}/api/3/action/package_search?q=%E8%A1%9B%E7%94%9F%E5%B1%80"),
    ("CKAN 套件清單", f"{BASE}/api/3/action/package_list"),
    ("CKAN 機構清單", f"{BASE}/api/3/action/organization_list"),
    ("通用 datasets", f"{BASE}/api/datasets"),
    ("v1 datasets", f"{BASE}/api/v1/datasets"),
    ("v2 datasets", f"{BASE}/api/v2/datasets"),
    ("REST dataset 列表", f"{BASE}/api/dataset"),
    ("目錄頁（HTML）", f"{BASE}/dataset"),
    ("搜尋頁（HTML）", f"{BASE}/search?q=%E5%BF%83%E7%90%86"),
]

# 名冊相關關鍵字 —— 出現任何一個都值得人工細看
KEYWORDS = ["心理治療", "治療師", "醫務", "醫療人員", "專業人員", "衛生局", "註冊", "名冊", "執業"]


def decode(resp) -> str:
    """
    正確解碼回應內容。

    requests 對沒有明確 charset 的回應會猜 ISO-8859-1，中文會變亂碼
    （probe_sources.py 第一版就踩到，data.gov.mo 的標題印成一串 æ¾³é）。
    這裡優先用 apparent_encoding，再退回 utf-8。
    """
    try:
        resp.encoding = resp.apparent_encoding or "utf-8"
        return resp.text
    except Exception:
        return resp.content.decode("utf-8", errors="replace")


def title_of(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    return m.group(1).strip()[:120] if m else ""


def hits(text: str) -> list:
    return [k for k in KEYWORDS if k in text]


def session():
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA,
        "Accept-Language": "zh-HK,zh;q=0.9,en;q=0.8",
        "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
    })
    return s


# ----------------------------------------------------------------

def probe_homepage(s):
    print("=" * 70)
    print("  第一步：首頁，找出 API / 目錄的線索")
    print("=" * 70)
    try:
        r = s.get(BASE + "/", timeout=30)
    except Exception as e:
        print(f"  連線失敗 — {e.__class__.__name__}: {e}")
        return
    html = decode(r)
    print(f"  HTTP {r.status_code} | {len(r.content)} bytes")
    print(f"  標題: {title_of(html)!r}")

    found = hits(html)
    print(f"  首頁含關鍵字: {found if found else '（無）'}")

    # 找出可能的 API / 資料集連結
    links = set(re.findall(r'(?:href|src)="([^"]+)"', html))
    interesting = sorted({
        l for l in links
        if any(tok in l.lower() for tok in ("api", "dataset", "search", "catalog", "resource"))
    })
    print(f"\n  可能相關的連結（{len(interesting)} 條）:")
    for l in interesting[:40]:
        print(f"    {l}")
    if not interesting:
        print("    （無 —— 首頁可能是 JS 動態渲染，連結不在 HTML 裡）")


def probe_apis(s):
    print("\n" + "=" * 70)
    print("  第二步：逐一試探 API 形態")
    print("=" * 70)
    for label, url in API_CANDIDATES:
        print(f"\n[{label}]\n  {url}")
        try:
            r = s.get(url, timeout=30)
        except Exception as e:
            print(f"  失敗 — {e.__class__.__name__}: {e}")
            continue

        body = decode(r)
        ctype = r.headers.get("Content-Type", "")
        print(f"  HTTP {r.status_code} | {len(r.content)} bytes | {ctype}")

        if r.status_code >= 400:
            print("  判定: ✗ 不存在或不可用")
            continue

        found = hits(body)
        # JSON 回應嘗試解析出結構，比印一堆原文有用
        if "json" in ctype.lower():
            try:
                data = json.loads(body)
                if isinstance(data, dict):
                    print(f"  JSON 鍵: {list(data.keys())[:12]}")
                    result = data.get("result")
                    if isinstance(result, dict):
                        print(f"  result 鍵: {list(result.keys())[:12]}")
                        if "count" in result:
                            print(f"  搜尋結果筆數: {result['count']}")
                    elif isinstance(result, list):
                        print(f"  result 筆數: {len(result)}；前 10 筆: {result[:10]}")
                elif isinstance(data, list):
                    print(f"  陣列長度: {len(data)}；前 5 筆: {json.dumps(data[:5], ensure_ascii=False)[:400]}")
            except Exception as e:
                print(f"  （JSON 解析失敗: {e.__class__.__name__}）")

        print(f"  含關鍵字: {found if found else '（無）'}")
        print(f"  回應開頭: {body[:300].strip()!r}")
        if found:
            print("  判定: ★ 值得細看")
        else:
            print("  判定: ✓ 可存取，但看不到名冊相關字樣")


def main():
    print("probe_opendata.py — data.gov.mo 目錄偵察\n")
    print("前提：probe_sources.py 已證實 ssm.gov.mo 與 cps.gov.mo 在 GitHub")
    print("機房 IP 上全數 403（Cloudflare），data.gov.mo 是唯一可達的來源。\n")
    s = session()
    probe_homepage(s)
    probe_apis(s)
    print("\n" + "=" * 70)
    print("  偵察結束。任何一列判定為「★ 值得細看」代表開放資料平台可能有名冊；")
    print("  若全部都是「看不到名冊相關字樣」，則自動化採集這條路已走完。")
    print("=" * 70)
    sys.exit(0)


if __name__ == "__main__":
    main()
