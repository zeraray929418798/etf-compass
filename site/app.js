/* =========================================================
   CASH COW LAB · ETF Valuation Terminal
   ========================================================= */
(() => {
  "use strict";

  const CFG = window.PAGE_CONFIG || {};
  const D = window.ETF_DATA;
  const S = D && D.series;
  const C = D && D.current;
  const M = D && D.meta;
  if (!D || !S || !S.length) {
    document.body.innerHTML = '<div style="padding:80px;color:#e9eef5;font-family:sans-serif">数据文件未加载：请通过本地服务器打开站点，或检查 data.js。</div>';
    return;
  }

  const $ = (id) => document.getElementById(id);
  const DAY = 86400000;
  const ts = (dateStr) => Date.parse(dateStr + "T00:00:00Z");
  const firstTs = ts(S[0].date);
  const lastTs = ts(S[S.length - 1].date);
  const charts = {};
  const state = { range: "all", customStart: null };

  const COLORS = {
    gold: "#e3b46a",
    goldSoft: "#f0d5a7",
    teal: "#55c7b2",
    green: "#54b78b",
    red: "#e06767",
    orange: "#dd9159",
    blue: "#6aa7ef",
    muted: "#8b9aac",
    dim: "#5b6a7c",
    grid: "rgba(255,255,255,.055)",
    axis: "rgba(255,255,255,.1)",
  };

  const FONT = "'Aptos','Segoe UI','PingFang SC','Microsoft YaHei',sans-serif";
  const NUM = "'Bahnschrift','DIN Alternate','Aptos Display','Segoe UI',sans-serif";

  /* ---------------- formatting ---------------- */
  const num = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(d));
  const discountText = (v, d = 1) => `${v >= 0 ? "-" : "+"}${num(Math.abs(v), d)}%`;
  const peWord = (v) => (v >= 0 ? "折价" : "溢价");
  const money = (v, d = 2) => (v == null ? "—" : "$" + Number(v).toFixed(d));
  const signed = (v, d = 2) => {
    if (v == null || Number.isNaN(Number(v))) return "—";
    return (Number(v) >= 0 ? "+" : "") + Number(v).toFixed(d) + "%";
  };
  const signedBps = (v) => {
    if (v == null || Number.isNaN(Number(v))) return "—";
    return (Number(v) >= 0 ? "+" : "") + Math.round(Number(v) * 100) + "bp";
  };
  const aumLabel = (v) => (v == null ? "—" : v >= 1e9 ? "$" + (v / 1e9).toFixed(1) + "B" : "$" + (v / 1e6).toFixed(0) + "M");
  const dateLong = (value) => new Date(value).toLocaleDateString("zh-CN", {
    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const dateShort = (value) => {
    const d = new Date(value);
    return String(d.getUTCFullYear()).slice(2) + "." + String(d.getUTCMonth() + 1).padStart(2, "0");
  };
  const quarterLabel = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00Z");
    return String(d.getUTCFullYear()).slice(2) + "Q" + (Math.floor(d.getUTCMonth() / 3) + 1);
  };
  const changePct = (key, lookback) => {
    const i = S.length - 1 - lookback;
    if (i < 0 || S[i][key] == null || S[S.length - 1][key] == null) return null;
    return (S[S.length - 1][key] / S[i][key] - 1) * 100;
  };
  const changeAbs = (key, lookback) => {
    const i = S.length - 1 - lookback;
    if (i < 0 || S[i][key] == null || S[S.length - 1][key] == null) return null;
    return S[S.length - 1][key] - S[i][key];
  };
  const median = (key) => {
    const arr = S.map((d) => d[key]).filter((v) => v != null).sort((a, b) => a - b);
    if (!arr.length) return null;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  };
  const regimeClass = (r) => {
    if (!r) return "neutral";
    if (r.includes("高估")) return "red";
    if (r.includes("偏高")) return "amber";
    if (r.includes("低估")) return "green";
    return "neutral";
  };
  const badgeClass = (r) => {
    if (!r) return "badge";
    if (r.includes("高估")) return "badge badge-red";
    if (r.includes("偏高")) return "badge badge-amber";
    if (r.includes("低估")) return "badge badge-green";
    return "badge badge-teal";
  };

  /* ---------------- page branding ---------------- */
  function applyPageConfig() {
    const c = CFG;
    document.body.dataset.theme = c.theme || M.theme || "vflo";
    document.title = `${M.ticker} 估值罗盘 · CASH COW LAB`;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", `${M.name}（${M.ticker}）长期估值追踪：价格、PE-TTM、股息率、股权风险溢价及与 SPY 的对比。`);
    $("heroEyebrow").textContent = c.eyebrow || `${M.name} · ${M.ticker}`;
    $("heroTitle").innerHTML = c.hero_title || M.ticker;
    $("heroLede").innerHTML = c.hero_lede || "";
    $("priceHead").textContent = c.price_head || "价格";
    $("priceSub").textContent = c.price_sub || "";
    $("valHead").textContent = c.val_head || "估值";
    $("valSub").textContent = c.val_sub || "";
    $("incomeHead").textContent = c.income_head || "股息";
    $("incomeSub").textContent = c.income_sub || "";

    $("factInception").textContent = M.inception.slice(0, 7).replace("-", ".");
    $("factExpense").textContent = (M.expense * 100).toFixed(2) + "%";
    $("factAum").textContent = aumLabel(M.aum);
    $("factHoldings").textContent = M.holdings;
    $("tickTicker").textContent = M.ticker;
    $("priceLegendTicker").textContent = M.ticker;
    $("perfLegendTicker").textContent = M.ticker;
    $("perfTitleTicker").textContent = M.ticker;
    $("relativeTicker").textContent = M.ticker;
    $("yieldLegendTicker").textContent = M.ticker;
    $("relativeFoot").textContent = `起点 = 100，向上代表 ${M.ticker} 跑赢`;
    $("spyEtfHeader").textContent = M.ticker;
    $("footerTicker").textContent = `${M.ticker} · ${M.exchange}`;
    $("opsTickers").textContent = M.ticker;
    $("csvLink").href = c.csv || `data/${M.ticker.toLowerCase()}_daily.csv`;
    $("jsonLink").href = `data/${M.ticker.toLowerCase()}.json`;

    document.querySelectorAll(".etf-nav a").forEach((a) => {
      a.classList.toggle("is-active", a.dataset.ticker === M.ticker);
    });
  }

  /* ---------------- hero / header ---------------- */
  function renderHero() {
    $("topAsOf").textContent = C.date.replaceAll("-", ".");
    $("heroPrice").textContent = num(C.price, 2);
    const chg = $("heroChange");
    chg.textContent = signed(C.price_change_1d);
    chg.className = "chg " + (C.price_change_1d >= 0 ? "up" : "down");
    const pos = Math.max(0, Math.min(100, ((C.price - C.low_52w) / (C.high_52w - C.low_52w)) * 100));
    const pricePct = (S.filter((d) => d.close <= C.price).length / S.length) * 100;
    $("rangeFill").style.width = pos + "%";
    $("rangeDot").style.left = pos + "%";
    $("rangeText").textContent = "历史分位 " + Math.round(pricePct) + "% · " + money(C.low_52w) + " — " + money(C.high_52w);

    $("tickPrice").textContent = "$" + num(C.price);
    $("tickChg").textContent = signed(C.price_change_1d);
    $("tickPe").textContent = num(C.pe) + "x";
    $("tickPePct").textContent = Math.round(C.pct_pe) + "% 分位";
    $("tickSpyDiscount").textContent = discountText(D.comparison.pe_discount, 1);
    $("tickSpyLabel").textContent = `TTM PE ${peWord(D.comparison.pe_discount)}`;
    if ($("auditNote")) {
      $("auditNote").textContent = `数据审计：PE / Forward PE 同源同日（StockAnalysis，${D.meta.as_of}）；PEG 长期增速来自 Morningstar（${D.meta.lt_growth_as_of || "—"}）；价格与股息来自 Yahoo Finance；季节性只用完整月份总回报。`;
    }
    $("tickDy").textContent = num(C.dy) + "%";
    $("tickDyPct").textContent = Math.round(C.pct_dy) + "% 分位";
    $("tickErp").textContent = num(C.erp) + "%";
    $("tickUst").textContent = "10Y " + num(C.ust10y) + "%";

    const badge = $("regimeBadge");
    badge.textContent = C.regime;
    badge.className = badgeClass(C.regime);
    $("gaugeScore").textContent = Math.round(C.pct_composite);
    $("gaugeVerdict").textContent = C.regime === "高估"
      ? "自身历史分位仍高，估值压力主要来自价格与风险溢价。"
      : C.regime === "偏高"
        ? "估值处于历史中枢上方，但仍需结合盈利增长观察。"
        : C.regime === "适中"
          ? "估值落在历史中枢附近，没有明显的极端信号。"
          : "估值处于历史低位，安全垫相对更厚。";
  }

  function buildGauge() {
    const svgSeg = $("gaugeSegments");
    const cx = 160, cy = 156, r = 120;
    const ns = "http://www.w3.org/2000/svg";
    const polar = (radius, angle) => {
      const rad = (angle * Math.PI) / 180;
      return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
    };
    const arc = (radius, a0, a1) => {
      const p0 = polar(radius, a0), p1 = polar(radius, a1);
      return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
    };
    const mk = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      return el;
    };

    // base arc
    svgSeg.appendChild(mk("path", {
      d: arc(r, 180, 360), fill: "none", stroke: "rgba(255,255,255,.055)",
      "stroke-width": 14, "stroke-linecap": "round",
    }));

    const colors = ["#3c9f85", "#69b894", "#c7aa5d", "#d88a53", "#d25a5c"];
    for (let i = 0; i < 5; i++) {
      const a0 = 180 + i * 36 + 1.5;
      const a1 = 180 + (i + 1) * 36 - 1.5;
      svgSeg.appendChild(mk("path", {
        d: arc(r, a0, a1), fill: "none", stroke: colors[i],
        "stroke-width": 14, "stroke-linecap": "round", opacity: .9,
      }));
    }

    const ticks = $("gaugeTicks");
    [0, 25, 50, 75, 100].forEach((pct) => {
      const angle = 180 + pct * 1.8;
      const p0 = polar(r - 13, angle), p1 = polar(r - 6, angle);
      ticks.appendChild(mk("line", { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y }));
      if (pct % 50 === 0) {
        const p = polar(r + 16, angle);
        const label = mk("text", {
          x: p.x, y: p.y + 3, fill: "rgba(139,154,172,.75)", "font-size": 8,
          "font-family": "Bahnschrift, Segoe UI, sans-serif", "text-anchor": "middle",
        });
        label.textContent = String(pct);
        ticks.appendChild(label);
      }
    });

    requestAnimationFrame(() => {
      const angle = -90 + Math.max(0, Math.min(100, C.pct_composite)) * 1.8;
      $("gaugeNeedle").style.transform = `rotate(${angle}deg)`;
    });
  }

  /* ---------------- metric cards ---------------- */
  function sparkline(key, accent) {
    const vals = S.slice(-120).map((d) => d[key]).filter((v) => v != null);
    if (vals.length < 3) return "";
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * 120;
      const y = 28 - ((v - min) / span) * 24;
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    const area = "M0,32 L" + pts.join(" L") + " L120,32 Z";
    return `<svg class="mc-spark" viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true" style="color:${accent}"><path d="${area}"/><polyline points="${pts.join(" ")}"/></svg>`;
  }

  function renderMetricCards() {
    const cards = [
      {
        target: "#price", label: "PRICE / 收盘价", value: money(C.price), small: "",
        sub: `52周 ${money(C.low_52w)} – ${money(C.high_52w)}`,
        foot: "1M", footVal: signed(C.price_change_1m), accent: COLORS.gold, spark: "close",
      },
      {
        target: "#valuation", label: "PE-TTM", value: num(C.pe), small: "x",
        sub: `历史 <b>${Math.round(C.pct_pe)}%</b> 分位 · 中位 ${num(C.median_pe)}x`,
        foot: "1M", footVal: signed(changePct("pe", 21)), accent: COLORS.gold, spark: "pe",
      },
      {
        target: "#valuation", label: "FWD PE / PEG", value: num(C.forward_pe), small: "x",
        sub: `PEG <b>${num(C.peg)}</b> · 长期增速 ${num(C.lt_growth, 1)}%`,
        foot: "TTM", footVal: `${num(C.pe)}x`, accent: COLORS.blue, spark: null,
      },
      {
        target: "#spy", label: "VS SPY", value: num(Math.abs(D.comparison.pe_discount), 0), small: "%",
        sub: `TTM PE ${peWord(D.comparison.pe_discount)} · 1Y 相对 <b>${D.comparison.relative_1y >= 0 ? "+" : ""}${num(D.comparison.relative_1y, 1)}pp</b>`,
        foot: "相对强弱", footVal: `${num(D.comparison.relative_percentile, 1)}% 分位`, accent: COLORS.orange, spark: "relative_tr",
      },
      {
        target: "#income", label: "DIVIDEND YIELD", value: num(C.dy), small: "%",
        sub: `TTM 派息 <b>$${num(C.ttm_div, 3)}</b> · ${Math.round(C.pct_dy)}% 分位`,
        foot: "1M", footVal: signedBps(changeAbs("dy", 21)), accent: COLORS.teal, spark: "dy",
      },
      {
        target: "#risk", label: "ERP / 风险溢价", value: num(C.erp), small: "%",
        sub: `10Y <b>${num(C.ust10y)}%</b> · ${Math.round(C.pct_erp)}% 分位`,
        foot: "1M", footVal: signedBps(changeAbs("erp", 21)), accent: COLORS.red, spark: "erp",
      },
    ];

    $("metricCards").innerHTML = cards.map((c) => `
      <article class="metric-card reveal" data-target="${c.target}" tabindex="0" role="link" aria-label="查看 ${c.label} 图表" style="--accent:${c.accent}">
        <div class="mc-top"><span class="mc-label">${c.label}</span><span class="mc-dot"></span></div>
        <div class="mc-value">${c.value}${c.small ? `<small>${c.small}</small>` : ""}</div>
        <div class="mc-sub">${c.sub}</div>
        ${c.spark ? sparkline(c.spark, c.accent) : ""}
        <div class="mc-foot"><span>${c.foot}</span><b class="${String(c.footVal).startsWith('+') ? 'up' : String(c.footVal).startsWith('-') ? 'down' : ''}">${c.footVal}</b></div>
      </article>
    `).join("");

    document.querySelectorAll(".metric-card").forEach((card) => {
      const go = () => document.querySelector(card.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
      card.addEventListener("click", go);
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }

  /* ---------------- compass ---------------- */
  function renderCompass() {
    const rows = [
      { label: "PE-TTM", raw: num(C.pe) + "x", pct: C.pct_pe, exp: C.pct_pe },
      { label: "股息率", raw: num(C.dy) + "%", pct: C.pct_dy, exp: 100 - C.pct_dy },
      { label: "风险溢价", raw: num(C.erp) + "%", pct: C.pct_erp, exp: 100 - C.pct_erp },
      { label: "综合", raw: Math.round(C.pct_composite) + " / 100", pct: C.pct_composite, exp: C.pct_composite },
    ];
    const verdict = (v) => v >= 80 ? "高估" : v >= 60 ? "偏高" : v >= 40 ? "适中" : v >= 20 ? "低估" : "深度低估";
    $("compassList").innerHTML = rows.map((r) => `
      <div class="compass-row">
        <div class="cr-label"><b>${r.label}</b><span>${r.raw}</span></div>
        <div class="cr-track" style="--p:${r.exp}">
          <span class="cr-tick" style="left:20%"></span><span class="cr-tick" style="left:40%"></span>
          <span class="cr-tick" style="left:60%"></span><span class="cr-tick" style="left:80%"></span>
          <span class="cr-marker" style="left:${r.exp}%"></span>
        </div>
        <div class="cr-value"><b>${Math.round(r.exp)}</b><small>% 昂贵度</small><em>${verdict(r.exp)}</em></div>
      </div>
    `).join("");
    $("compassFootNote").textContent = `综合估值 ${Math.round(C.pct_composite)} / 100 · ${C.regime}`;
  }

  function renderInsights() {
    $("insightStack").innerHTML = D.insights.map((it) => `
      <article class="insight-card ${it.tone}">
        <span class="insight-tag">${it.tag}</span>
        <h4>${it.title}</h4>
        <p>${it.body}</p>
      </article>
    `).join("");
  }

  /* ---------------- Chart.js defaults & plugins ---------------- */
  Chart.defaults.color = COLORS.muted;
  Chart.defaults.font.family = FONT;
  Chart.defaults.font.size = 10;
  Chart.defaults.borderColor = COLORS.grid;
  // Multi-year series can contain 2,500+ points; skip the entry animation so
  // page switching stays fast on laptops and phones.
  Chart.defaults.animation.duration = 0;
  Chart.defaults.animation.easing = "linear";
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.backgroundColor = "rgba(8,13,19,.96)";
  Chart.defaults.plugins.tooltip.borderColor = "rgba(255,255,255,.12)";
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 11;
  Chart.defaults.plugins.tooltip.titleColor = "#e9eef5";
  Chart.defaults.plugins.tooltip.bodyColor = "#a7b5c5";
  Chart.defaults.plugins.tooltip.titleFont = { family: FONT, size: 10, weight: "600" };
  Chart.defaults.plugins.tooltip.bodyFont = { family: NUM, size: 10 };
  Chart.defaults.plugins.tooltip.displayColors = false;
  Chart.defaults.plugins.tooltip.cornerRadius = 7;
  Chart.defaults.plugins.tooltip.caretSize = 5;

  const bandsPlugin = {
    id: "bands",
    beforeDatasetsDraw(chart, _args, opts) {
      if (!opts || !Array.isArray(opts.thresholds) || opts.thresholds.length !== 4) return;
      const area = chart.chartArea;
      const y = chart.scales.y;
      if (!area || !y) return;
      const ctx = chart.ctx;
      const clamp = (v) => Math.max(area.top, Math.min(area.bottom, v));
      const ys = opts.thresholds.map((v) => clamp(y.getPixelForValue(v)));
      const colors = opts.colors;
      ctx.save();
      for (let i = 0; i < 5; i++) {
        const top = i === 4 ? area.top : ys[i];
        const bottom = i === 0 ? area.bottom : ys[i - 1];
        if (bottom <= top) continue;
        ctx.fillStyle = colors[i];
        ctx.fillRect(area.left, top, area.right - area.left, bottom - top);
      }
      ctx.strokeStyle = "rgba(255,255,255,.075)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ys.forEach((py) => {
        ctx.beginPath();
        ctx.moveTo(area.left, py);
        ctx.lineTo(area.right, py);
        ctx.stroke();
      });
      ctx.restore();
    },
  };

  const crosshairPlugin = {
    id: "crosshair",
    afterDatasetsDraw(chart) {
      const active = chart.tooltip?.getActiveElements?.() || [];
      if (!active.length) return;
      const x = active[0].element.x;
      const area = chart.chartArea;
      if (!area) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x, area.top);
      ctx.lineTo(x, area.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };
  Chart.register(bandsPlugin, crosshairPlugin);

  const HIGH_BANDS = [
    "rgba(84,183,139,.13)", "rgba(84,183,139,.085)",
    "rgba(227,180,106,.055)", "rgba(221,145,89,.085)", "rgba(224,103,103,.13)",
  ];
  const LOW_BANDS = [
    "rgba(224,103,103,.13)", "rgba(221,145,89,.085)",
    "rgba(227,180,106,.055)", "rgba(84,183,139,.085)", "rgba(84,183,139,.13)",
  ];

  function tooltip(fmt) {
    return {
      mode: "index",
      intersect: false,
      filter: (item) => item.dataset.showTooltip !== false,
      callbacks: {
        title: (items) => items.length ? dateLong(items[0].parsed.x) : "",
        label: (ctx) => {
          const v = ctx.parsed.y;
          return "  " + ctx.dataset.label + "   " + (v == null ? "—" : fmt(v));
        },
      },
    };
  }

  function xAxis(showTicks) {
    return {
      type: "linear",
      min: firstTs,
      max: lastTs + 3 * DAY,
      grid: { display: false },
      border: { display: false },
      ticks: {
        display: showTicks,
        color: COLORS.dim,
        maxTicksLimit: 6,
        count: 6,
        maxRotation: 0,
        autoSkip: false,
        font: { family: NUM, size: 9 },
        callback: (v) => dateShort(v),
      },
    };
  }

  function yAxis(fmt) {
    return {
      position: "right",
      grace: "7%",
      grid: { color: COLORS.grid, drawTicks: false },
      border: { display: false },
      ticks: {
        color: COLORS.dim,
        padding: 8,
        maxTicksLimit: 5,
        font: { family: NUM, size: 9 },
        callback: (v) => fmt(v),
      },
    };
  }

  function line(label, data, color, opts = {}) {
    return {
      label,
      data,
      borderColor: color,
      backgroundColor: color,
      borderWidth: opts.width || 1.8,
      pointRadius: 0,
      pointHoverRadius: 3.5,
      pointHoverBackgroundColor: color,
      pointHoverBorderColor: "#fff",
      pointHoverBorderWidth: 1.2,
      tension: opts.tension ?? 0.16,
      fill: opts.fill || false,
      spanGaps: opts.spanGaps ?? true,
      order: opts.order ?? 2,
      showTooltip: opts.showTooltip !== false,
      ...opts.extra,
    };
  }

  function currentPoint(value, color) {
    return {
      label: "当前",
      data: [{ x: lastTs, y: value }],
      showLine: false,
      pointRadius: 4.5,
      pointHoverRadius: 6,
      pointBackgroundColor: color,
      pointBorderColor: "#f5f8fc",
      pointBorderWidth: 1.5,
      order: 0,
      showTooltip: false,
      _current: true,
    };
  }

  function medianLine(value, xMin = firstTs, xMax = lastTs) {
    return {
      label: "历史中位数",
      data: [{ x: xMin, y: value }, { x: xMax, y: value }],
      borderColor: "rgba(255,255,255,.36)",
      borderDash: [4, 5],
      borderWidth: 1,
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: false,
      order: 1,
      showTooltip: false,
    };
  }

  function baseOptions(fmt, showTicks) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 4, right: 2, left: 0, bottom: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: tooltip(fmt),
      },
      scales: {
        x: xAxis(showTicks),
        y: yAxis(fmt),
      },
    };
  }

  /* ---------------- price chart ---------------- */
  function buildPriceChart() {
    const priceData = S.map((d) => ({ x: ts(d.date), y: d.close }));
    let sum = 0;
    const maData = S.map((d, i) => {
      sum += d.close;
      if (i >= 200) sum -= S[i - 200].close;
      return { x: ts(d.date), y: i >= 199 ? sum / 200 : null };
    });

    const gradient = (context) => {
      const { ctx, chartArea } = context.chart;
      if (!chartArea) return "rgba(227,180,106,.08)";
      const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      g.addColorStop(0, "rgba(227,180,106,.23)");
      g.addColorStop(0.72, "rgba(227,180,106,.04)");
      g.addColorStop(1, "rgba(227,180,106,0)");
      return g;
    };

    const options = baseOptions((v) => "$" + Number(v).toFixed(0), false);
    options.scales.y.grace = "3%";
    const minClose = Math.min(...S.map((d) => d.close));
    options.scales.y.min = Math.max(0, Math.floor(minClose * 0.9 / 5) * 5);
    options.scales.y.ticks.callback = (v) => "$" + Number(v).toFixed(0);
    options.plugins.tooltip.callbacks.label = (ctx) => {
      if (ctx.dataset.label.includes("均线")) return "  200DMA   $" + Number(ctx.parsed.y).toFixed(2);
      return "  " + M.ticker + "   $" + Number(ctx.parsed.y).toFixed(2);
    };
    options.plugins.tooltip.filter = (item) => item.dataset.label !== "当前";

    charts.price = new Chart($("priceChart"), {
      type: "line",
      data: {
        datasets: [
          {
            label: M.ticker + " 收盘价",
            data: priceData,
            borderColor: COLORS.gold,
            borderWidth: 1.9,
            backgroundColor: gradient,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: COLORS.gold,
            pointHoverBorderColor: "#fff",
            tension: 0.13,
            order: 3,
            _firstData: firstTs,
          },
          line("200 日均线", maData, "rgba(85,199,178,.75)", { width: 1.2, spanGaps: false, tension: 0.2 }),
          currentPoint(C.price, COLORS.gold),
        ],
      },
      options,
    });

    const running = [];
    let peak = -Infinity;
    S.forEach((d) => {
      peak = Math.max(peak, d.close);
      running.push({ x: ts(d.date), y: (d.close / peak - 1) * 100 });
    });

    const ddOptions = baseOptions((v) => Number(v).toFixed(0) + "%", true);
    ddOptions.scales.y.max = 0;
    ddOptions.scales.y.grace = "10%";
    ddOptions.plugins.tooltip.callbacks.label = (ctx) => "  回撤   " + Number(ctx.parsed.y).toFixed(1) + "%";
    ddOptions.plugins.tooltip.filter = (item) => item.dataset.label === "回撤";

    charts.dd = new Chart($("ddChart"), {
      type: "line",
      data: {
        datasets: [{
          label: "回撤",
          data: running,
          borderColor: "rgba(224,103,103,.8)",
          borderWidth: 1.2,
          backgroundColor: (context) => {
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return "rgba(224,103,103,.08)";
            const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, "rgba(224,103,103,.02)");
            g.addColorStop(1, "rgba(224,103,103,.18)");
            return g;
          },
          fill: true,
          pointRadius: 0,
          tension: 0.15,
        }],
      },
      options: ddOptions,
    });
  }

  /* ---------------- valuation charts ---------------- */
  function buildValuationChart(id, key, color, bandKey, direction, fmt, opts = {}) {
    const q = D.quantiles[bandKey];
    const thresholds = q ? [q.q20, q.q40, q.q60, q.q80] : null;
    const data = S.map((d) => ({ x: ts(d.date), y: d[key] ?? null }));
    const firstValid = S.find((d) => d[key] != null);
    const med = median(key);
    const datasets = [
      line(opts.label || key.toUpperCase(), data, color, {
        width: opts.width || 1.9,
        fill: false,
        tension: 0.16,
      }),
    ];
    if (med != null) datasets.push(medianLine(med));
    datasets.push(currentPoint(C[key], color));

    const options = baseOptions(fmt, opts.showX !== false);
    options.plugins.bands = {
      thresholds,
      colors: direction === "low" ? LOW_BANDS : HIGH_BANDS,
    };
    if (opts.yFmt) options.scales.y.ticks.callback = (v) => opts.yFmt(v);
    options.plugins.tooltip.filter = (item) => item.dataset.label !== "当前" && item.dataset.label !== "历史中位数";
    if (opts.yMax != null) options.scales.y.max = opts.yMax;
    if (opts.yMin != null) options.scales.y.min = opts.yMin;

    const chart = new Chart($(id), { type: "line", data: { datasets }, options });
    chart._firstData = firstValid ? ts(firstValid.date) : firstTs;
    charts[key] = chart;
    return chart;
  }

  function buildCharts() {
    buildPriceChart();

    buildValuationChart("peChart", "pe", COLORS.gold, "pe", "high", (v) => Number(v).toFixed(1) + "x", {
      label: "PE-TTM",
      yFmt: (v) => Number(v).toFixed(0) + "x",
    });

    buildValuationChart("dyChart", "dy", COLORS.teal, "dy", "low", (v) => Number(v).toFixed(2) + "%", {
      label: "股息率",
    });

    const erpData = S.map((d) => ({ x: ts(d.date), y: d.erp }));
    const ustData = S.map((d) => ({ x: ts(d.date), y: d.ust10y }));
    const erpQ = D.quantiles.erp;
    const erpMed = median("erp");
    const erpOptions = baseOptions((v) => Number(v).toFixed(1) + "%", true);
    erpOptions.plugins.bands = {
      thresholds: [erpQ.q20, erpQ.q40, erpQ.q60, erpQ.q80],
      colors: LOW_BANDS,
    };
    erpOptions.plugins.tooltip.filter = (item) => !["当前", "历史中位数"].includes(item.dataset.label);
    erpOptions.plugins.tooltip.callbacks.label = (ctx) => {
      const label = ctx.dataset.label;
      return "  " + label + "   " + Number(ctx.parsed.y).toFixed(2) + "%";
    };
    charts.erp = new Chart($("erpChart"), {
      type: "line",
      data: {
        datasets: [
          line("股权风险溢价", erpData, COLORS.red, { width: 2, order: 3 }),
          line("10 年期美债", ustData, "rgba(106,167,239,.72)", { width: 1.3, order: 2 }),
          medianLine(erpMed),
          currentPoint(C.erp, COLORS.red),
        ],
      },
      options: erpOptions,
    });
    charts.erp._firstData = firstTs;

    buildSPYCharts();
  }

  /* ---------------- SPY comparison ---------------- */
  function buildSPYCharts() {
    const ticker = M.ticker;

    const perfOptions = baseOptions((v) => Number(v).toFixed(0), true);
    perfOptions.scales.y.grace = "5%";
    perfOptions.plugins.tooltip.callbacks.label = (ctx) =>
      "  " + ctx.dataset.label + "   " + Number(ctx.parsed.y).toFixed(1);
    charts.performance = new Chart($("relativePerfChart"), {
      type: "line",
      data: {
        datasets: [
          line(ticker, S.map((d) => ({ x: ts(d.date), y: d.etf_tr })), COLORS.gold, { width: 2 }),
          line("SPY", S.map((d) => ({ x: ts(d.date), y: d.spy_tr })), "rgba(106,167,239,.8)", { width: 1.7 }),
        ],
      },
      options: perfOptions,
    });
    charts.performance._firstData = firstTs;

    const relativeOptions = baseOptions((v) => Number(v).toFixed(0), true);
    relativeOptions.plugins.tooltip.filter = (item) => !["当前", "100"].includes(item.dataset.label);
    relativeOptions.plugins.tooltip.callbacks.label = (ctx) =>
      "  相对强弱   " + Number(ctx.parsed.y).toFixed(1);
    charts.relative = new Chart($("relativeChart"), {
      type: "line",
      data: {
        datasets: [
          line("相对强弱", S.map((d) => ({ x: ts(d.date), y: d.relative_tr })), COLORS.teal, { width: 1.9 }),
          {
            label: "100",
            data: [{ x: firstTs, y: 100 }, { x: lastTs, y: 100 }],
            borderColor: "rgba(255,255,255,.28)",
            borderDash: [4, 5],
            borderWidth: 1,
            pointRadius: 0,
            showTooltip: false,
            order: 0,
          },
          currentPoint(S[S.length - 1].relative_tr, COLORS.teal),
        ],
      },
      options: relativeOptions,
    });
    charts.relative._firstData = firstTs;

    const yieldOptions = baseOptions((v) => Number(v).toFixed(2) + "%", true);
    yieldOptions.plugins.tooltip.filter = (item) => !["当前"].includes(item.dataset.label);
    yieldOptions.plugins.tooltip.callbacks.label = (ctx) =>
      "  " + ctx.dataset.label + "   " + Number(ctx.parsed.y).toFixed(2) + "%";
    charts.spyYield = new Chart($("spyYieldChart"), {
      type: "line",
      data: {
        datasets: [
          line(ticker, S.map((d) => ({ x: ts(d.date), y: d.dy ?? null })), COLORS.teal, { width: 1.8 }),
          line("SPY", S.map((d) => ({ x: ts(d.date), y: d.spy_dy ?? null })), "rgba(106,167,239,.78)", { width: 1.5 }),
          currentPoint(C.dy, COLORS.teal),
        ],
      },
      options: yieldOptions,
    });
    charts.spyYield._firstData = S.find((d) => d.dy != null)?.date ? ts(S.find((d) => d.dy != null).date) : firstTs;
  }

  /* ---------------- seasonality ---------------- */
  function buildSeasonalityChart() {
    const season = D.seasonality;
    const months = season && season.months ? season.months : [];
    if (!months.length || !$("seasonBars")) return;
    const maxAbs = Math.max(1, ...months.map((m) => Math.abs(m.avg || 0)));
    $("seasonBars").innerHTML = months.map((m) => {
      if (m.avg == null) {
        return `<div class="season-col empty"><div class="season-track"></div><div class="season-month">${m.month}月</div><div class="season-val">—</div></div>`;
      }
      const h = Math.max(2, Math.abs(m.avg) / maxAbs * 43);
      const positive = m.avg >= 0;
      const tip = `${m.month}月 · 平均 ${m.avg >= 0 ? "+" : ""}${m.avg.toFixed(2)}% · 中位 ${m.median >= 0 ? "+" : ""}${m.median.toFixed(2)}% · 胜率 ${m.win_rate.toFixed(0)}% · n=${m.n}`;
      return `<div class="season-col" title="${tip}">
        <div class="season-track">
          <div class="season-bar ${positive ? "pos" : "neg"}" style="${positive ? "bottom" : "top"}:50%;height:${h}%"></div>
        </div>
        <div class="season-month">${m.month}月</div>
        <div class="season-val ${positive ? "pos" : "neg"}">${m.avg >= 0 ? "+" : ""}${m.avg.toFixed(1)}%</div>
      </div>`;
    }).join("");

    const best = season.best_month;
    const worst = season.worst_month;
    $("seasonRead").textContent = best ? `${best.month}月 ${best.avg >= 0 ? "+" : ""}${best.avg.toFixed(1)}%` : "—";
    $("seasonPill").textContent = `全历史 · ${season.total_months} 个月`;
    $("seasonFoot").textContent = `${M.ticker} · 全历史 ${season.total_months} 个完整月度样本 · 含股息再投资`;
    const stats = [
      { label: "最强月份", value: best ? `${best.month}月` : "—", sub: best ? `${best.avg >= 0 ? "+" : ""}${best.avg.toFixed(2)}% · 胜率 ${best.win_rate.toFixed(0)}%` : "—" },
      { label: "最弱月份", value: worst ? `${worst.month}月` : "—", sub: worst ? `${worst.avg >= 0 ? "+" : ""}${worst.avg.toFixed(2)}% · 胜率 ${worst.win_rate.toFixed(0)}%` : "—" },
      { label: "上涨月份", value: `${season.positive_months} / ${season.total_months}`, sub: season.total_months ? `${(season.positive_months / season.total_months * 100).toFixed(0)}% 为正` : "—" },
      { label: "样本跨度", value: `${season.total_months} 个月`, sub: season.note },
    ];
    $("seasonStrip").innerHTML = stats.map((s) => `
      <div class="season-stat"><span>${s.label}</span><b>${s.value}</b><em>${s.sub}</em></div>
    `).join("");
  }

  /* ---------------- range ---------------- */
  const YEAR_DAYS = 365.25;
  const fullYears = (lastTs - firstTs) / DAY / YEAR_DAYS;
  const RANGE_YEARS = { "1y": 1, "2y": 2, "3y": 3, "5y": 5, "8y": 8, "10y": 10, "15y": 15, "20y": 20, "25y": 25 };

  function currentRangeStart() {
    if (state.customStart != null) return Math.max(firstTs, state.customStart);
    if (state.range === "all") return firstTs;
    const years = RANGE_YEARS[state.range] || fullYears;
    return Math.max(firstTs, lastTs - years * YEAR_DAYS * DAY);
  }

  function rangeLabel(start) {
    const years = (lastTs - start) / DAY / YEAR_DAYS;
    return `${years >= 1 ? years.toFixed(1) + " 年" : Math.round((lastTs - start) / DAY) + " 天"}窗口`;
  }

  function renderRangeStats(start) {
    const points = S.filter((d) => ts(d.date) >= start && d.adjclose != null);
    if (points.length < 2) return;
    const first = points[0];
    const last = points[points.length - 1];
    const days = Math.max((ts(last.date) - ts(first.date)) / DAY, 1);
    const total = (last.adjclose / first.adjclose - 1) * 100;
    const cagr = (Math.pow(last.adjclose / first.adjclose, YEAR_DAYS / days) - 1) * 100;
    let peak = first.close;
    let mdd = 0;
    const rets = [];
    let prev = null;
    points.forEach((d) => {
      peak = Math.max(peak, d.close);
      mdd = Math.min(mdd, d.close / peak - 1);
      if (prev != null && prev > 0) rets.push(Math.log(d.close / prev));
      prev = d.close;
    });
    const vol = rets.length > 2 ? Math.sqrt(rets.reduce((a, b) => a + b * b, 0) / (rets.length - 1)) * Math.sqrt(252) * 100 : null;
    const stats = [
      { label: "区间回报", value: signed(total), cls: total >= 0 ? "up" : "down" },
      { label: "区间年化", value: signed(cagr), cls: cagr >= 0 ? "up" : "down" },
      { label: "最大回撤", value: num(mdd * 100, 1) + "%", cls: "down" },
      { label: "年化波动", value: vol == null ? "—" : num(vol, 1) + "%", cls: "" },
    ];
    $("priceStats").innerHTML = stats.map((x) => `<div class="mini-stat"><span>${x.label}</span><b class="${x.cls}">${x.value}</b></div>`).join("");
    if ($("rangeHint")) $("rangeHint").textContent = `滚轮缩放 · ${rangeLabel(start)}`;
  }

  function applyRange() {
    const max = lastTs + 3 * DAY;
    const start = currentRangeStart();
    Object.values(charts).forEach((chart) => {
      if (!chart?.options?.scales?.x) return;
      chart.options.scales.x.min = Math.max(start, chart._firstData || firstTs);
      chart.options.scales.x.max = max;
      chart.update("none");
    });
    renderRangeStats(start);
  }

  function renderRangeTabs() {
    const options = [1, 2, 3, 5, 8, 10, 15, 20, 25].filter((y) => fullYears >= y - 0.2);
    const tabs = options.map((y) => ({ range: `${y}y`, label: `${y} 年` }));
    tabs.push({ range: "all", label: "全部" });
    $("rangeTabs").innerHTML = tabs.map((t) => `<button data-range="${t.range}" class="${t.range === "all" ? "is-active" : ""}">${t.label}</button>`).join("");
    document.querySelectorAll("#rangeTabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.range = btn.dataset.range;
        state.customStart = null;
        document.querySelectorAll("#rangeTabs button").forEach((b) => b.classList.toggle("is-active", b === btn));
        applyRange();
      });
    });
  }

  function setupWheelZoom() {
    const canvases = document.querySelectorAll(".chart-wrap canvas");
    canvases.forEach((canvas) => {
      canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const start = currentRangeStart();
        const span = lastTs - start;
        const anchor = start + span * ratio;
        const factor = event.deltaY < 0 ? 0.82 : 1.22;
        const newSpan = Math.max(30 * DAY, Math.min(lastTs - firstTs, span * factor));
        let newStart = anchor - newSpan * ratio;
        newStart = Math.max(firstTs, Math.min(lastTs - 30 * DAY, newStart));
        state.customStart = newStart;
        state.range = "custom";
        document.querySelectorAll("#rangeTabs button").forEach((b) => b.classList.remove("is-active"));
        applyRange();
      }, { passive: false });
      canvas.addEventListener("dblclick", () => {
        state.customStart = null;
        state.range = "all";
        document.querySelectorAll("#rangeTabs button").forEach((b) => b.classList.toggle("is-active", b.dataset.range === "all"));
        applyRange();
      });
    });
  }

  /* ---------------- chart labels / footers ---------------- */
  function renderChartCopy() {
    $("priceRead").textContent = money(C.price);
    $("priceReadSub").textContent = signed(C.price_change_1y) + " · 1Y";
    $("priceReadSub").className = "pill " + (C.price_change_1y >= 0 ? "badge-green" : "badge-red");

    $("priceStats").innerHTML = [
      { label: "1 年价格", value: signed(C.price_change_1y), cls: C.price_change_1y >= 0 ? "up" : "down" },
      { label: "成立以来", value: signed(C.price_change_since_inception), cls: "up" },
      { label: "年化价格", value: signed(C.cagr_since_inception), cls: "up" },
      { label: "最大回撤", value: num(C.max_drawdown, 1) + "%", cls: "down" },
    ].map((x) => `<div class="mini-stat"><span>${x.label}</span><b class="${x.cls}">${x.value}</b></div>`).join("");

    $("peRead").textContent = num(C.pe) + "x";
    $("pePill").textContent = Math.round(C.pct_pe) + "% 分位";
    $("peFoot").textContent = `历史中位数 ${num(C.median_pe)}x · Forward PE ${num(C.forward_pe)}x · 中位数隐含价格 ${money(C.implied_pe_price)} (${signed(C.implied_pe_gap, 1)})`;

    $("dyRead").textContent = num(C.dy) + "%";
    $("dyPill").textContent = Math.round(C.pct_dy) + "% 分位";
    $("dyFoot").textContent = `过去 12 个月派息 ${money(C.ttm_div, 3)} · 当前价格 ${money(C.price)}`;

    $("erpRead").textContent = num(C.erp) + "%";
    $("erpPill").textContent = Math.round(C.pct_erp) + "% 分位";
    $("erpFoot").textContent = `10 年期美债 ${num(C.ust10y)}% · 盈利收益率 ${num(C.earnings_yield)}%`;
    $("riskStrip").innerHTML = [
      { label: "当前 ERP", value: num(C.erp) + "%" },
      { label: "10 年期美债", value: num(C.ust10y) + "%" },
      { label: "盈利收益率", value: num(C.earnings_yield) + "%" },
      { label: "ERP 历史均值", value: num(D.stats.erp_mean) + "%" },
    ].map((x) => `<div class="risk-stat"><span>${x.label}</span><b>${x.value}</b></div>`).join("");
  }

  /* ---------------- SPY comparison panel ---------------- */
  function renderSPY() {
    const q = D.spy;
    const cmp = D.comparison;
    const ticker = M.ticker;

    $("spyPeDiscount").textContent = discountText(cmp.pe_discount, 1);
    $("spyPeLabel").textContent = `TTM PE ${peWord(cmp.pe_discount)}`;
    $("spyCompareFoot").textContent = `TTM PE ${discountText(cmp.pe_discount, 0)} · FWD PE ${discountText(cmp.forward_pe_discount, 0)} · PEG ${num(C.peg)} vs ${num(q.peg)} · 1Y 相对 ${cmp.relative_1y >= 0 ? "+" : ""}${num(cmp.relative_1y, 1)}pp`;

    const rows = [
      { name: "PE-TTM", etf: num(C.pe) + "x", spy: num(q.pe) + "x", delta: discountText(cmp.pe_discount, 1), good: cmp.pe_discount >= 0 },
      { name: "Forward PE", etf: num(C.forward_pe) + "x", spy: num(q.forward_pe) + "x", delta: discountText(cmp.forward_pe_discount, 1), good: cmp.forward_pe_discount >= 0 },
      { name: "PEG", etf: num(C.peg), spy: num(q.peg), delta: `${cmp.peg_spread >= 0 ? "+" : ""}${num(cmp.peg_spread, 2)}`, good: cmp.peg_spread <= 0 },
      { name: "股息率", etf: num(C.dy) + "%", spy: num(q.dy) + "%", delta: `${cmp.dy_spread >= 0 ? "+" : ""}${num(cmp.dy_spread, 2)}pp`, good: cmp.dy_spread >= 0 },
      { name: "ERP", etf: num(C.erp) + "%", spy: num(q.erp) + "%", delta: `${cmp.erp_spread >= 0 ? "+" : ""}${num(cmp.erp_spread, 2)}pp`, good: cmp.erp_spread >= 0 },
      { name: "1Y 总回报", etf: signed(C.total_return_1y), spy: signed(q.return_1y), delta: `${cmp.relative_1y >= 0 ? "+" : ""}${num(cmp.relative_1y, 1)}pp`, good: cmp.relative_1y >= 0 },
    ];
    $("spyCompareList").innerHTML = rows.map((r) => `
      <div class="compare-row">
        <div class="compare-name">${r.name}</div>
        <div class="compare-values"><b>${r.etf}</b><span>vs <b>${r.spy}</b></span></div>
        <div class="compare-delta ${r.good ? "neg" : "pos"}">${r.delta}</div>
      </div>
    `).join("");

    $("relativePerfRead").textContent = signed(cmp.relative_since_common, 1);
    $("relativePerfPill").textContent = "累计相对";
    $("relativePerfFoot").textContent = `${ticker} ${signed(cmp.etf_total_return, 0)} vs SPY ${signed(cmp.spy_total_return, 0)} · 共同起点 ${cmp.common_start}`;

    $("relativeRead").textContent = num(S[S.length - 1].relative_tr, 1);
    $("relativePill").textContent = `历史 ${num(cmp.relative_percentile, 1)}% 分位`;
    $("spyYieldRead").textContent = `${cmp.dy_spread >= 0 ? "+" : ""}${num(cmp.dy_spread, 2)}pp`;
    $("spyYieldFoot").textContent = `${ticker} ${num(C.dy)}% · SPY ${num(q.dy)}% · 滚动 12 个月`;

    const tableRows = [
      { name: "PE-TTM", etf: num(C.pe) + "x", spy: num(q.pe) + "x", diff: discountText(cmp.pe_discount, 1), good: cmp.pe_discount >= 0 },
      { name: "Forward PE", etf: num(C.forward_pe) + "x", spy: num(q.forward_pe) + "x", diff: discountText(cmp.forward_pe_discount, 1), good: cmp.forward_pe_discount >= 0 },
      { name: "PEG", etf: num(C.peg), spy: num(q.peg), diff: `${cmp.peg_spread >= 0 ? "+" : ""}${num(cmp.peg_spread, 2)}`, good: cmp.peg_spread <= 0 },
      { name: "股息率", etf: num(C.dy) + "%", spy: num(q.dy) + "%", diff: `${cmp.dy_spread >= 0 ? "+" : ""}${num(cmp.dy_spread, 2)}pp`, good: cmp.dy_spread >= 0 },
      { name: "ERP", etf: num(C.erp) + "%", spy: num(q.erp) + "%", diff: `${cmp.erp_spread >= 0 ? "+" : ""}${num(cmp.erp_spread, 2)}pp`, good: cmp.erp_spread >= 0 },
      { name: "1Y 总回报", etf: signed(C.total_return_1y), spy: signed(q.return_1y), diff: `${cmp.relative_1y >= 0 ? "+" : ""}${num(cmp.relative_1y, 1)}pp`, good: cmp.relative_1y >= 0 },
      { name: "年化总回报", etf: signed(C.cagr_since_common), spy: signed(q.cagr_since_common), diff: `${C.cagr_since_common - q.cagr_since_common >= 0 ? "+" : ""}${num(C.cagr_since_common - q.cagr_since_common, 1)}pp`, good: C.cagr_since_common >= q.cagr_since_common },
      { name: "年化波动", etf: num(C.vol_1y) + "%", spy: num(q.vol_1y) + "%", diff: `${C.vol_1y - q.vol_1y >= 0 ? "+" : ""}${num(C.vol_1y - q.vol_1y, 1)}pp`, good: C.vol_1y <= q.vol_1y },
      { name: "最大回撤", etf: num(C.max_drawdown, 1) + "%", spy: num(q.max_drawdown, 1) + "%", diff: `${C.max_drawdown - q.max_drawdown >= 0 ? "+" : ""}${num(C.max_drawdown - q.max_drawdown, 1)}pp`, good: C.max_drawdown >= q.max_drawdown },
    ];
    $("spyTableBody").innerHTML = tableRows.map((r) => `
      <tr><td>${r.name}</td><td>${r.etf}</td><td>${r.spy}</td><td class="${r.good ? "diff-good" : "diff-bad"}">${r.diff}</td></tr>
    `).join("");
  }

  /* ---------------- heatmap ---------------- */
  function heatColor(score) {
    const s = Math.max(0, Math.min(100, score));
    const hue = 156 - s * 1.52;
    const light = 20 + (1 - Math.abs(s - 50) / 50) * 5;
    return `hsl(${hue.toFixed(0)} 34% ${light.toFixed(0)}%)`;
  }

  function renderHeatmap() {
    const cols = D.quarterly.slice(-20);
    const rows = [
      { label: "PE-TTM", key: "pe", pct: "pct_pe", dir: 1, raw: num(C.pe) + "x", cls: "" },
      { label: "股息率", key: "dy", pct: "pct_dy", dir: -1, raw: num(C.dy) + "%", cls: "" },
      { label: "风险溢价", key: "erp", pct: "pct_erp", dir: -1, raw: num(C.erp) + "%", cls: "" },
      { label: "综合", key: "composite", pct: "composite", dir: 1, raw: Math.round(C.pct_composite), cls: "comp" },
    ];
    let html = `<div class="hm-corner">指标 / 季度</div>`;
    cols.forEach((c, i) => {
      html += `<div class="hm-col ${i === cols.length - 1 ? "now" : ""}">${quarterLabel(c.date)}</div>`;
    });
    rows.forEach((r) => {
      html += `<div class="hm-row-label ${r.cls}">${r.label}<b>${r.raw}</b></div>`;
      cols.forEach((c) => {
        let pct = c[r.pct];
        if (pct == null) {
          html += `<div class="hm-cell empty ${r.cls}" aria-label="${r.label} 数据不足">—</div>`;
          return;
        }
        const exp = r.dir === -1 ? 100 - pct : pct;
        const raw = c[r.key];
        const rawText = raw == null ? "—" : (r.key === "composite" ? Math.round(raw) : num(raw, 2));
        html += `<div class="hm-cell ${r.cls}" style="background:${heatColor(exp)}" title="${quarterLabel(c.date)} · ${r.label} ${rawText} · 昂贵度 ${Math.round(exp)}%" aria-label="${quarterLabel(c.date)} ${r.label} 昂贵度 ${Math.round(exp)}%">${Math.round(exp)}</div>`;
      });
    });
    $("heatmap").style.setProperty("--cols", cols.length);
    $("heatmap").innerHTML = html;
    $("heatmapNote").textContent = `${cols[0].date} — ${cols[cols.length - 1].date} · 按季度末读数`;
  }

  /* ---------------- log table ---------------- */
  function renderLog() {
    const rows = D.log.slice(-12).reverse();
    $("logBody").innerHTML = rows.map((r) => {
      const cls = regimeClass(r.regime);
      return `<tr>
        <td>${r.date.replaceAll("-", ".")}</td>
        <td>${money(r.price)}</td>
        <td>${r.pe == null ? "—" : num(r.pe) + "x"}</td>
        <td>${r.dy == null ? "—" : num(r.dy) + "%"}</td>
        <td>${r.erp == null ? "—" : num(r.erp) + "%"}</td>
        <td>${r.composite == null ? "—" : num(r.composite, 1)}</td>
        <td><span class="state ${cls}">${r.regime || "—"}</span></td>
      </tr>`;
    }).join("");
  }

  /* ---------------- sources / footer ---------------- */
  function renderSources() {
    $("sourceList").innerHTML = M.sources.map((s, i) => `
      <li><span class="s-index">${String(i + 1).padStart(2, "0")}</span><a href="${s.url}" target="_blank" rel="noopener">${s.label}</a><span class="s-ext">↗</span></li>
    `).join("");
    $("footAsOf").textContent = M.as_of;
    $("footObs").textContent = C.obs + " 个交易日";
    $("footGenerated").textContent = new Date(M.generated_at).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  }

  /* ---------------- reveal / nav ---------------- */
  function setupReveal() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -30px 0px" });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    // Safety net: never leave content invisible if the observer is throttled
    // (headless screenshots, background tabs, very old browsers).
    window.setTimeout(() => {
      document.querySelectorAll(".reveal:not(.in)").forEach((el) => el.classList.add("in"));
    }, 3500);
  }

  function setupNav() {
    const links = [...document.querySelectorAll(".nav a")];
    const sections = links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = "#" + entry.target.id;
        links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === id));
      });
    }, { rootMargin: "-20% 0px -65% 0px", threshold: 0 });
    sections.forEach((s) => io.observe(s));
  }

  /* ---------------- boot ---------------- */
  function boot() {
    applyPageConfig();
    renderHero();
    buildGauge();
    renderMetricCards();
    renderCompass();
    renderInsights();
    buildCharts();
    buildSeasonalityChart();
    renderChartCopy();
    renderSPY();
    renderHeatmap();
    renderLog();
    renderSources();
    renderRangeTabs();
    setupWheelZoom();
    applyRange();
    setupReveal();
    setupNav();
    // Re-apply after layout settles (fonts / scrollbars).
    window.addEventListener("load", () => setTimeout(applyRange, 120));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }


})();
