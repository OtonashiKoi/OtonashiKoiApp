(function () {
  "use strict";

  window.createStudioKoiController = function createStudioKoiController({ $, api, esc, fmt, metric, toast }) {
    let state = null;

    function statusLabel(status) {
      return ({ open: "投注中", locked: "已封盤", settled: "已結算", void: "已作廢" })[status] || status || "等待開盤";
    }

    function renderMarket(market) {
      if (!market) return '<p class="status">目前沒有盤口。填寫右側資料後即可開放投注。</p>';
      const remain = market.status === "open" ? Math.max(0, Math.ceil((Number(market.lockAtMs) - Date.now()) / 1000)) : 0;
      const optionRows = (market.options || []).map((option) => `<div class="koi-option-row"><div><b>${esc(option.label)}</b><small>${fmt(option.pool)} 戀雀券・${Number(option.sharePct || 0).toFixed(1)}%</small></div><strong>${option.estimatedOdds ? Number(option.estimatedOdds).toFixed(2) + "x" : "—"}</strong></div>`).join("");
      const settleButtons = ["open", "locked"].includes(market.status) ? (market.options || []).map((option) => `<button class="btn small primary" data-koi-settle="${esc(option.id)}">結算：${esc(option.shortLabel || option.label)}</button>`).join("") : "";
      const result = market.status === "settled" ? `<div class="koi-result good">結果：${esc(market.winningOptionLabel)}</div>` : market.status === "void" ? `<div class="koi-result warning">作廢：${esc(market.voidReason || "全額退款")}</div>` : "";
      return `<div class="koi-market-head"><div><span>第 ${fmt(market.sequence)} 盤・${esc(market.handLabel)}</span><h3>${esc(market.title)}</h3></div><div class="koi-status"><b>${esc(statusLabel(market.status))}</b>${market.status === "open" ? `<strong>${remain}s</strong>` : ""}</div></div>${optionRows}${result}<div class="button-row koi-actions">${market.status === "open" ? '<button class="btn ghost" data-koi-action="lock">立即封盤</button>' : ""}${settleButtons}${["open", "locked"].includes(market.status) ? '<button class="btn danger ghost" data-koi-action="void">作廢並退款</button>' : ""}</div>`;
    }

    async function refresh() {
      state = await api("/admin/mahjong-prediction/state");
      const stats = state.stats || {};
      const market = state.currentMarket;
      $("#koi-metrics").innerHTML = [
        metric("目前狀態", statusLabel(market?.status), market ? `第 ${fmt(market.sequence)} 盤` : "尚未開盤", market?.status === "open" ? "good" : ""),
        metric("流通戀雀券", fmt(stats.circulation), `${fmt(stats.wallets)} 個錢包`),
        metric("累計投注", fmt(stats.totalStaked), `${fmt(stats.bets)} 張投注單`),
        metric("本盤投注", fmt(market?.totalStaked), `${fmt(market?.betCount)} 人次`),
      ].join("");
      $("#koi-current-market").innerHTML = renderMarket(market);
      $("#koi-recent-markets").innerHTML = (state.recentMarkets || []).map((item) => `<div class="koi-recent-row"><div><b>#${fmt(item.sequence)} ${esc(item.handLabel)}</b><small>${esc(item.title)}</small></div><span>${esc(item.status === "void" ? "作廢退款" : item.winningOptionLabel || "—")}</span><em>投注 ${fmt(item.totalStaked)}・派彩 ${fmt(item.totalPayout)}・回收 ${fmt(item.houseTake)}</em></div>`).join("") || '<p class="status">還沒有已結算的盤口。</p>';
    }

    function bind() {
      $("#koi-refresh").addEventListener("click", () => refresh().then(() => toast("戀雀盤口已更新")).catch((error) => toast(error.message, true)));
      $("#koi-create-market").addEventListener("click", async () => {
        const body = { sessionLabel: $("#koi-session-label").value.trim(), handLabel: $("#koi-hand-label").value.trim(), marketType: $("#koi-market-type").value, openSeconds: Number($("#koi-open-seconds").value), title: $("#koi-market-title").value.trim() };
        if (!confirm(`開放「${body.handLabel}」投注 ${body.openSeconds} 秒？`)) return;
        try {
          await api("/admin/mahjong-prediction/markets", { method: "POST", body: JSON.stringify(body) });
          await refresh();
          toast("戀雀盤口已開放");
        } catch (error) { toast(error.message, true); }
      });
      $("#koi-current-market").addEventListener("click", handleMarketAction);
    }

    async function handleMarketAction(event) {
      const settle = event.target.closest("[data-koi-settle]");
      const action = event.target.closest("[data-koi-action]");
      if (!settle && !action) return;
      try {
        if (settle) {
          const option = state?.currentMarket?.options?.find((item) => item.id === settle.dataset.koiSettle);
          if (!confirm(`確定以「${option?.label || settle.dataset.koiSettle}」結算？結算後不能修改。`)) return;
          let han = null;
          if (state?.currentMarket?.marketType === "han" && settle.dataset.koiSettle !== "no_win") {
            const entered = prompt("輸入實際番數（可取消略過）", "");
            if (entered != null && entered.trim() !== "") han = Number(entered);
          }
          await api("/admin/mahjong-prediction/settle", { method: "POST", body: JSON.stringify({ winningOptionId: settle.dataset.koiSettle, han }) });
          toast("盤口結算與派彩完成");
        } else if (action.dataset.koiAction === "lock") {
          await api("/admin/mahjong-prediction/lock", { method: "POST", body: "{}" });
          toast("盤口已封盤");
        } else if (action.dataset.koiAction === "void") {
          if (!confirm("確定作廢本盤並全額退還所有戀雀券？")) return;
          await api("/admin/mahjong-prediction/void", { method: "POST", body: JSON.stringify({ reason: "主播作廢並全額退款" }) });
          toast("本盤已作廢並退款");
        }
        await refresh();
      } catch (error) { toast(error.message, true); }
    }

    return { bind, refresh };
  };
})();
