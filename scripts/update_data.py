#!/usr/bin/env python3
"""Refresh all ETF / SPY / macro data and rebuild the six-ETF site."""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"

TICKERS = ["VFLO", "IFLO", "COWZ", "SCHD", "QQQ", "SOXX", "XLP", "SPY"]
FILES = {
    "VFLO": "vflo_yahoo.json",
    "IFLO": "iflo_yahoo.json",
    "COWZ": "cowz_yahoo.json",
    "SCHD": "schd_yahoo.json",
    "QQQ": "qqq_yahoo.json",
    "SOXX": "soxx_yahoo.json",
    "XLP": "xlp_yahoo.json",
    "XLK": "xlk_yahoo.json",
    "SPY": "spy_yahoo.json",
    "^TNX": "tnx_yahoo.json",
    "^GSPC": "gspc_yahoo.json",
}
FIVE_I = {
    "VFLO": "https://www.5iresearch.ca/company/nasdaq/VFLO",
    "IFLO": "https://www.5iresearch.ca/company/nasdaq/IFLO",
    "COWZ": "https://www.5iresearch.ca/company/nyse/COWZ",
    "SCHD": "https://www.5iresearch.ca/company/nyse/SCHD",
    "QQQ": "https://www.5iresearch.ca/company/nasdaq/QQQ",
    "SOXX": "https://www.5iresearch.ca/company/nasdaq/SOXX",
    "XLP": "https://www.5iresearch.ca/company/nyse/XLP",
    "SPY": "https://www.5iresearch.ca/company/nyse/SPY",
}
MORNINGSTAR = {
    "VFLO": "https://www.morningstar.com/etfs/xnas/vflo/portfolio",
    "IFLO": "https://www.morningstar.com/etfs/xnas/iflo/portfolio",
    "COWZ": "https://www.morningstar.com/etfs/bats/cowz/portfolio",
    "SCHD": "https://www.morningstar.com/etfs/arcx/schd/portfolio",
    "QQQ": "https://www.morningstar.com/etfs/xnas/qqq/portfolio",
    "SOXX": "https://www.morningstar.com/etfs/xnas/soxx/portfolio",
    "XLP": "https://www.morningstar.com/etfs/arcx/xlp/portfolio",
    "SPY": "https://www.morningstar.com/etfs/arcx/spy/portfolio",
}


def fetch_json(url: str, timeout: int = 60) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def download_yahoo(symbol: str) -> None:
    encoded = urllib.parse.quote(symbol, safe="")
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}"
        f"?period1=0&period2={int(time.time())}&interval=1d&events=div%2Csplits"
    )
    payload = None
    last_error = None
    for attempt in range(3):
        try:
            payload = fetch_json(url)
            if "chart" in payload and payload["chart"].get("result"):
                break
            last_error = RuntimeError(f"no chart result for {symbol}")
        except Exception as exc:  # noqa: BLE001
            last_error = exc
        if attempt < 2:
            wait = 4 * (attempt + 1)
            print(f"  [retry {attempt + 1}/3] {symbol}: {last_error}; waiting {wait}s")
            time.sleep(wait)
    if payload is None or "chart" not in payload or not payload["chart"].get("result"):
        raise RuntimeError(f"Yahoo download failed for {symbol}: {last_error}")
    with open(RAW / FILES[symbol], "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    result = payload["chart"]["result"][0]
    last_date = datetime.fromtimestamp(result["timestamp"][-1], tz=timezone.utc).date()
    print(f"  {symbol:5s} -> {FILES[symbol]}  ({len(result['timestamp'])} bars, last {last_date})")


def last_date() -> str:
    payload = json.loads((RAW / "vflo_yahoo.json").read_text(encoding="utf-8"))
    return datetime.fromtimestamp(payload["chart"]["result"][0]["timestamp"][-1], tz=timezone.utc).date().isoformat()


def jina_text(url: str) -> str:
    req = urllib.request.Request(
        "https://r.jina.ai/" + url,
        headers={"User-Agent": UA, "Accept": "text/plain"},
    )
    with urllib.request.urlopen(req, timeout=90) as response:
        return response.read().decode("utf-8", "ignore")


def auto_anchors(ticker: str) -> tuple[float | None, float | None]:
    sources = [
        (f"https://stockanalysis.com/etf/{ticker.lower()}/", True),
        (FIVE_I[ticker], False),
    ]
    for url, has_forward in sources:
        try:
            text = jina_text(url)
            pe_match = re.search(r"PE Ratio\s*(?:\|\s*)?([0-9]+(?:\.[0-9]+)?)", text, re.I)
            pe = float(pe_match.group(1)) if pe_match else None
            if pe is not None and not (3 <= pe <= 80):
                pe = None
            forward = None
            if has_forward:
                forward_match = re.search(r"Forward PE\s*(?:\|\s*)?([0-9]+(?:\.[0-9]+)?)", text, re.I)
                if forward_match:
                    forward = float(forward_match.group(1))
                    if not (3 <= forward <= 80):
                        forward = None
            if pe is not None or forward is not None:
                print(f"  {ticker} source: {url}")
                return pe, forward
        except Exception as exc:
            print(f"  [warn] {ticker} source failed ({url}): {exc}")
    return None, None


def auto_growth(ticker: str) -> float | None:
    try:
        text = jina_text(MORNINGSTAR[ticker])
        match = re.search(r"Long-Term Earnings %\s*\|\s*([0-9]+(?:\.[0-9]+)?)", text)
        if match:
            value = float(match.group(1))
            if 0 < value <= 60:
                return value
    except Exception as exc:  # noqa: BLE001
        print(f"  [warn] {ticker} Morningstar growth failed: {exc}")
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh six-ETF dashboard data")
    parser.add_argument("--anchor-date", help="YYYY-MM-DD for the anchors (defaults to last market date)")
    parser.add_argument("--no-auto-anchors", action="store_true", help="keep PE / forward PE anchors; only refresh prices")
    args = parser.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    print("Downloading market data from Yahoo Finance…")
    for symbol in ["VFLO", "IFLO", "COWZ", "SCHD", "QQQ", "SOXX", "XLP", "XLK", "SPY", "^TNX", "^GSPC"]:
        try:
            download_yahoo(symbol)
        except Exception as exc:  # noqa: BLE001
            print(f"  [error] {symbol}: {exc}")
            return 1

    anchor_path = RAW / "anchors.json"
    anchors = json.loads(anchor_path.read_text(encoding="utf-8"))
    as_of = args.anchor_date or last_date()

    if not args.no_auto_anchors:
        for ticker in TICKERS:
            print(f"Reading {ticker} trailing / forward PE…")
            pe, forward = auto_anchors(ticker)
            item = anchors.setdefault(ticker, {})
            if pe is not None:
                item["pe"] = round(pe, 2)
            if forward is not None:
                item["forward_pe"] = round(forward, 2)
            growth = auto_growth(ticker)
            if growth is not None:
                item["lt_growth"] = round(growth, 2)
                item["lt_growth_as_of"] = datetime.now(timezone.utc).date().isoformat()
            if pe is not None or forward is not None or growth is not None:
                item["as_of"] = as_of
                print(f"  {ticker}: PE={item.get('pe')}x forward={item.get('forward_pe')}x growth={item.get('lt_growth')}% (as of {as_of})")
            else:
                print(f"  keeping last {ticker}: PE={item.get('pe')}x forward={item.get('forward_pe')}x growth={item.get('lt_growth')}% (as of {item.get('as_of')})")

    anchor_path.write_text(json.dumps(anchors, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Rebuilding seven ETFs…")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import build_all  # noqa: E402

    build_all.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
