#!/usr/bin/env python3
"""扫描机会：App Store 高价订阅新品雷达。

每天抓取指定国家各分类的免费榜和畅销榜，补充应用信息与内购价格，
筛出“畅销榜远高于免费榜、内购单价高、上线不久”的产品，
写入 数据/latest.js 供「商业变现」页面的「扫描机会」展示，并推送到飞书。

用法：
  python3 scout.py               抓取 + 更新数据 + 推送飞书
  python3 scout.py --no-fetch    只用已有数据重新生成 latest.js
  python3 scout.py --no-notify   不推送飞书
"""

import argparse
import base64
import datetime as dt
import hashlib
import hmac
import html
import hashlib
import json
import math
import os
import re
import sqlite3
import ssl
import subprocess
import sys
import time
import tomllib
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
DATA_DIR = ROOT / "数据"
DB_PATH = DATA_DIR / "scout.db"
LATEST_JS = DATA_DIR / "latest.js"
# 人工根据应用描述写的中文简介，优先于自动摘录
SUMMARIES = ROOT / "summaries.json"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
CHARTS = {"free": "topfreeapplications", "grossing": "topgrossingapplications"}
# 旧版 RSS 接口单次最多返回 100 条
CHART_LIMIT = 100
HISTORY_DAYS = 30
# 「全部应用」总榜的分类编号，用来把各分类名次换算成可横向比较的总榜等效名次
OVERALL = "36"
FIT_DAYS = 14
# 变现效率攒满这么多天后改用多日平均，之前只用当天
EFF_DAYS = 7
# 云端服务器用 UTC，日期和生成时间统一按北京时间记
BJT = dt.timezone(dt.timedelta(hours=8))
# ios = App Store；gp = Google Play，榜单用 gp_fetch.mjs（Node）抓，数据库和输出文件各自独立
STORE = "ios"
LATEST_VAR = "SCOUT_DATA"
GP_FETCH = ROOT / "gp_fetch.mjs"


def use_store(store):
    global STORE, DB_PATH, LATEST_JS, LATEST_VAR, CHART_LIMIT, OVERALL
    STORE = store
    if store == "gp":
        DB_PATH = DATA_DIR / "gp.db"
        LATEST_JS = DATA_DIR / "latest_gp.js"
        LATEST_VAR = "SCOUT_DATA_GP"
        CHART_LIMIT = 200
        OVERALL = "APPLICATION"

SSL_CTX = ssl.create_default_context()
# python.org 安装包默认不带根证书，回退到 macOS 系统证书
if not SSL_CTX.cert_store_stats().get("x509_ca") and Path("/etc/ssl/cert.pem").exists():
    SSL_CTX.load_verify_locations("/etc/ssl/cert.pem")


def log(msg):
    print(f"[{dt.datetime.now(BJT):%H:%M:%S}] {msg}", flush=True)


def http_get(url, timeout=20, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as resp:
                return resp.read().decode("utf-8", "replace")
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 * (attempt + 1))


def http_post_json(url, payload, timeout=20):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json", "User-Agent": UA}
    )
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------- 数据库 ----------

