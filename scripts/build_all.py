#!/usr/bin/env python3
"""Build the six-ETF valuation site and the SPY comparison data."""
from __future__ import annotations

import csv
import html
import json
import math
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from funds import FUNDS
from spy_compare import attach_spy, _cagr, _return

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
SITE = ROOT / "site"
SITE_DATA = SITE / "data"
TEMPLATES = ROOT / "templates"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
SRC = {
    "sp500_pe": "https://www.multpl.com/s-p-500-pe-ratio/table/by-month",
    "ten_year": "https://finance.yahoo.com/quote/%5ETNX/",
    "spy": "https://stockanalysis.com/etf/spy/",
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


def load_yahoo(path: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    with open(path, encoding="utf-8") as fh:
        payload = json.load(fh)
    result = payload["chart"]["result"][0]
    idx = pd.to_datetime(result["timestamp"], unit="s", utc=True)
    idx = idx.tz_convert("America/New_York").normalize().tz_localize(None)
    quote = result["indicators"]["quote"][0]
    adj = result["indicators"].get("adjclose", [{}])[0].get("adjclose")
    df = pd.DataFrame(
        {
            "date": idx,
            "close": quote["close"],
            "volume": quote.get("volume"),
            "adjclose": adj if adj is not None else quote["close"],
        }
    )
    df = df.drop_duplicates("date").dropna(subset=["close"]).set_index("date").sort_index()
    events = result.get("events", {}).get("dividends", {}) or {}
    rows = []
    for timestamp, item in events.items():
        d = pd.to_datetime(int(timestamp), unit="s", utc=True)
        d = d.tz_convert("America/New_York").normalize().tz_localize(None)
        rows.append({"date": d, "amount": float(item["amount"])})
    divs = pd.DataFrame(rows).sort_values("date") if rows else pd.DataFrame(columns=["date", "amount"])
    return df, divs


def fetch_sp500_pe() -> pd.DataFrame:
    url = SRC["sp500_pe"]
    dest = RAW / "sp500_pe_monthly.csv"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        raw = urllib.request.urlopen(req, timeout=45).read().decode("utf-8", "ignore")
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", raw, re.S)
        parsed = []
        for row in rows:
            text = html.unescape(re.sub(r"<[^>]+>", " ", row))
            text = re.sub(r"\s+", " ", text).strip()
            m = re.search(r"([A-Z][a-z]{2}) (\d{1,2}), (\d{4})", text)
            if not m:
                continue
            nums = re.findall(r"\b\d+\.\d+\b", text)
            if not nums:
                continue
            try:
                d = datetime.strptime(" ".join(m.groups()), "%b %d %Y").date()
            except ValueError:
                continue
            parsed.append((d, float(nums[-1])))
        if len(parsed) < 20:
            raise ValueError("multpl table parse returned too few rows")
        df = pd.DataFrame(parsed, columns=["date", "pe"]).drop_duplicates("date").sort_values("date")
        if not df.empty:
            with open(dest, "w", newline="", encoding="utf-8") as fh:
                writer = csv.writer(fh)
                writer.writerow(["date", "sp500_pe"])
                for row in df.itertuples(index=False):
                    writer.writerow([row.date.isoformat(), row.pe])
        return df
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] multpl fetch failed ({exc}); using cached CSV")
        df = pd.read_csv(dest, parse_dates=["date"])
        df["date"] = df["date"].dt.date
        return df.rename(columns={"sp500_pe": "pe"})


def pct_rank(reference: np.ndarray, values: pd.Series) -> pd.Series:
    clean = np.asarray(reference, dtype=float)
    clean = np.sort(clean[np.isfinite(clean)])
    if len(clean) == 0:
        return pd.Series(np.nan, index=values.index)
    arr = values.to_numpy(dtype=float)
    out = np.full(len(arr), np.nan)
    mask = np.isfinite(arr)
    out[mask] = np.searchsorted(clean, arr[mask], side="right") / len(clean) * 100.0
    return pd.Series(out, index=values.index)


def regime(score: float | None) -> str:
    if score is None or not math.isfinite(score):
        return "数据不足"
    if score < 20:
        return "深度低估"
    if score < 40:
        return "低估"
    if score < 60:
        return "适中"
    if score < 80:
        return "偏高"
    return "高估"


def regime_en(score: float | None) -> str:
    if score is None or not math.isfinite(score):
        return "n/a"
    if score < 20:
        return "deep value"
    if score < 40:
        return "undervalued"
    if score < 60:
        return "fair"
    if score < 80:
        return "rich"
    return "expensive"


def q(series: pd.Series, p: float) -> float:
    return float(np.nanquantile(series.dropna().to_numpy(), p))


def build_seasonality(df: pd.DataFrame) -> dict:
    """Calendar-month total-return profile from complete months only."""
    monthly = df["adjclose"].resample("ME").last().dropna()
    as_of = df.index[-1]
    month_end = as_of + pd.offsets.MonthEnd(0)
    if as_of < month_end and len(monthly) > 1:
        monthly = monthly.iloc[:-1]
    returns = monthly.pct_change().dropna()
    if returns.empty:
        return {"months": [], "total_months": 0, "note": "月度样本不足", "best_month": None, "worst_month": None, "positive_months": 0}
    rows = []
    for month in range(1, 13):
        sample = returns[returns.index.month == month]
        if sample.empty:
            rows.append({"month": month, "avg": None, "median": None, "win_rate": None, "n": 0})
            continue
        rows.append({
            "month": month,
            "avg": round(float(sample.mean()) * 100, 2),
            "median": round(float(sample.median()) * 100, 2),
            "win_rate": round(float((sample > 0).mean()) * 100, 1),
            "n": int(len(sample)),
        })
    valid = [r for r in rows if r["avg"] is not None]
    best = max(valid, key=lambda r: r["avg"]) if valid else None
    worst = min(valid, key=lambda r: r["avg"]) if valid else None
    total = len(returns)
    if total < 36:
        note = "样本不足 3 年，季节性仅供参考"
    elif total < 60:
        note = "样本不足 5 年，季节性仅供参考"
    else:
        note = f"基于 {total} 个完整月度总回报"
    return {
        "months": rows,
        "total_months": total,
        "note": note,
        "best_month": best,
        "worst_month": worst,
        "positive_months": int((returns > 0).sum()),
    }


def aum_label(value: float) -> str:
    if value >= 1e9:
        return f"${value / 1e9:.1f}B"
    return f"${value / 1e6:.0f}M"


def build_one(
    cfg: dict,
    anchors: dict,
    spy_df: pd.DataFrame,
    spy_divs: pd.DataFrame,
    tnx_df: pd.DataFrame,
    gspc_df: pd.DataFrame,
    pe_monthly: pd.DataFrame,
) -> tuple[dict, dict]:
    ticker = cfg["ticker"]
    price_df, divs = load_yahoo(RAW / f"{ticker.lower()}_yahoo.json")
    df = price_df[["close", "volume", "adjclose"]].copy()
    df["ust10y"] = tnx_df["close"].reindex(df.index).ffill().bfill()
    df["sp500"] = gspc_df["close"].reindex(df.index).ffill().bfill()

    as_of = df.index.max()
    price_now = float(df.loc[as_of, "close"])
    ust_now = float(df.loc[as_of, "ust10y"])
    pe_anchor = float(anchors[ticker]["pe"])
    forward_pe = float(anchors[ticker]["forward_pe"])
    lt_growth = float(anchors[ticker]["lt_growth"])
    peg = forward_pe / lt_growth
    pe_anchor_date = pd.Timestamp(anchors[ticker]["as_of"])

    # S&P 500 trailing EPS proxy -> PE history, anchored to the current PE.
    eps_rows = []
    for row in pe_monthly.itertuples(index=False):
        d = pd.Timestamp(row.date)
        if d > as_of:
            continue
        if d.day == 1:
            month_end = d + pd.offsets.MonthEnd(0)
            window = gspc_df.loc[: min(month_end, as_of)]
            if window.empty:
                continue
            level = float(window["close"].iloc[-1])
            stamp = window.index[-1]
        else:
            level = float(gspc_df.loc[:d, "close"].iloc[-1])
            stamp = gspc_df.loc[:d].index[-1]
        if row.pe and row.pe > 0:
            eps_rows.append({"date": stamp, "eps": level / float(row.pe)})

    eps_proxy = pd.DataFrame(eps_rows).drop_duplicates("date").set_index("date")["eps"].sort_index()
    eps_daily = eps_proxy.reindex(df.index).interpolate(method="time", limit_direction="both").ffill().bfill()
    pe_stamp = df.index[df.index <= pe_anchor_date].max()
    eps_anchor = float(df.loc[pe_stamp, "close"]) / pe_anchor
    eps_scaled = eps_daily / float(eps_daily.loc[pe_stamp]) * eps_anchor

    df["pe"] = df["close"] / eps_scaled
    df["earnings_yield"] = 100.0 / df["pe"]
    df["erp"] = df["earnings_yield"] - df["ust10y"]

    # TTM distribution yield.
    divs = divs.sort_values("date").reset_index(drop=True)
    first_div = divs["date"].min() if not divs.empty else None
    dy_values, ttm_values = [], []
    for d in df.index:
        if first_div is None or (d - first_div).days < 365:
            dy_values.append(np.nan)
            ttm_values.append(np.nan)
            continue
        window = divs[(divs["date"] > d - pd.Timedelta(days=365)) & (divs["date"] <= d)]
        ttm = float(window["amount"].sum())
        ttm_values.append(ttm)
        dy_values.append(ttm / float(df.loc[d, "close"]) * 100.0)
    df["ttm_div"] = ttm_values
    df["dy"] = dy_values

    df, spy, comparison = attach_spy(
        df,
        spy_df,
        spy_divs,
        float(anchors["SPY"]["pe"]),
        float(anchors["SPY"]["forward_pe"]),
        forward_pe,
    )
    spy["lt_growth"] = round(float(anchors["SPY"]["lt_growth"]), 2)
    spy["peg"] = round(spy["forward_pe"] / spy["lt_growth"], 2)
    comparison["peg"] = round(peg, 2)
    comparison["peg_spread"] = round(peg - spy["peg"], 2)

    for key in ("pe", "dy", "erp"):
        valid = df[key].dropna()
        df[f"pct_{key}"] = pct_rank(valid.to_numpy(), df[key])

    df["composite"] = (
        df["pct_pe"] + (100.0 - df["pct_dy"]) + (100.0 - df["pct_erp"])
    ) / 3.0
    df["regime"] = df["composite"].apply(regime)
    df["regime_en"] = df["composite"].apply(regime_en)

    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else last

    def trailing_return(days: int) -> float | None:
        if len(df) <= days:
            return None
        return float(df["close"].iloc[-1] / df["close"].iloc[-1 - days] - 1.0)

    year_start = df[df.index < pd.Timestamp(as_of.year, 1, 1)]
    ytd = float(price_now / year_start["close"].iloc[-1] - 1.0) if not year_start.empty else None
    first_price = float(df["close"].iloc[0])
    cagr = (price_now / first_price) ** (365.25 / max((as_of - df.index[0]).days, 1)) - 1.0
    drawdown = df["close"] / df["close"].cummax() - 1.0
    vol_1y = float(np.log(df["close"] / df["close"].shift(1)).tail(252).std() * math.sqrt(252))
    total_1y = _return(df["adjclose"], 252)
    cagr_common = _cagr(df["adjclose"])

    quantiles = {}
    for key in ("pe", "dy", "erp", "composite"):
        s = df[key].dropna()
        quantiles[key] = {f"q{int(p * 100)}": round(q(s, p), 4) for p in (0.2, 0.4, 0.6, 0.8)}

    median_pe = float(df["pe"].median())
    eps_now = float(eps_scaled.iloc[-1])
    implied_pe = median_pe * eps_now

    current = {
        "date": as_of.strftime("%Y-%m-%d"),
        "price": round(price_now, 2),
        "price_change_1d": round(float(price_now / float(prev["close"]) - 1.0) * 100, 2),
        "price_change_1m": round(trailing_return(21) * 100, 2) if trailing_return(21) is not None else None,
        "price_change_6m": round(trailing_return(126) * 100, 2) if trailing_return(126) is not None else None,
        "price_change_1y": round(trailing_return(252) * 100, 2) if trailing_return(252) is not None else None,
        "price_change_ytd": round(ytd * 100, 2) if ytd is not None else None,
        "price_change_since_inception": round((price_now / first_price - 1) * 100, 2),
        "cagr_since_inception": round(cagr * 100, 2),
        "total_return_1y": round(total_1y * 100, 2) if total_1y is not None else None,
        "cagr_since_common": round(cagr_common * 100, 2),
        "vol_1y": round(vol_1y * 100, 2),
        "max_drawdown": round(float(drawdown.min()) * 100, 2),
        "high_52w": round(float(df["close"].tail(252).max()), 2),
        "low_52w": round(float(df["close"].tail(252).min()), 2),
        "pe": round(float(last["pe"]), 2),
        "forward_pe": round(forward_pe, 2),
        "forward_earnings_yield": round(100.0 / forward_pe, 2),
        "forward_erp": round(100.0 / forward_pe - ust_now, 2),
        "forward_pe_discount_vs_ttm": round((1.0 - forward_pe / float(last["pe"])) * 100, 1),
        "lt_growth": round(lt_growth, 2),
        "peg": round(peg, 2),
        "dy": round(float(last["dy"]), 2),
        "erp": round(float(last["erp"]), 2),
        "ust10y": round(ust_now, 2),
        "earnings_yield": round(float(last["earnings_yield"]), 2),
        "ttm_div": round(float(last["ttm_div"]), 3),
        "composite": round(float(last["composite"]), 1),
        "regime": str(last["regime"]),
        "regime_en": str(last["regime_en"]),
        "pct_pe": round(float(last["pct_pe"]), 1),
        "pct_dy": round(float(last["pct_dy"]), 1),
        "pct_erp": round(float(last["pct_erp"]), 1),
        "pct_composite": round(float(last["composite"]), 1),
        "median_pe": round(median_pe, 2),
        "implied_pe_price": round(implied_pe, 2),
        "implied_pe_gap": round((implied_pe / price_now - 1) * 100, 1),
        "obs": int(len(df)),
        "obs_pe": int(df["pe"].notna().sum()),
        "obs_dy": int(df["dy"].notna().sum()),
    }

    keep = [
        "close", "pe", "dy", "erp", "ust10y", "earnings_yield", "ttm_div",
        "composite", "pct_pe", "pct_dy", "pct_erp",
        "regime", "regime_en", "adjclose", "etf_tr", "spy_tr", "relative_tr",
        "spy_dy", "spy_ttm_div",
    ]
    series = []
    for d, row in df.iterrows():
        rec = {"date": d.strftime("%Y-%m-%d")}
        for col in keep:
            value = row[col]
            if isinstance(value, (np.floating, float)):
                rec[col] = None if not math.isfinite(float(value)) else round(float(value), 4)
            elif isinstance(value, (np.integer, int)):
                rec[col] = int(value)
            else:
                rec[col] = None if pd.isna(value) else str(value)
        rec["price"] = round(float(row["close"]), 2)
        series.append(rec)

    def snapshot(frame: pd.DataFrame) -> list[dict]:
        out = []
        for d, row in frame.iterrows():
            out.append({
                "date": d.strftime("%Y-%m-%d"),
                "price": round(float(row["close"]), 2),
                "pe": None if pd.isna(row["pe"]) else round(float(row["pe"]), 2),
                "dy": None if pd.isna(row["dy"]) else round(float(row["dy"]), 2),
                "spy_dy": None if pd.isna(row["spy_dy"]) else round(float(row["spy_dy"]), 2),
                "erp": None if pd.isna(row["erp"]) else round(float(row["erp"]), 2),
                "relative_tr": None if pd.isna(row["relative_tr"]) else round(float(row["relative_tr"]), 2),
                "composite": None if pd.isna(row["composite"]) else round(float(row["composite"]), 1),
                "regime": None if pd.isna(row["composite"]) else str(row["regime"]),
                "pct_pe": None if pd.isna(row["pct_pe"]) else round(float(row["pct_pe"]), 1),
                "pct_dy": None if pd.isna(row["pct_dy"]) else round(float(row["pct_dy"]), 1),
                "pct_erp": None if pd.isna(row["pct_erp"]) else round(float(row["pct_erp"]), 1),
            })
        return out

    monthly = snapshot(df.groupby(df.index.to_period("M"), sort=True).tail(1))
    quarterly = snapshot(df.groupby(df.index.to_period("Q"), sort=True).tail(1))
    log = monthly[-14:]

    dist = "按月" if cfg["distribution"] == "monthly" else "按季度"
    insights = [
        {
            "tag": "相对 SPY",
            "title": f"PE 是 SPY 的 {100 - comparison['pe_discount']:.0f}%，折价 {comparison['pe_discount']:.0f}%",
            "body": (
                f"{ticker} TTM PE {current['pe']:.1f}x、Forward PE {current['forward_pe']:.1f}x、"
                f"PEG {current['peg']:.2f}；SPY 分别为 {spy['pe']:.1f}x、{spy['forward_pe']:.1f}x、"
                f"{spy['peg']:.2f}。Forward 折价 {comparison['forward_pe_discount']:.0f}%，但两者风格不同，"
                "折价本身不等于便宜。"
            ),
            "tone": "amber",
        },
        {
            "tag": "相对表现",
            "title": (
                f"近一年{'跑赢' if comparison['relative_1y'] >= 0 else '跑输'} SPY "
                f"{abs(comparison['relative_1y']):.0f} 个百分点"
            ),
            "body": (
                f"从 {comparison['common_start']} 的共同起点算起，{ticker} 累计回报 "
                f"{comparison['etf_total_return']:+.0f}%，SPY 为 {comparison['spy_total_return']:+.0f}%；"
                f"当前相对强弱位于历史 {comparison['relative_percentile']:.1f}% 分位。"
            ),
            "tone": "teal",
        },
        {
            "tag": "现金回报",
            "title": f"股息率 {current['dy']:.2f}%，SPY 为 {spy['dy']:.2f}%",
            "body": (
                f"{ticker} 股息率比 SPY 高 {comparison['dy_spread']:.2f} 个百分点，"
                f"自身处于历史 {current['pct_dy']:.0f}% 分位。{dist}分配不代表更稳定，"
                "本站统一使用滚动12个月实际派息。"
            ),
            "tone": "green",
        },
        {
            "tag": "风险补偿",
            "title": f"ERP {current['erp']:.2f}% vs SPY {spy['erp']:.2f}%",
            "body": (
                f"10年期美债 {current['ust10y']:.2f}% 之下，{ticker} 的风险补偿为 "
                f"{current['erp']:.2f}%，位于自身历史 {current['pct_erp']:.0f}% 分位；"
                f"SPY 的盈利收益率已经低于无风险利率。"
            ),
            "tone": "blue",
        },
    ]

    meta = {
        **{k: cfg[k] for k in ("ticker", "name", "short", "exchange", "theme", "inception", "aum", "expense", "holdings", "category", "distribution")},
        "as_of": as_of.strftime("%Y-%m-%d"),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "currency": "USD",
        "pe_anchor": pe_anchor,
        "forward_pe_anchor": forward_pe,
        "lt_growth_anchor": lt_growth,
        "pe_anchor_date": pe_stamp.strftime("%Y-%m-%d"),
        "spy_pe_anchor": float(anchors["SPY"]["pe"]),
        "spy_forward_pe_anchor": float(anchors["SPY"]["forward_pe"]),
        "spy_lt_growth_anchor": float(anchors["SPY"]["lt_growth"]),
        "spy_as_of": anchors["SPY"]["as_of"],
        "lt_growth_as_of": anchors[ticker].get("lt_growth_as_of", anchors[ticker]["as_of"]),
        "sources": [
            {"label": f"Yahoo Finance · {ticker} 日线", "url": f"https://finance.yahoo.com/quote/{ticker}/history/"},
            {"label": f"StockAnalysis · {ticker} 当前 PE-TTM", "url": f"https://stockanalysis.com/etf/{ticker.lower()}/"},
            {"label": "Yahoo Finance · SPY 日线与股息", "url": "https://finance.yahoo.com/quote/SPY/history/"},
            {"label": "StockAnalysis · SPY 当前 PE-TTM", "url": SRC["spy"]},
            {"label": "Morningstar · 长期盈利增速（PEG 分母）", "url": MORNINGSTAR[ticker]},
            {"label": "Multpl · 标普500 月度 PE", "url": SRC["sp500_pe"]},
            {"label": "CBOE · 10年期美债收益率 (^TNX)", "url": SRC["ten_year"]},
            {"label": f"{cfg['short']} · 基金页面", "url": cfg["fund_url"]},
        ],
        "methodology": {
            "pe": f"以当前实际 TTM PE 为锚，用标普500 TTM EPS 的增长路径缩放 {ticker} 组合盈利，估算历史 PE-TTM。",
            "dy": "滚动12个月实际现金分配 ÷ 当日收盘价；成立满12个月后才展示。",
            "erp": "盈利收益率 (1/PE) − 10年期美债收益率。",
            "spy": "SPY 总回报、股息率使用实际数据；PE 使用公开当前值，不做历史拟合并用于当前估值对比。",
            "percentile": "每个指标在自身可用历史样本中的分位；20/40/60/80 分位切分为五档，阈值为全样本回看口径。",
            "composite": "PE、股息率（反向）、ERP（反向）三个分位的等权平均，越高越贵。",
        },
        "limitations": [
            "ETF 不逐日披露组合 PE；PE-TTM 为锚定公开现值后的模型估算，适合观察趋势与相对分位，不宜当作官方净值指标。",
            "PE 与 SPY 的对比跨越价值/成长风格，折溢价不能被直接解读为收益预测。",
            f"历史样本自 {cfg['inception']} 成立起，分位数会随新数据累积而变化。",
            "股息率使用历史实际派息，不代表未来分配。",
        ],
        "page": {
            "eyebrow": cfg["eyebrow"],
            "hero_title": cfg["hero_title"],
            "hero_lede": cfg["hero_lede"],
            "price_head": cfg["price_head"],
            "price_sub": cfg["price_sub"],
            "val_head": cfg["val_head"],
            "val_sub": cfg["val_sub"],
            "income_head": cfg["income_head"],
            "income_sub": cfg["income_sub"],
        },
    }

    payload = {
        "meta": meta,
        "current": current,
        "quantiles": quantiles,
        "series": series,
        "monthly": monthly,
        "quarterly": quarterly,
        "log": log,
        "insights": insights,
        "spy": spy,
        "comparison": comparison,
        "seasonality": build_seasonality(df),
        "stats": {
            "pe_min": round(float(df["pe"].min()), 2),
            "pe_max": round(float(df["pe"].max()), 2),
            "dy_min": round(float(df["dy"].min()), 2),
            "dy_max": round(float(df["dy"].max()), 2),
            "erp_min": round(float(df["erp"].min()), 2),
            "erp_max": round(float(df["erp"].max()), 2),
            "erp_mean": round(float(df["erp"].mean()), 2),
            "ust_mean": round(float(df["ust10y"].mean()), 2),
            "relative_min": round(float(df["relative_tr"].min()), 2),
            "relative_max": round(float(df["relative_tr"].max()), 2),
            "start": df.index.min().strftime("%Y-%m-%d"),
        },
    }
    return payload, cfg


def write_csv(payload: dict, ticker: str) -> None:
    rows = payload["series"]
    cols = [
        "date", "close", "pe", "dy", "erp", "ust10y", "earnings_yield",
        "ttm_div", "composite", "pct_pe", "pct_dy",
        "pct_erp", "regime", "etf_tr", "spy_tr", "relative_tr", "spy_dy",
    ]
    with open(SITE_DATA / f"{ticker.lower()}_daily.csv", "w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def render_page(cfg: dict) -> None:
    template = (TEMPLATES / "page.html").read_text(encoding="utf-8")
    page_cfg = {
        "ticker": cfg["ticker"],
        "theme": cfg["theme"],
        "name": cfg["name"],
        "csv": f"data/{cfg['ticker'].lower()}_daily.csv",
        "eyebrow": cfg["eyebrow"],
        "hero_title": cfg["hero_title"],
        "hero_lede": cfg["hero_lede"],
        "price_head": cfg["price_head"],
        "price_sub": cfg["price_sub"],
        "val_head": cfg["val_head"],
        "val_sub": cfg["val_sub"],
        "income_head": cfg["income_head"],
        "income_sub": cfg["income_sub"],
    }
    page = template.replace(
        "{{PAGE_DATA_SCRIPT}}",
        f'<script src="data/{cfg["ticker"].lower()}.js"></script>',
    ).replace(
        "{{PAGE_CONFIG}}",
        "window.PAGE_CONFIG = " + json.dumps(page_cfg, ensure_ascii=False) + ";",
    )
    (SITE / f"{cfg['ticker'].lower()}.html").write_text(page, encoding="utf-8")


def build_hub(payloads: list[dict]) -> None:
    funds = []
    for payload in payloads:
        meta, current, comparison = payload["meta"], payload["current"], payload["comparison"]
        funds.append({
            "ticker": meta["ticker"],
            "name": meta["name"],
            "short": meta["short"],
            "theme": meta["theme"],
            "price": current["price"],
            "change_1d": current["price_change_1d"],
            "pe": current["pe"],
            "forward_pe": current["forward_pe"],
            "peg": current["peg"],
            "pe_pct": current["pct_pe"],
            "dy": current["dy"],
            "erp": current["erp"],
            "composite": current["composite"],
            "regime": current["regime"],
            "spy_discount": comparison["pe_discount"],
            "relative_1y": comparison["relative_1y"],
            "spark": [d["close"] for d in payload["series"][-90:]],
            "href": f"{meta['ticker'].lower()}.html",
        })
    hub = {
        "as_of": payloads[0]["meta"]["as_of"],
        "generated_at": payloads[0]["meta"]["generated_at"],
        "spy": payloads[0]["spy"],
        "funds": funds,
    }
    with open(SITE_DATA / "hub.js", "w", encoding="utf-8") as fh:
        fh.write("window.HUB_DATA = ")
        json.dump(hub, fh, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        fh.write(";\n")
    with open(SITE_DATA / "hub.json", "w", encoding="utf-8") as fh:
        json.dump(hub, fh, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def build_sector_ratio() -> None:
    """XLK / XLP total-return ratio, YoY curve and monthly MACD(12,26,9)."""
    xlk, _ = load_yahoo(RAW / "xlk_yahoo.json")
    xlp, _ = load_yahoo(RAW / "xlp_yahoo.json")
    pair = pd.concat(
        [xlk["adjclose"].rename("xlk"), xlp["adjclose"].rename("xlp")],
        axis=1,
    ).dropna().sort_index()
    ratio = pair["xlk"] / pair["xlp"]
    yoy = (ratio / ratio.shift(252) - 1.0) * 100.0

    # Monthly MACD keeps the lower panel on a slower horizon than the noisy
    # monthly MACD is a slower companion to the YoY ratio curve.
    monthly = ratio.resample("ME").last().dropna()
    ema12 = monthly.ewm(span=12, adjust=False).mean()
    ema26 = monthly.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    hist = macd - signal

    frame = pd.DataFrame({"ratio": ratio, "yoy": yoy})
    frame = frame[frame["yoy"].notna()].copy()
    mean = float(frame["yoy"].mean())
    p20 = float(frame["yoy"].quantile(0.20))
    p80 = float(frame["yoy"].quantile(0.80))
    last = frame.iloc[-1]
    series = [
        {
            "date": idx.strftime("%Y-%m-%d"),
            "ratio": round(float(row.ratio), 4),
            "yoy": round(float(row.yoy), 2),
        }
        for idx, row in frame.iterrows()
    ]
    macd_rows = [
        {
            "date": idx.strftime("%Y-%m-%d"),
            "macd": round(float(macd.loc[idx]), 5),
            "signal": round(float(signal.loc[idx]), 5),
            "hist": round(float(hist.loc[idx]), 5),
        }
        for idx in monthly.index
        if idx >= frame.index[0]
    ]
    payload = {
        "meta": {
            "ticker": "XLK/XLP",
            "name": "Technology Select Sector SPDR / Consumer Staples Select Sector SPDR",
            "as_of": frame.index[-1].strftime("%Y-%m-%d"),
            "start": frame.index[0].strftime("%Y-%m-%d"),
            "n": int(len(frame)),
            "source": "Yahoo Finance adjusted close; ratio = XLK total return / XLP total return",
        },
        "current": {
            "date": frame.index[-1].strftime("%Y-%m-%d"),
            "ratio": round(float(last.ratio), 3),
            "yoy": round(float(last.yoy), 2),
            "mean": round(mean, 2),
            "p20": round(p20, 2),
            "p80": round(p80, 2),
            "percentile": round(float((frame["yoy"] <= last.yoy).mean() * 100), 1),
            "macd": round(float(macd.iloc[-1]), 5),
            "signal": round(float(signal.iloc[-1]), 5),
            "hist": round(float(hist.iloc[-1]), 5),
        },
        "series": series,
        "macd": macd_rows,
    }
    with open(SITE_DATA / "xlk_xlp.js", "w", encoding="utf-8") as fh:
        fh.write("window.SECTOR_RATIO = ")
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        fh.write(";\n")
    with open(SITE_DATA / "xlk_xlp.json", "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    print(
        f"XLK/XLP: ratio={payload['current']['ratio']:.2f} "
        f"YoY={payload['current']['yoy']:.1f}% percentile={payload['current']['percentile']:.0f}%"
    )


def main() -> None:
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    anchors = json.loads((RAW / "anchors.json").read_text(encoding="utf-8"))
    spy_df, spy_divs = load_yahoo(RAW / "spy_yahoo.json")
    tnx_df, _ = load_yahoo(RAW / "tnx_yahoo.json")
    gspc_df, _ = load_yahoo(RAW / "gspc_yahoo.json")
    pe_monthly = fetch_sp500_pe()

    payloads = []
    for cfg in FUNDS:
        payload, _ = build_one(cfg, anchors, spy_df, spy_divs, tnx_df, gspc_df, pe_monthly)
        payloads.append(payload)
        ticker = cfg["ticker"]
        with open(SITE_DATA / f"{ticker.lower()}.js", "w", encoding="utf-8") as fh:
            fh.write("window.ETF_DATA = ")
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            fh.write(";\n")
        with open(SITE_DATA / f"{ticker.lower()}.json", "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        write_csv(payload, ticker)
        render_page(cfg)
        cur = payload["current"]
        print(
            f"{ticker}: ${cur['price']:.2f} PE={cur['pe']:.2f} DY={cur['dy']:.2f}% "
            f"ERP={cur['erp']:.2f}% vsSPY={payload['comparison']['pe_discount']:.1f}% "
            f"composite={cur['composite']:.1f} ({cur['regime']})"
        )

    build_hub(payloads)
    build_sector_ratio()
    print(f"Wrote {len(payloads)} ETF pages and hub.")


if __name__ == "__main__":
    main()
