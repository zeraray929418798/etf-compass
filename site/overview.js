/* =========================================================
   CASH COW LAB · Sector rotation: XLK / XLP
   ========================================================= */
(() => {
  "use strict";

  const R = window.SECTOR_RATIO;
  if (!R || !R.series || !R.series.length) return;

  const $ = (id) => document.getElementById(id);
  const DAY = 86400000;
  const ts = (value) => Date.parse(value + "T00:00:00Z");
  const S = R.series;
  const MACD = R.macd || [];
  const C = R.current;
  const first = ts(S[0].date);
  const last = ts(S[S.length - 1].date);

  const COLORS = {
    gold: "#e3b46a",
    blue: "#6aa7ef",
    teal: "#55c7b2",
    red: "#e06767",
    muted: "#8b9aac",
    dim: "#5b6a7c",
    grid: "rgba(255,255,255,.055)",
  };
  const FONT = "'Aptos','Segoe UI','PingFang SC','Microsoft YaHei',sans-serif";
  const NUM = "'Bahnschrift','DIN Alternate','Aptos Display','Segoe UI',sans-serif";
  const num = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(d));
  const signed = (v, d = 2) => (v == null ? "—" : (v >= 0 ? "+" : "") + Number(v).toFixed(d) + "%");
  const dateShort = (value) => {
    const d = new Date(value);
    return String(d.getUTCFullYear()).slice(2) + "." + String(d.getUTCMonth() + 1).padStart(2, "0");
  };
  const dateLong = (value) => new Date(value).toLocaleDateString("zh-CN", {
    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  });

  Chart.defaults.color = COLORS.muted;
  Chart.defaults.font.family = FONT;
  Chart.defaults.font.size = 10;
  Chart.defaults.borderColor = COLORS.grid;
  Chart.defaults.animation.duration = 0;
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

  const bandPlugin = {
    id: "ratioBand",
    beforeDatasetsDraw(chart) {
      if (chart.canvas.id !== "ratioChart") return;
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.y) return;
      const y20 = scales.y.getPixelForValue(C.p20);
      const y80 = scales.y.getPixelForValue(C.p80);
      const top = Math.min(y20, y80);
      const height = Math.abs(y20 - y80);
      ctx.save();
      ctx.fillStyle = "rgba(106,167,239,.17)";
      ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, height);
      ctx.strokeStyle = "rgba(106,167,239,.48)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      [C.p20, C.p80].forEach((v) => {
        const y = scales.y.getPixelForValue(v);
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y);
        ctx.lineTo(chartArea.right, y);
        ctx.stroke();
      });
      ctx.fillStyle = "rgba(142,180,235,.82)";
      ctx.font = "9px 'Bahnschrift','Aptos Display',sans-serif";
      ctx.fillText(`80%  ${C.p80.toFixed(1)}%`, chartArea.left + 6, y80 - 4);
      ctx.fillText(`20%  ${C.p20.toFixed(1)}%`, chartArea.left + 6, y20 + 11);
      ctx.restore();
    },
  };

  const zeroLinePlugin = {
    id: "macdZero",
    beforeDatasetsDraw(chart) {
      if (chart.canvas.id !== "macdChart") return;
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.y) return;
      const y = scales.y.getPixelForValue(0);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
      ctx.restore();
    },
  };

  Chart.register(bandPlugin, zeroLinePlugin);

  const points = S.map((d) => ({ x: ts(d.date), y: d.yoy }));
  const meanPoints = [
    { x: first, y: C.mean },
    { x: last, y: C.mean },
  ];
  const macdPoints = MACD.map((d) => ({ x: ts(d.date), y: d.macd }));
  const signalPoints = MACD.map((d) => ({ x: ts(d.date), y: d.signal }));
  const histPoints = MACD.map((d) => ({ x: ts(d.date), y: d.hist }));
  const histColors = MACD.map((d) => (d.hist >= 0 ? "rgba(84,183,139,.62)" : "rgba(224,103,103,.62)"));

  const ratioOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    layout: { padding: { top: 8, right: 4, left: 0, bottom: 0 } },
    plugins: {
      tooltip: {
        mode: "index",
        intersect: false,
        filter: (item) => item.datasetIndex === 0,
        callbacks: {
          title: (items) => (items.length ? dateLong(S[items[0].dataIndex].date) : ""),
          label: (ctx) => {
            const d = S[ctx.dataIndex];
            return [
              `  XLK/XLP 同比  ${signed(d.yoy)}`,
              `  比值          ${num(d.ratio, 3)}`,
              `  历史均值      ${signed(C.mean)}`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        type: "linear",
        min: first,
        max: last + 3 * DAY,
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: COLORS.dim,
          maxTicksLimit: 6,
          font: { family: NUM, size: 9 },
          callback: (v) => dateShort(new Date(v).toISOString().slice(0, 10)),
        },
      },
      y: {
        position: "right",
        grid: { color: COLORS.grid, drawTicks: false },
        border: { display: false },
        ticks: {
          color: COLORS.dim,
          padding: 8,
          maxTicksLimit: 5,
          font: { family: NUM, size: 9 },
          callback: (v) => `${Number(v).toFixed(0)}%`,
        },
      },
    },
  };

  const macdOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    layout: { padding: { top: 2, right: 4, left: 0, bottom: 0 } },
    plugins: {
      tooltip: {
        mode: "index",
        intersect: false,
        callbacks: {
          title: (items) => (items.length ? dateLong(MACD[items[0].dataIndex].date) : ""),
          label: (ctx) => {
            const d = MACD[ctx.dataIndex];
            return [
              `  MACD      ${num(d.macd, 3)}`,
              `  Signal    ${num(d.signal, 3)}`,
              `  Histogram ${num(d.hist, 3)}`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        type: "linear",
        min: first,
        max: last + 3 * DAY,
        offset: false,
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: COLORS.dim,
          maxTicksLimit: 6,
          font: { family: NUM, size: 9 },
          callback: (v) => dateShort(new Date(v).toISOString().slice(0, 10)),
        },
      },
      y: {
        position: "right",
        grid: { color: COLORS.grid, drawTicks: false },
        border: { display: false },
        ticks: {
          color: COLORS.dim,
          padding: 8,
          maxTicksLimit: 5,
          font: { family: NUM, size: 9 },
          callback: (v) => Number(v).toFixed(2),
        },
      },
    },
  };

  const ratioChart = new Chart($("ratioChart"), {
    type: "line",
    data: {
      datasets: [
        {
          label: "同比",
          data: points,
          borderColor: COLORS.gold,
          backgroundColor: "transparent",
          borderWidth: 1.8,
          pointRadius: 0,
          pointHoverRadius: 3,
          tension: 0.12,
        },
        {
          label: "历史均值",
          data: meanPoints,
          borderColor: "rgba(106,167,239,.75)",
          borderDash: [5, 5],
          borderWidth: 1.1,
          pointRadius: 0,
          tension: 0,
        },
      ],
    },
    options: ratioOptions,
  });

  const macdChart = new Chart($("macdChart"), {
    data: {
      datasets: [
        {
          type: "bar",
          label: "Histogram",
          data: histPoints,
          backgroundColor: histColors,
          borderWidth: 0,
          barPercentage: 0.72,
          categoryPercentage: 0.84,
          order: 2,
        },
        {
          type: "line",
          label: "MACD",
          data: macdPoints,
          borderColor: COLORS.gold,
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 2,
          tension: 0.1,
          order: 0,
        },
        {
          type: "line",
          label: "Signal",
          data: signalPoints,
          borderColor: COLORS.blue,
          borderWidth: 1.3,
          pointRadius: 0,
          pointHoverRadius: 2,
          tension: 0.1,
          order: 1,
        },
      ],
    },
    options: macdOptions,
  });

  $("ratioRead").textContent = signed(C.yoy, 1);
  $("ratioPill").textContent = `历史 ${num(C.percentile, 0)}% 分位`;
  $("ratioStats").innerHTML = [
    { label: "当前比值", value: num(C.ratio, 3) + "x", sub: "XLK / XLP" },
    { label: "同比", value: signed(C.yoy, 1), sub: "252 个交易日" },
    { label: "历史均值", value: signed(C.mean, 2), sub: "全历史同比" },
    { label: "当前分位", value: num(C.percentile, 1) + "%", sub: `20% ${num(C.p20, 1)}% · 80% ${num(C.p80, 1)}%` },
  ].map((s) => `<div class="ratio-stat"><span>${s.label}</span><b>${s.value}</b><em>${s.sub}</em></div>`).join("");
  $("ratioFoot").textContent = `XLK / XLP = ${num(C.ratio, 3)} · MACD ${num(C.macd, 3)} / Signal ${num(C.signal, 3)} / Hist ${num(C.hist, 3)} · ${S.length} 个交易日 · 周线 MACD · 滚轮缩放，双击复位`;

  function applyWindow(start) {
    const min = Math.max(first, Math.min(start, last - 30 * DAY));
    [ratioChart, macdChart].forEach((chart) => {
      chart.options.scales.x.min = min;
      chart.options.scales.x.max = last + 3 * DAY;
      chart.update("none");
    });
  }

  function zoomAt(event, canvas) {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const currentStart = ratioChart.options.scales.x.min;
    const span = last - currentStart;
    const anchor = currentStart + span * ratio;
    const factor = event.deltaY < 0 ? 0.82 : 1.22;
    const nextSpan = Math.max(45 * DAY, Math.min(last - first, span * factor));
    applyWindow(anchor - nextSpan * ratio);
  }

  applyWindow(first);

  [$("ratioChart"), $("macdChart")].forEach((canvas) => {
    canvas.addEventListener("wheel", (event) => zoomAt(event, canvas), { passive: false });
    canvas.addEventListener("dblclick", () => applyWindow(first));
  });

  })();