def open_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS ranks (
            date TEXT, country TEXT, genre_id TEXT, chart TEXT,
            rank INTEGER, app_id TEXT,
            PRIMARY KEY (date, country, genre_id, chart, app_id)
        );
        CREATE TABLE IF NOT EXISTS apps (
            app_id TEXT PRIMARY KEY, name TEXT, developer TEXT, genre TEXT,
            release_date TEXT, url TEXT, icon TEXT,
            rating REAL, rating_count INTEGER, updated TEXT
        );
        CREATE TABLE IF NOT EXISTS iap (
            app_id TEXT, country TEXT, items TEXT, fetched TEXT,
            PRIMARY KEY (app_id, country)
        );
        CREATE TABLE IF NOT EXISTS info (
            app_id TEXT, country TEXT, src TEXT, intro TEXT, features TEXT, updated TEXT,
            PRIMARY KEY (app_id, country)
        );
        CREATE TABLE IF NOT EXISTS installs (
            date TEXT, app_id TEXT, installs INTEGER,
            PRIMARY KEY (date, app_id)
        );
        """
    )
    return conn


# ---------- 抓取 ----------

def fetch_chart(country, genre_id, chart):
    url = (
        f"https://itunes.apple.com/{country}/rss/{CHARTS[chart]}"
        f"/limit={CHART_LIMIT}/genre={genre_id}/json"
    )
    entries = json.loads(http_get(url)).get("feed", {}).get("entry", [])
    if isinstance(entries, dict):
        entries = [entries]
    apps = []
    for e in entries:
        apps.append(
            {
                "app_id": e["id"]["attributes"]["im:id"],
                "name": e["im:name"]["label"],
                "developer": e.get("im:artist", {}).get("label", ""),
                "genre": e.get("category", {}).get("attributes", {}).get("label", ""),
                "release_date": e.get("im:releaseDate", {}).get("label", "")[:10],
                "url": e["id"]["label"].split("?")[0],
                "icon": e["im:image"][-1]["label"] if e.get("im:image") else "",
            }
        )
    return apps


def lookup_apps(country, app_ids):
    results = {}
    ids = list(app_ids)
    for i in range(0, len(ids), 150):
        chunk = ",".join(ids[i : i + 150])
        data = json.loads(http_get(f"https://itunes.apple.com/lookup?id={chunk}&country={country}"))
        for r in data.get("results", []):
            results[str(r["trackId"])] = r
    return results


IAP_JSON_RE = re.compile(r'"In-App Purchases","summary":"[^"]*","items":')
IAP_HTML_RE = re.compile(r'<div class="text-pair[^"]*"><span>(.*?)</span>\s*<span>(.*?)</span>')


def fetch_iap(country, app_id):
    page = http_get(f"https://apps.apple.com/{country}/app/id{app_id}")
    m = IAP_JSON_RE.search(page)
    if m:
        items, _ = json.JSONDecoder().raw_decode(page, m.end())
        return [
            [it.get("leadingText", ""), it.get("trailingText", "")]
            for it in items
            if it.get("$kind") == "textPair"
        ]
    return [[html.unescape(a), html.unescape(b)] for a, b in IAP_HTML_RE.findall(page)]


BULLET_RE = re.compile(r"^(?:[■□•●◆◇▪▸►▶✓✔✅★☆✦✨⭐️🔥\-–—*·]+|\d{1,2}[.)])\s*")
NOT_FEATURE_RE = re.compile(r"terms|privacy|policy|contact|e-?mail|support|eula|http|www\.|@|download", re.I)
HEADER_RE = re.compile(r"^\[.*\]$|^[^a-z]{4,60}$|^.{1,50}:$")
PROMO_RE = re.compile(r"halloween|christmas|holiday|black friday|thanksgiving|valentine|limited|event|what'?s new|new in|sale|offer|promo", re.I)
STOP_RE = re.compile(r"subscri|terms|privacy|contact|support|pricing|payment|legal|disclaimer|faq", re.I)
DEF_RE = re.compile(r"\b(?:is|are)\s+(?:a|an|the|your)\b|\b(?:helps?|lets?|allows?|enables?)\s+you\b|\bturns?\s+(?:your|any|a)\b|\buse\s+(?:our|this)\b.{0,40}\b(?:app|tool)\b", re.I)
DATE_RE = re.compile(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\d{1,2}\s*[–-]\s*\d{1,2}\b", re.I)


def extract_info(desc, name=""):
    """从 App Store 描述里取一句产品简介和最多 4 个功能要点（英文原文）。

    简介优先选「X is a…」「helps you…」这类直接说明产品用途的句子，没有才退回第一段。
    """
    intro, features, section, defs = "", [], "", []
    brand = re.split(r"[\s:：\-–—]", name.strip(), maxsplit=1)[0].lower()
    lines = [l.strip().replace("*", "") for l in (desc or "").splitlines()]
    for line in (l for l in lines if l):
        if HEADER_RE.match(line) and not BULLET_RE.match(line):
            section = line
            continue
        if PROMO_RE.search(section) or DATE_RE.search(line):
            continue
        if STOP_RE.search(section):
            break
        body = BULLET_RE.sub("", line)
        m = re.match(r"(.{2,60}?)(?:\s*[:：]\s+|\s+[–—-]\s+)(.+)", body)
        title = m.group(1) if m else body
        if BULLET_RE.match(line) or (m and len(title.split()) <= 6):
            title = title.strip(" .!")
            useful = (
                len(title) <= 60
                and len(title.split()) >= 2
                and not NOT_FEATURE_RE.search(title)
                and title.lower() != brand
            )
            if useful and len(features) < 4:
                features.append(title)
            continue
        for s in re.split(r"(?<=[.!?])\s+", line):
            if DEF_RE.search(s) and "?" not in s and 30 <= len(s) <= 220:
                defs.append((2 if brand and brand in s.lower() else 1, -len(defs), s))
        if not intro and len(line) >= 50:
            out = ""
            for s in re.split(r"(?<=[.!?])\s+", line):
                out = f"{out} {s}".strip()
                if len(out) >= 60:
                    break
            intro = out
    if defs:
        intro = max(defs)[2]
    if not intro:
        intro = next((BULLET_RE.sub("", l) for l in lines if len(l) >= 20 and not HEADER_RE.match(l)), "")
    if len(intro) > 180:
        intro = intro[:177].rsplit(" ", 1)[0] + "…"
    return intro, features


def _get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20, context=SSL_CTX) as resp:
        return json.loads(resp.read().decode("utf-8"))


def translate(texts, target="zh-CN"):
    """把多段英文译成中文：先用 Google，被限流（云端服务器 IP 常被拦）再用 MyMemory。

    都失败返回 None，不重试，避免越拖越久。
    """
    joined = "\n".join(t.replace("\n", " ") for t in texts)
    try:
        data = _get_json(
            "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto"
            f"&tl={target}&dt=t&q={urllib.parse.quote(joined)}"
        )
        out = "".join(seg[0] for seg in data[0] if seg[0]).split("\n")
        return [o.strip() for o in out] if len(out) == len(texts) else texts
    except Exception as exc:
        google_err = exc
    try:
        out = []
        for t in texts:
            data = _get_json(f"https://api.mymemory.translated.net/get?langpair=en|{target}&q={urllib.parse.quote(t[:480])}")
            if data.get("responseStatus") != 200:
                raise RuntimeError(data.get("responseDetails"))
            out.append(html.unescape(data["responseData"]["translatedText"]).strip())
        return out
    except Exception as exc:
        log(f"翻译失败（Google: {google_err}；MyMemory: {exc}），先显示英文，明天再译")
        return None


UNTRANSLATED = "untranslated"


def refresh_info(conn, country, app_ids, today):
    """给候选应用生成中文简介；描述没变就用缓存，翻译失败的不缓存，下次再试。"""
    app_ids = list(app_ids)
    try:
        if STORE == "gp":
            details = {d["app_id"]: (d["description"], d["name"]) for d in gp_fetch("details", country, stdin=app_ids)}
        else:
            details = {k: (v.get("description"), v.get("trackName", "")) for k, v in lookup_apps(country, app_ids).items()}
    except Exception as exc:
        log(f"简介所需的应用详情查询失败: {exc}")
        return 0
    n, translator_down = 0, False
    for app_id in app_ids:
        desc, name = details.get(app_id, (None, ""))
        if not desc:
            continue
        src = hashlib.md5(desc.encode()).hexdigest()
        cached = conn.execute("SELECT src FROM info WHERE app_id=? AND country=?", (app_id, country)).fetchone()
        if cached and cached["src"] == src:
            continue
        intro, features = extract_info(desc, name)
        texts = [intro, *features] if intro else features
        zh = None if translator_down or not texts else translate(texts)
        if zh is None:
            # 翻译不可用时先存英文，src 记为 UNTRANSLATED，下次扫描会重新翻译
            translator_down = bool(texts)
            zh, src = texts, UNTRANSLATED
        conn.execute(
            "INSERT OR REPLACE INTO info VALUES (?,?,?,?,?,?)",
            (app_id, country, src, zh[0] if intro else "", json.dumps(zh[1:] if intro else zh, ensure_ascii=False), today),
        )
        n += 1
        time.sleep(0.2)
    conn.commit()
    return n


def parse_price(text):
    m = re.search(r"([\d.,]+)", text or "")
    if not m:
        return 0.0
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return 0.0


def run_fetch(conn, cfg, today):
    country = cfg["country"]
    genres = cfg["genres"]
    age_limit = cfg["filter"]["max_age_days"]

    chart_apps = {}
    for gid, gname in [(OVERALL, "全部应用"), *genres.items()]:
        for chart in CHARTS:
            try:
                apps = fetch_chart(country, gid, chart)
            except Exception as exc:
                log(f"榜单抓取失败 {gname}/{chart}: {exc}")
                continue
            conn.executemany(
                "INSERT OR REPLACE INTO ranks VALUES (?,?,?,?,?,?)",
                [(today, country, gid, chart, i + 1, a["app_id"]) for i, a in enumerate(apps)],
            )
            for a in apps:
                chart_apps[a["app_id"]] = a
            log(f"{gname} {chart}: {len(apps)} 个")
            time.sleep(0.3)
    conn.commit()

    log(f"查询应用详情 {len(chart_apps)} 个")
    try:
        details = lookup_apps(country, chart_apps.keys())
    except Exception as exc:
        log(f"应用详情查询失败: {exc}")
        details = {}
    for app_id, a in chart_apps.items():
        d = details.get(app_id, {})
        conn.execute(
            "INSERT OR REPLACE INTO apps VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                app_id,
                d.get("trackName") or a["name"],
                d.get("sellerName") or a["developer"],
                d.get("primaryGenreName") or a["genre"],
                (d.get("releaseDate") or a["release_date"])[:10],
                d.get("trackViewUrl", a["url"]).split("?")[0],
                d.get("artworkUrl100") or a["icon"],
                d.get("averageUserRating"),
                d.get("userRatingCount"),
                today,
            ),
        )
    conn.commit()

    # 只给进了畅销榜的新品抓内购，其余没必要
    grossing_ids = {
        r["app_id"]
        for r in conn.execute(
            "SELECT DISTINCT app_id FROM ranks WHERE date=? AND country=? AND chart='grossing'",
            (today, country),
        )
    }
    cutoff = (dt.date.fromisoformat(today) - dt.timedelta(days=age_limit)).isoformat()
    refresh_before = (
        dt.date.fromisoformat(today) - dt.timedelta(days=cfg["fetch"]["iap_refresh_days"])
    ).isoformat()
    todo = []
    for app_id in grossing_ids:
        row = conn.execute("SELECT release_date FROM apps WHERE app_id=?", (app_id,)).fetchone()
        if not row or not row["release_date"] or row["release_date"] < cutoff:
            continue
        cached = conn.execute(
            "SELECT fetched FROM iap WHERE app_id=? AND country=?", (app_id, country)
        ).fetchone()
        if cached and cached["fetched"] > refresh_before:
            continue
        todo.append(app_id)

    log(f"抓取内购价格 {len(todo)} 个")

    def worker(app_id):
        try:
            return app_id, fetch_iap(country, app_id)
        except Exception as exc:
            log(f"内购抓取失败 {app_id}: {exc}")
            return app_id, None

    with ThreadPoolExecutor(max_workers=cfg["fetch"]["workers"]) as pool:
        for app_id, items in pool.map(worker, todo):
            if items is None:
                continue
            conn.execute(
                "INSERT OR REPLACE INTO iap VALUES (?,?,?,?)",
                (app_id, country, json.dumps(items, ensure_ascii=False), today),
            )
    conn.commit()


def gp_fetch(cmd, country, arg="", stdin=()):
    proc = subprocess.run(
        ["node", str(GP_FETCH), cmd, country, arg],
        input="\n".join(stdin), capture_output=True, text=True, timeout=1800,
    )
    for line in proc.stderr.splitlines():
        log(f"gp_fetch: {line}")
    if proc.returncode:
        raise RuntimeError(f"gp_fetch {cmd} 退出码 {proc.returncode}")
    return json.loads(proc.stdout)


def run_fetch_gp(conn, cfg, today):
    """Google Play：各分类免费榜、畅销榜各前 200 名；同一分类两个榜都上了的应用才抓详情。

    详情里的上线日期不会变，太老的应用抓过一次就不再抓；新品每天都抓，用来记录累计安装数。
    """
    country = cfg["country"]
    charts = gp_fetch("charts", country, ",".join([OVERALL, *cfg["genres"]]))
    pool = set()
    for gid, lists in charts.items():
        for chart, apps in lists.items():
            conn.executemany(
                "INSERT OR REPLACE INTO ranks VALUES (?,?,?,?,?,?)",
                [(today, country, gid, chart, i + 1, a["app_id"]) for i, a in enumerate(apps)],
            )
        if gid != OVERALL:
            free = {a["app_id"] for a in lists.get("free", [])}
            pool |= {a["app_id"] for a in lists.get("grossing", []) if a["app_id"] in free}
        log(f"{cfg['genres'].get(gid, '全部应用')}: 免费 {len(lists.get('free', []))} / 畅销 {len(lists.get('grossing', []))}")
    conn.commit()

    cutoff = (dt.date.fromisoformat(today) - dt.timedelta(days=cfg["filter"]["max_age_days"])).isoformat()
    todo = []
    for app_id in pool:
        row = conn.execute("SELECT release_date FROM apps WHERE app_id=?", (app_id,)).fetchone()
        if not row or not row["release_date"] or row["release_date"] >= cutoff:
            todo.append(app_id)
    log(f"查询应用详情 {len(todo)} 个（两个榜都上了的 {len(pool)} 个）")
    try:
        details = gp_fetch("details", country, stdin=todo)
    except Exception as exc:
        log(f"应用详情查询失败: {exc}")
        details = []
    for d in details:
        conn.execute(
            "INSERT OR REPLACE INTO apps VALUES (?,?,?,?,?,?,?,?,?,?)",
            (d["app_id"], d.get("name"), d.get("developer"), d.get("genre"), d.get("release_date"),
             d.get("url", "").split("&")[0], d.get("icon"), d.get("rating"), d.get("rating_count"), today),
        )
        conn.execute("INSERT OR REPLACE INTO iap VALUES (?,?,?,?)",
                     (d["app_id"], country, json.dumps([d.get("iap_range", "")]), today))
        if d.get("installs"):
            conn.execute("INSERT OR REPLACE INTO installs VALUES (?,?,?)", (today, d["app_id"], d["installs"]))
    conn.commit()


def gp_downloads(conn, app_id, today, age):
    """Google Play 公布了累计安装数：和最近 7 天里最早的一次记录相减得到日均新增；
    没有更早的记录（刚开始记录）或数字没变时，退回上线以来的日均。"""
    week_ago = (dt.date.fromisoformat(today) - dt.timedelta(days=7)).isoformat()
    rows = conn.execute(
        "SELECT date, installs FROM installs WHERE app_id=? AND date BETWEEN ? AND ? ORDER BY date",
        (app_id, week_ago, today),
    ).fetchall()
    if not rows or rows[-1]["date"] != today:
        return 0, "none", 0, 0
    cur = rows[-1]["installs"]
    first = rows[0]
    days = (dt.date.fromisoformat(today) - dt.date.fromisoformat(first["date"])).days
    if days and cur > first["installs"]:
        return (cur - first["installs"]) / days, "delta", days, cur
    return cur / max(age, 1), "avg", 0, cur


GP_RANGE_RE = re.compile(r"\$([\d.,]+)")


# ---------- 分析 ----------

def rank_on_or_before(conn, country, genre_id, chart, app_id, date):
    """返回 date 当天或之前最近一次快照中的名次；该快照存在但应用不在榜上时返回 CHART_LIMIT + 1。"""
    snap = conn.execute(
        "SELECT MAX(date) AS d FROM ranks WHERE country=? AND genre_id=? AND chart=? AND date<=?",
        (country, genre_id, chart, date),
    ).fetchone()["d"]
    if not snap:
        return None
    row = conn.execute(
        "SELECT rank FROM ranks WHERE date=? AND country=? AND genre_id=? AND chart=? AND app_id=?",
        (snap, country, genre_id, chart, app_id),
    ).fetchone()
    return row["rank"] if row else CHART_LIMIT + 1


def fit_scale(conn, country, chart, genres, today):
    """拟合「分类名次 → 总榜等效名次」：log(总榜名次) = a[分类] + b·log(分类名次)。

    用最近 FIT_DAYS 天里同时出现在总榜和分类榜上的应用做样本，各分类共享斜率 b。
    没有样本的分类（体量太小，连第 1 名都进不了总榜前 100）按比最小的已知分类再小 1.5 倍处理。
    """
    since = (dt.date.fromisoformat(today) - dt.timedelta(days=FIT_DAYS)).isoformat()
    pairs = defaultdict(list)
    for r in conn.execute(
        "SELECT c.genre_id, c.rank AS k, o.rank AS p FROM ranks o JOIN ranks c "
        "ON c.date=o.date AND c.country=o.country AND c.chart=o.chart AND c.app_id=o.app_id "
        "WHERE o.genre_id=? AND c.genre_id!=? AND o.country=? AND o.chart=? AND o.date BETWEEN ? AND ?",
        (OVERALL, OVERALL, country, chart, since, today),
    ):
        if r["genre_id"] in genres:
            pairs[r["genre_id"]].append((math.log(r["k"]), math.log(r["p"])))

    num = den = 0.0
    for v in pairs.values():
        mx = sum(x for x, _ in v) / len(v)
        my = sum(y for _, y in v) / len(v)
        num += sum((x - mx) * (y - my) for x, y in v)
        den += sum((x - mx) ** 2 for x, _ in v)
    b = num / den if den else 1.2
    a = {g: sum(y - b * x for x, y in v) / len(v) for g, v in pairs.items()}
    fallback = (max(a.values()) if a else math.log(50)) + math.log(1.5)
    # 总榜只有前 100，分类名次超过样本里的最大名次就是外推，误差可能差一个数量级
    max_k = {g: round(math.exp(max(x for x, _ in v))) for g, v in pairs.items()}
    return {"b": b, "a": a, "fitted": set(a), "fallback": fallback, "max_k": max_k,
            "samples": sum(len(v) for v in pairs.values())}


def in_range(scale, gid, rank):
    return rank <= scale["max_k"].get(gid, 0)


def borrow_missing(target, ref):
    """target 里没有样本的分类，用它在 ref 里的体量加上两个榜之间的典型差值来补。"""
    common = [g for g in target["fitted"] if g in ref["fitted"]]
    if not common:
        return
    diffs = sorted(target["a"][g] - ref["a"][g] for g in common)
    shift = diffs[len(diffs) // 2]
    for g in ref["fitted"]:
        target["a"].setdefault(g, ref["a"][g] + shift)


def equivalent_rank(scale, gid, rank):
    return math.exp(scale["a"].get(gid, scale["fallback"])) * rank ** scale["b"]


def download_model(conn, cfg, free_scale, today):
    """用七麦等平台的真实日下载样本，把总榜等效名次换算成日下载：日下载 = C · 名次^(-c)。

    样本少于 2 个时，斜率 c 用配置里的 download_exponent。
    """
    cal = cfg.get("calibration", {})
    c = cal.get("download_exponent", 0.6)
    pts = []
    for an in cal.get("anchors", []):
        row = conn.execute(
            "SELECT genre_id, rank FROM ranks WHERE app_id=? AND chart='free' AND genre_id!=? "
            "ORDER BY ABS(julianday(date) - julianday(?)), rank LIMIT 1",
            (str(an["app_id"]), OVERALL, an.get("date", today)),
        ).fetchone()
        if row and an.get("daily_downloads"):
            p = equivalent_rank(free_scale, row["genre_id"], row["rank"])
            pts.append((math.log(p), math.log(an["daily_downloads"])))
    if len(pts) >= 2:
        mx = sum(x for x, _ in pts) / len(pts)
        my = sum(y for _, y in pts) / len(pts)
        den = sum((x - mx) ** 2 for x, _ in pts)
        if den > 0.5:
            c = min(max(-sum((x - mx) * (y - my) for x, y in pts) / den, 0.3), 1.5)
    log_c = sum(y + c * x for x, y in pts) / len(pts) if pts else math.log(8000) + c * math.log(100)
    return (lambda p: math.exp(log_c) * p ** -c), {"anchors": len(pts), "exponent": round(c, 2)}


def efficiency(conn, country, today):
    """变现效率：免费榜名次 ÷ 畅销榜名次，只和同一分类里同时上了两个榜的应用比。

    同分类内比较不需要换算成总榜名次，不受总榜只有前 100 的限制。
    返回 {(分类, 应用): (比值, 本分类排第几, 本分类共几个)} 和实际用到的天数。
    """
    dates = [r["d"] for r in conn.execute(
        "SELECT DISTINCT date AS d FROM ranks WHERE country=? AND date<=? ORDER BY date DESC LIMIT ?",
        (country, today, EFF_DAYS),
    )]
    win = dates if len(dates) >= EFF_DAYS else dates[:1]
    logs = defaultdict(list)
    for r in conn.execute(
        "SELECT f.genre_id AS g, f.app_id AS a, f.rank AS fr, s.rank AS gr FROM ranks f JOIN ranks s "
        "ON s.date=f.date AND s.country=f.country AND s.genre_id=f.genre_id AND s.app_id=f.app_id AND s.chart='grossing' "
        f"WHERE f.chart='free' AND f.country=? AND f.genre_id!=? AND f.date IN ({','.join('?' * len(win))})",
        (country, OVERALL, *win),
    ):
        logs[(r["g"], r["a"])].append(math.log(r["fr"]) - math.log(r["gr"]))
    by_genre = defaultdict(dict)
    for (g, a), v in logs.items():
        by_genre[g][a] = math.exp(sum(v) / len(v))
    out = {}
    for g, m in by_genre.items():
        for i, a in enumerate(sorted(m, key=m.get, reverse=True), 1):
            out[(g, a)] = (m[a], i, len(m))
    return out, len(win)


def assign_theme(cfg, app_id, info, name):
    """按功能归类：config.toml [theme_assign] 里指定了就用它，否则按 [[themes]] 的顺序匹配关键词，先匹配上的为准。"""
    if app_id in cfg.get("theme_assign", {}):
        return cfg["theme_assign"][app_id]
    # Google Play 的名称常用不换行空格（\xa0），统一成普通空格再匹配
    text = re.sub(r"\s+", " ", " ".join([name, info.get("intro", ""), *info.get("features", [])])).lower()
    for t in cfg.get("themes", []):
        if any(k.lower() in text for k in t["keywords"]):
            return t["name"]
    return ""


def pick_top(results, cfg):
    """每日跟进 Top N：本分类变现效率靠前、畅销榜在上升或新进榜、高价，每个分类最多一个。
    符合条件的不够时按得分补齐，并标记 strict=False。"""
    t = cfg.get("top", {})
    n, eff_top, min_price = t.get("n", 3), t.get("eff_top", 0.3), t.get("min_max_price", 49.99)

    def strict(r):
        tr = r["trend"]
        return (r["eff_pos"] <= max(1, math.ceil(r["eff_n"] * eff_top))
                and r["max_price"] >= min_price
                and tr is not None and (tr["new"] or tr["delta"] > 0))

    picked, genres = [], set()
    for want in (True, False):
        for r in results:
            if len(picked) >= n:
                break
            if r["genre_id"] in genres or (want and not strict(r)) or any(p["app_id"] == r["app_id"] for p in picked):
                continue
            picked.append({"app_id": r["app_id"], "strict": want})
            genres.add(r["genre_id"])
    return picked, {"n": n, "eff_top": eff_top, "min_max_price": min_price}


def analyze(conn, cfg, today):
    country = cfg["country"]
    f = cfg["filter"]
    genres = cfg["genres"]
    excluded = set(f.get("exclude_developers", []))
    today_d = dt.date.fromisoformat(today)
    week_ago = (today_d - dt.timedelta(days=7)).isoformat()
    two_weeks_ago = (today_d - dt.timedelta(days=14)).isoformat()
    since = (today_d - dt.timedelta(days=HISTORY_DAYS)).isoformat()

    summaries = json.loads(SUMMARIES.read_text("utf-8")) if SUMMARIES.exists() else {}
    free_scale = fit_scale(conn, country, "free", genres, today)
    gross_scale = fit_scale(conn, country, "grossing", genres, today)
    borrow_missing(gross_scale, free_scale)
    borrow_missing(free_scale, gross_scale)
    if STORE == "gp":
        est_downloads, dl_info = None, {"anchors": 0, "exponent": None}
    else:
        est_downloads, dl_info = download_model(conn, cfg, free_scale, today)
    eff, eff_days = efficiency(conn, country, today)
    # 近 7 天里每个分类最早的一份畅销榜快照，攒不满 7 天时用最早的那天
    trend_start = {
        r["genre_id"]: r["d"] for r in conn.execute(
            "SELECT genre_id, MIN(date) AS d FROM ranks WHERE country=? AND chart='grossing' AND date>=? AND date<? GROUP BY genre_id",
            (country, week_ago, today),
        )
    }
    model = {
        "free_samples": free_scale["samples"],
        "grossing_samples": gross_scale["samples"],
        "fitted_free": sorted(free_scale["fitted"]),
        "fitted_grossing": sorted(gross_scale["fitted"]),
        # 分类体量：本分类畅销第 1 名大约排畅销总榜第几；没有的分类连第 1 名都进不了总榜前 100
        "genre_head": {g: max(1, round(math.exp(gross_scale["a"][g]))) for g in gross_scale["fitted"]},
        **dl_info,
        "eff_days": eff_days,
    }

    best = {}
    for r in conn.execute(
        "SELECT genre_id, rank, app_id FROM ranks WHERE date=? AND country=? AND chart='grossing'",
        (today, country),
    ):
        if r["genre_id"] not in genres:
            continue
        if r["app_id"] not in best or r["rank"] < best[r["app_id"]][1]:
            best[r["app_id"]] = (r["genre_id"], r["rank"])

    results = []
    for app_id, (gid, g_rank) in best.items():
        app = conn.execute("SELECT * FROM apps WHERE app_id=?", (app_id,)).fetchone()
        if not app or not app["release_date"] or app["developer"] in excluded:
            continue
        age = (today_d - dt.date.fromisoformat(app["release_date"])).days
        if age > f["max_age_days"]:
            continue

        free_row = conn.execute(
            "SELECT rank FROM ranks WHERE date=? AND country=? AND genre_id=? AND chart='free' AND app_id=?",
            (today, country, gid, app_id),
        ).fetchone()
        # 有下载量：必须进了本分类免费榜，且估算日下载达到门槛
        if not free_row:
            continue
        free_rank = free_row["rank"]
        eq_free = equivalent_rank(free_scale, gid, free_rank)
        if STORE == "gp":
            downloads, dl_src, dl_days, installs = gp_downloads(conn, app_id, today, age)
        else:
            downloads, dl_src, dl_days, installs = est_downloads(eq_free), "rank", 0, None
        if downloads < f["min_daily_downloads"]:
            continue
        eff_ratio, eff_pos, eff_n = eff[(gid, app_id)]

        iap_row = conn.execute(
            "SELECT items FROM iap WHERE app_id=? AND country=?", (app_id, country)
        ).fetchone()
        items = json.loads(iap_row["items"]) if iap_row else []
        info = summaries.get(app_id)
        if not info:
            row = conn.execute(
                "SELECT src, intro, features FROM info WHERE app_id=? AND country=?", (app_id, country)
            ).fetchone()
            info = {
                "intro": row["intro"],
                "features": json.loads(row["features"]),
                "auto": True,
                "pending": row["src"] == UNTRANSLATED,
            } if row else {}
        # 苹果没有公开内购列表的排序依据，所以只用和顺序无关的最高价、最低价
        iap_range = ""
        if STORE == "gp":
            # Google Play 只公开「$0.99 - $239.99 per item」这样的单项价格区间
            iap_range = items[0] if items else ""
            items = []
            prices = [float(p.replace(",", "")) for p in GP_RANGE_RE.findall(iap_range)]
        else:
            prices = [parse_price(p) for _, p in items]
        max_price = max(prices) if prices else 0.0
        min_price = min((p for p in prices if p > 0), default=0.0)
        if max_price < f["min_max_price"]:
            continue

        rank_7 = rank_on_or_before(conn, country, gid, "grossing", app_id, week_ago)
        rank_14 = rank_on_or_before(conn, country, gid, "grossing", app_id, two_weeks_ago)
        delta_7 = rank_7 - g_rank if rank_7 else None
        delta_14 = rank_14 - g_rank if rank_14 else None
        start = trend_start.get(gid)
        rank_s = rank_on_or_before(conn, country, gid, "grossing", app_id, start) if start else None
        trend = {
            "from": start,
            "days": (today_d - dt.date.fromisoformat(start)).days,
            "rank": rank_s,
            "delta": rank_s - g_rank,
            "new": rank_s == CHART_LIMIT + 1,
        } if rank_s else None

        def history(chart):
            return [
                [r["date"], r["rank"]]
                for r in conn.execute(
                    "SELECT date, rank FROM ranks WHERE country=? AND genre_id=? AND chart=? "
                    "AND app_id=? AND date>=? ORDER BY date",
                    (country, gid, chart, app_id, since),
                )
            ]

        score = (
            min(max(math.log10(downloads) - 2.5, 0), 2.5) * 20
            + (1 - (eff_pos - 1) / max(eff_n - 1, 1)) * 50
            + min(max_price * 0.6, 100) * 0.6
            + max(min(delta_7 or 0, 50), -50) * 0.8
            + (f["max_age_days"] - age) / f["max_age_days"] * 20
        )

        results.append(
            {
                "app_id": app_id,
                "name": app["name"],
                "developer": app["developer"],
                "genre_id": gid,
                "genre": genres.get(gid, app["genre"]),
                "url": app["url"],
                "icon": app["icon"],
                "release_date": app["release_date"],
                "age": age,
                "intro": info.get("intro", ""),
                "features": info.get("features", []),
                "intro_auto": info.get("auto", False),
                "intro_pending": info.get("pending", False),
                "theme": assign_theme(cfg, app_id, info, app["name"]),
                "rating": app["rating"],
                "rating_count": app["rating_count"],
                "grossing_rank": g_rank,
                "free_rank": free_rank,
                "eq_free": round(eq_free),
                "est_downloads": round(downloads),
                "dl_src": dl_src,
                "dl_days": dl_days,
                "installs": installs,
                "iap_range": iap_range,
                "eff": round(eff_ratio, 2),
                "eff_pos": eff_pos,
                "eff_n": eff_n,
                "fit_ok": gid in free_scale["fitted"],
                "free_checked": in_range(free_scale, gid, free_rank),
                "free_max_k": free_scale["max_k"].get(gid, 0),
                "min_price": min_price,
                "max_price": max_price,
                "items": items,
                "delta_7": delta_7,
                "delta_14": delta_14,
                "new_7": rank_7 == CHART_LIMIT + 1,
                "trend": trend,
                "history": history("grossing"),
                "free_history": history("free"),
                "score": round(score, 1),
            }
        )

    results.sort(key=lambda x: x["score"], reverse=True)
    return results, model


# ---------- 输出 ----------

def fmt_delta(d):
    if d is None:
        return "—"
    if d > 0:
        return f"↑{d}"
    if d < 0:
        return f"↓{-d}"
    return "0"


def write_latest(conn, results, model, cfg, today):
    scanned = conn.execute(
        "SELECT COUNT(DISTINCT app_id) AS n FROM ranks WHERE date=? AND country=?",
        (today, cfg["country"]),
    ).fetchone()["n"]
    days = conn.execute(
        "SELECT COUNT(DISTINCT date) AS n FROM ranks WHERE country=?", (cfg["country"],)
    ).fetchone()["n"]
    top, top_rule = pick_top(results, cfg)
    payload = {
        "date": today,
        "generated_at": dt.datetime.now(BJT).replace(tzinfo=None).isoformat(timespec="seconds"),
        "store": STORE,
        "chart_limit": CHART_LIMIT,
        "country": cfg["country"],
        "genres": cfg["genres"],
        "filter": {k: v for k, v in cfg["filter"].items() if k != "exclude_developers"},
        "scanned_apps": scanned,
        "history_days": days,
        "model": model,
        "top": top,
        "top_rule": top_rule,
        "items": results,
    }
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LATEST_JS.write_text(
        f"window.{LATEST_VAR} = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    log(f"已更新 {LATEST_JS.relative_to(REPO)}")


def publish(cfg, today, count):
    """扫描结果不进 Git（每天一份会让仓库越积越大），覆盖上传到 Release「scan-data」，
    网站由 pages.yml 部署时从 Release 取。云端扫描完由 scan.yml 接着部署，本机跑时在这里触发。"""
    if not cfg.get("publish", {}).get("auto_push"):
        return
    try:
        subprocess.run(["gh", "release", "upload", "scan-data", str(LATEST_JS), "--clobber"],
                       cwd=REPO, check=True, capture_output=True)
        log(f"已上传 {LATEST_JS.name}（{today} 共 {count} 个候选）")
        if not os.environ.get("GITHUB_ACTIONS"):
            subprocess.run(["gh", "workflow", "run", "pages.yml"], cwd=REPO, check=True, capture_output=True)
            log("已触发网站部署，约 1 分钟后更新")
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        log(f"发布失败: {exc}")


def notify_feishu(results, cfg, today):
    fs = cfg.get("feishu", {})
    webhook = os.environ.get("FEISHU_WEBHOOK") or fs.get("webhook")
    secret = os.environ.get("FEISHU_SECRET") or fs.get("secret")
    if not webhook:
        log("未配置飞书 Webhook，跳过推送")
        return

    lines = []
    by_id = {r["app_id"]: r for r in results}
    top = [by_id[p["app_id"]] for p in pick_top(results, cfg)[0]]
    if top:
        lines.append("**今日跟进 Top {}**\n".format(len(top)) + "\n".join(
            f"🎯 [{r['name']}]({r['url']})　{r['genre']}　变现效率本分类第 {r['eff_pos']}/{r['eff_n']}　最贵 ${r['max_price']:.2f}"
            for r in top
        ))
        lines.append("**按得分排序**")
    for i, r in enumerate(results[: fs.get("top_n", 10)], 1):
        free = f"#{r['free_rank']}" if r["free_rank"] else "100名外"
        lines.append(
            f"**{i}. [{r['name']}]({r['url']})**　{r['genre']}\n"
            f"畅销 #{r['grossing_rank']} / 免费 {free}　"
            f"内购 ${r['min_price']:.2f}–${r['max_price']:.2f}\n"
            f"上线 {r['age']} 天　7日 {fmt_delta(r['delta_7'])}　得分 {r['score']}"
        )
    if not lines:
        lines.append("今天没有符合条件的产品。")
    tail = f"\n共 {len(results)} 个候选"
    if fs.get("report_url"):
        tail += f"，[打开「扫描机会」查看全部]({fs['report_url']})"
    lines.append(tail)

    payload = {
        "msg_type": "interactive",
        "card": {
            "header": {
                "title": {"tag": "plain_text", "content": f"扫描机会 · {cfg['country'].upper()} {'Google Play' if STORE == 'gp' else 'App Store'} · {today}"},
                "template": "turquoise",
            },
            "elements": [{"tag": "markdown", "content": "\n\n".join(lines)}],
        },
    }
    if secret:
        ts = str(int(time.time()))
        sign = hmac.new(f"{ts}\n{secret}".encode(), digestmod=hashlib.sha256).digest()
        payload["timestamp"] = ts
        payload["sign"] = base64.b64encode(sign).decode()

    try:
        resp = http_post_json(webhook, payload)
        if resp.get("code", 0) != 0:
            log(f"飞书推送失败: {resp}")
        else:
            log("飞书推送成功")
    except Exception as exc:
        log(f"飞书推送失败: {exc}")


def prune(conn, today):
    """只保留最近 HISTORY_DAYS 天的榜单快照，以及这些快照里还出现的应用信息。"""
    cutoff = (dt.date.fromisoformat(today) - dt.timedelta(days=HISTORY_DAYS - 1)).isoformat()
    n = conn.execute("DELETE FROM ranks WHERE date < ?", (cutoff,)).rowcount
    conn.execute("DELETE FROM installs WHERE date < ?", (cutoff,))
    for table in ("apps", "iap", "info"):
        conn.execute(f"DELETE FROM {table} WHERE app_id NOT IN (SELECT DISTINCT app_id FROM ranks)")
    conn.commit()
    if n:
        conn.execute("VACUUM")
        log(f"已清理 {cutoff} 之前的榜单快照 {n} 条")


def main():
    parser = argparse.ArgumentParser(description="扫描机会：App Store 高价订阅新品雷达")
    parser.add_argument("--config", default=str(ROOT / "config.toml"))
    parser.add_argument("--no-fetch", action="store_true", help="不抓取，只用已有数据重新生成 latest.js")
    parser.add_argument("--no-notify", action="store_true", help="不推送飞书")
    parser.add_argument("--store", choices=["ios", "gp"], default="ios", help="ios = App Store，gp = Google Play")
    args = parser.parse_args()
    use_store(args.store)

    with open(args.config, "rb") as fp:
        cfg = tomllib.load(fp)
    local = Path(args.config).with_name("config.local.toml")
    if local.exists():
        with open(local, "rb") as fp:
            for section, values in tomllib.load(fp).items():
                if isinstance(values, dict):
                    cfg.setdefault(section, {}).update(values)
                else:
                    cfg[section] = values
    if STORE == "gp":
        gp = cfg.get("gp", {})
        cfg["genres"] = gp["genres"]
        cfg["filter"] = {**cfg["filter"], **gp.get("filter", {})}
    cfg["genres"] = {str(k): v for k, v in cfg["genres"].items()}

    today = dt.datetime.now(BJT).date().isoformat()
    conn = open_db()

    if not args.no_fetch:
        (run_fetch_gp if STORE == "gp" else run_fetch)(conn, cfg, today)
        prune(conn, today)
    else:
        latest = conn.execute("SELECT MAX(date) AS d FROM ranks").fetchone()["d"]
        if not latest:
            sys.exit("数据库里还没有数据，请先不带 --no-fetch 运行一次")
        today = latest

    results, model = analyze(conn, cfg, today)
    missing = [r["app_id"] for r in results if r["intro_pending"] or (not r["intro"] and not r["features"])]
    if missing:
        n = refresh_info(conn, cfg["country"], missing, today)
        log(f"更新产品简介 {n} 个")
        if n:
            results, model = analyze(conn, cfg, today)
    log(
        f"换算模型：免费榜样本 {model['free_samples']}、畅销榜样本 {model['grossing_samples']}，"
        f"下载校准样本 {model['anchors']} 个，斜率 {model['exponent']}"
    )
    log(f"符合条件 {len(results)} 个")
    write_latest(conn, results, model, cfg, today)

    if not args.no_fetch:
        publish(cfg, today, len(results))
    if not args.no_notify:
        notify_feishu(results, cfg, today)


if __name__ == "__main__":
    main()
