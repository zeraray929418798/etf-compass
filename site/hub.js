(() => {
  "use strict";

  const H = window.HUB_DATA;
  if (!H) return;
  const $ = (id) => document.getElementById(id);
  const num = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(d));
  const signed = (v, d = 2) => (v == null ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(d)}%`);
  const pp = (v, d = 1) => (v == null ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(d)}pp`);
  const color = { vflo: "#e3b46a", iflo: "#7fb0df", cowz: "#a7c88c", schd: "#d99a6c", qqq: "#a897e8", soxx: "#e08a6a" };
  const regimeClass = (r) => r.includes("高估") ? "red" : r.includes("偏高") ? "amber" : r.includes("低估") ? "green" : "neutral";

  const spark = (values, c) => {
    if (!values || values.length < 3) return "";
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * 120;
      const y = 34 - ((v - min) / span) * 28;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `<svg class="hub-spark" viewBox="0 0 120 38" preserveAspectRatio="none" aria-hidden="true"><path d="M0,38 L${pts.join(" L")} L120,38 Z"/><polyline points="${pts.join(" ")}"/></svg>`;
  };

  $("topAsOf").textContent = H.as_of.replaceAll("-", ".");
  $("hubAsOf").textContent = H.as_of;
  $("hubGenerated").textContent = new Date(H.generated_at).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai", hour12: false,
  });
  $("hubSpyPe").textContent = num(H.spy.pe) + "x";
  $("hubSpyDy").textContent = num(H.spy.dy) + "%";
  $("hubSpyErp").textContent = num(H.spy.erp) + "%";
  $("hubSpyRet").textContent = signed(H.spy.return_1y);
  $("hubSpyCagr").textContent = signed(H.spy.cagr_since_common);

  $("hubGrid").innerHTML = H.funds.map((f) => `
    <a class="hub-card" href="${f.href}" style="--accent:${color[f.theme] || "#e3b46a"}">
      <div class="hub-top">
        <div><span class="hub-ticker">${f.ticker}</span><div class="hub-name">${f.short}</div></div>
        <span class="hub-regime ${regimeClass(f.regime)}">${f.regime}</span>
      </div>
      <div class="hub-price">$${num(f.price)}<em class="${f.change_1d >= 0 ? "up" : "down"}">${signed(f.change_1d)}</em></div>
      ${spark(f.spark, color[f.theme])}
      <div class="hub-stats">
        <div class="hub-stat"><span>PE-TTM</span><b>${num(f.pe)}x · ${Math.round(f.pe_pct)}%</b></div>
        <div class="hub-stat"><span>FWD / PEG</span><b>${num(f.forward_pe)}x / ${num(f.peg)}</b></div>
        <div class="hub-stat"><span>股息率</span><b>${num(f.dy)}%</b></div>
        <div class="hub-stat"><span>ERP</span><b>${num(f.erp)}%</b></div>
        <div class="hub-stat"><span>VS SPY</span><b>PE ${f.spy_discount >= 0 ? "-" : "+"}${num(Math.abs(f.spy_discount), 0)}%</b></div>
        <div class="hub-stat"><span>综合分位</span><b>${num(f.composite, 0)} / 100</b></div>
        <div class="hub-stat"><span>1Y 相对</span><b>${pp(f.relative_1y)}</b></div>
      </div>
    </a>
  `).join("");

  $("hubTableBody").innerHTML = H.funds.map((f) => `
    <tr>
      <td><a href="${f.href}">${f.ticker}</a></td>
      <td>$${num(f.price)}</td>
      <td>${num(f.pe)}x</td>
      <td>${num(f.forward_pe)}x</td>
      <td>${num(f.peg)}</td>
      <td>${num(f.dy)}%</td>
      <td>${num(f.erp)}%</td>
      <td>${num(f.composite, 0)} · ${f.regime}</td>
      <td>PE ${f.spy_discount >= 0 ? "-" : "+"}${num(Math.abs(f.spy_discount), 0)}%</td>
      <td>${pp(f.relative_1y)}</td>
    </tr>
  `).join("");
})();
