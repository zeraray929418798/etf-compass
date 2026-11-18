"""SPY comparison helpers shared by the six ETF pages."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd


def ttm_distributions(
    dates: pd.DatetimeIndex,
    divs: pd.DataFrame,
    prices: pd.Series,
) -> tuple[list[float], list[float]]:
    """Return (TTM cash distribution, TTM yield %) for each date.

    The TTM window is only published once a full 12 months of distribution
    history exists, matching the main ETF yield logic.
    """
    divs = divs.sort_values("date").reset_index(drop=True)
    first = divs["date"].min() if not divs.empty else None
    ttm_values: list[float] = []
    yields: list[float] = []
    for d in dates:
        if first is None or (d - first).days < 365:
            ttm_values.append(np.nan)
            yields.append(np.nan)
            continue
        window = divs[(divs["date"] > d - pd.Timedelta(days=365)) & (divs["date"] <= d)]
        ttm = float(window["amount"].sum())
        ttm_values.append(ttm)
        yields.append(ttm / float(prices.loc[d]) * 100.0)
    return ttm_values, yields


def _return(series: pd.Series, periods: int) -> float | None:
    if len(series) <= periods:
        return None
    return float(series.iloc[-1] / series.iloc[-1 - periods] - 1.0)


def _cagr(series: pd.Series) -> float:
    days = max((series.index[-1] - series.index[0]).days, 1)
    return float((series.iloc[-1] / series.iloc[0]) ** (365.25 / days) - 1.0)


def _max_drawdown(series: pd.Series) -> float:
    return float((series / series.cummax() - 1.0).min())


def _annualized_vol(series: pd.Series) -> float:
    rets = np.log(series / series.shift(1)).dropna().tail(252)
    return float(rets.std() * math.sqrt(252))


def attach_spy(
    df: pd.DataFrame,
    spy_df: pd.DataFrame,
    spy_divs: pd.DataFrame,
    spy_pe: float,
    spy_forward_pe: float,
    etf_forward_pe: float,
) -> tuple[pd.DataFrame, dict, dict]:
    """Add SPY total-return, yield and relative-strength columns to df.

    df must contain: close, adjclose, ust10y and a DatetimeIndex.
    spy_df must contain: close, adjclose and a DatetimeIndex.
    """
    q = spy_df[["close", "adjclose"]].reindex(df.index).ffill().bfill()
    df["spy_close"] = q["close"]
    df["spy_adj"] = q["adjclose"]

    spy_ttm, spy_dy = ttm_distributions(df.index, spy_divs, q["close"])
    df["spy_ttm_div"] = spy_ttm
    df["spy_dy"] = spy_dy

    df["etf_tr"] = df["adjclose"] / float(df["adjclose"].iloc[0]) * 100.0
    df["spy_tr"] = df["spy_adj"] / float(df["spy_adj"].iloc[0]) * 100.0
    df["relative_tr"] = df["etf_tr"] / df["spy_tr"] * 100.0

    ust = float(df["ust10y"].iloc[-1])
    etf_1y = _return(df["adjclose"], 252)
    spy_1y = _return(df["spy_adj"], 252)
    etf_since = float(df["etf_tr"].iloc[-1] / 100.0 - 1.0)
    spy_since = float(df["spy_tr"].iloc[-1] / 100.0 - 1.0)
    rel_1y = ((1.0 + etf_1y) / (1.0 + spy_1y) - 1.0) if etf_1y is not None and spy_1y is not None else None
    rel_since = float(df["relative_tr"].iloc[-1] / 100.0 - 1.0)
    rel_pct = float((df["relative_tr"] <= df["relative_tr"].iloc[-1]).mean() * 100.0)

    spy = {
        "ticker": "SPY",
        "name": "SPDR S&P 500 ETF Trust",
        "as_of": df.index[-1].strftime("%Y-%m-%d"),
        "price": round(float(df["spy_close"].iloc[-1]), 2),
        "pe": round(float(spy_pe), 2),
        "forward_pe": round(float(spy_forward_pe), 2),
        "dy": round(float(df["spy_dy"].iloc[-1]), 2),
        "ttm_div": round(float(df["spy_ttm_div"].iloc[-1]), 3),
        "erp": round(100.0 / float(spy_pe) - ust, 2),
        "forward_erp": round(100.0 / float(spy_forward_pe) - ust, 2),
        "earnings_yield": round(100.0 / float(spy_pe), 2),
        "forward_earnings_yield": round(100.0 / float(spy_forward_pe), 2),
        "return_1y": round(spy_1y * 100, 2) if spy_1y is not None else None,
        "return_since_common": round(spy_since * 100, 2),
        "cagr_since_common": round(_cagr(df["spy_adj"]) * 100, 2),
        "vol_1y": round(_annualized_vol(df["spy_adj"]) * 100, 2),
        "max_drawdown": round(_max_drawdown(df["spy_adj"]) * 100, 2),
    }

    comparison = {
        "common_start": df.index[0].strftime("%Y-%m-%d"),
        "common_days": int((df.index[-1] - df.index[0]).days),
        "pe_discount": round((1.0 - float(df["pe"].iloc[-1]) / float(spy_pe)) * 100.0, 1),
        "forward_pe_discount": round((1.0 - float(etf_forward_pe) / float(spy_forward_pe)) * 100.0, 1),
        "dy_spread": round(float(df["dy"].iloc[-1] - df["spy_dy"].iloc[-1]), 2),
        "erp_spread": round(float(df["erp"].iloc[-1] - (100.0 / float(spy_pe) - ust)), 2),
        "forward_erp_spread": round((100.0 / float(etf_forward_pe) - ust) - (100.0 / float(spy_forward_pe) - ust), 2),
        "relative_1y": round(rel_1y * 100.0, 2) if rel_1y is not None else None,
        "relative_since_common": round(rel_since * 100.0, 2),
        "relative_percentile": round(rel_pct, 1),
        "etf_total_return": round(etf_since * 100, 2),
        "spy_total_return": round(spy_since * 100, 2),
    }
    return df, spy, comparison
