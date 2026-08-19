(function () {
  "use strict";

  const POSITION_ORDER = ["GKP", "DEF", "MID", "FWD"];
  const CHIP_TYPES = ["wildcard", "free_hit", "bench_boost", "triple_captain"];
  const CHIP_LABELS = {
    wildcard: "Wildcard",
    free_hit: "Free Hit",
    bench_boost: "Bench Boost",
    triple_captain: "Triple Captain",
  };
  const FIRST_HALF_LAST_GW = 19;

  const state = {
    apiBaseUrl: "",
    appPassword: "",
    mySquad: null, // saved row from /api/squad, enriched with player_id list
  };

  // ------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------

  function loadSettings() {
    state.apiBaseUrl = localStorage.getItem("fpl.apiBaseUrl") || "";
    state.appPassword = localStorage.getItem("fpl.appPassword") || "";
    document.getElementById("apiBaseUrl").value = state.apiBaseUrl;
    document.getElementById("appPassword").value = state.appPassword;
  }

  function saveSettings() {
    state.apiBaseUrl = document.getElementById("apiBaseUrl").value.trim().replace(/\/$/, "");
    state.appPassword = document.getElementById("appPassword").value;
    localStorage.setItem("fpl.apiBaseUrl", state.apiBaseUrl);
    localStorage.setItem("fpl.appPassword", state.appPassword);
    const status = document.getElementById("settingsStatus");
    status.textContent = "Saved.";
    setTimeout(() => { status.textContent = ""; }, 2000);
    loadMySquad();
  }

  function toggleSettings() {
    document.getElementById("settingsPanel").classList.toggle("hidden");
  }

  // ------------------------------------------------------------------
  // API helper
  // ------------------------------------------------------------------

  async function apiFetch(path, options) {
    options = options || {};
    if (!state.apiBaseUrl) {
      throw new Error("Set your API base URL in settings first.");
    }
    const headers = Object.assign({}, options.headers || {});
    if (options.body) headers["Content-Type"] = "application/json";
    if (options.auth) headers["X-App-Password"] = state.appPassword;

    const res = await fetch(state.apiBaseUrl + path, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    let data;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }

    if (!res.ok) {
      const message = (data && data.error) ? data.error : `Request failed (${res.status})`;
      throw new Error(message);
    }
    return data;
  }

  function fmtCost(cost) {
    return "£" + Number(cost).toFixed(1) + "m";
  }

  function fmtXp(xp) {
    return Number(xp).toFixed(1) + " xP";
  }

  // ------------------------------------------------------------------
  // My Squad
  // ------------------------------------------------------------------

  async function loadMySquad() {
    const el = document.getElementById("mySquadContent");
    if (!state.apiBaseUrl) {
      el.innerHTML = '<p class="hint">Set your API base URL in settings to get started.</p>';
      return;
    }
    el.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const saved = await apiFetch("/api/squad");
      if (!saved || !saved.squad || saved.squad.length === 0) {
        state.mySquad = null;
        el.innerHTML = '<p class="hint">No squad saved yet. Build one below and save it.</p>';
        renderChipToggles();
        return;
      }
      state.mySquad = saved;
      state.mySquad.chips_used = saved.chips_used || [];

      const gw = saved.gameweek || 1;
      let playersById = {};
      try {
        const data = await apiFetch(`/api/players?gameweek=${gw}&horizon=1`);
        (data.players || []).forEach(p => { playersById[p.player_id] = p; });
      } catch (e) {
        // fresh xp is best-effort; still render what we have
      }

      renderMySquad(saved, playersById);
      renderChipToggles();
    } catch (e) {
      el.innerHTML = `<p class="error">${e.message}</p>`;
    }
  }

  function renderMySquad(saved, playersById) {
    const el = document.getElementById("mySquadContent");
    const byPosition = { GKP: [], DEF: [], MID: [], FWD: [] };

    saved.squad.forEach(pid => {
      const p = playersById[pid];
      const position = p ? p.position : "?";
      byPosition[position] = byPosition[position] || [];
      byPosition[position].push({
        player_id: pid,
        web_name: p ? p.web_name : `Player ${pid}`,
        team_short: p ? p.team_short : "",
        xp: p ? p.xp : null,
        isCaptain: pid === saved.captain_id,
      });
    });

    let html = "";
    POSITION_ORDER.forEach(pos => {
      const list = byPosition[pos] || [];
      if (list.length === 0) return;
      html += `<div class="position-heading">${pos}</div>`;
      list.forEach(p => {
        html += `
          <div class="player-row">
            <div class="player-name">
              <span class="pos-tag">${pos}</span>
              <span>${p.web_name}${p.team_short ? " (" + p.team_short + ")" : ""}</span>
              ${p.isCaptain ? '<span class="captain-tag">C</span>' : ""}
            </div>
            <span class="player-xp">${p.xp !== null ? fmtXp(p.xp) : "-"}</span>
          </div>`;
      });
    });

    html += `
      <div class="summary-row">
        <span>Gameweek <strong>${saved.gameweek ?? "-"}</strong></span>
        <span>Bank <strong>${fmtCost(saved.bank || 0)}</strong></span>
        <span>Free transfers <strong>${saved.free_transfers ?? "-"}</strong></span>
      </div>`;

    el.innerHTML = html;
  }

  // ------------------------------------------------------------------
  // Build Optimal Squad
  // ------------------------------------------------------------------

  function renderSquadResult(result, containerEl, onSave, remaining) {
    const startingByPos = { GKP: [], DEF: [], MID: [], FWD: [] };
    result.starting_xi.forEach(p => {
      startingByPos[p.position] = startingByPos[p.position] || [];
      startingByPos[p.position].push(p);
    });

    let html = '<div class="transfer-block"><h3>Starting XI</h3>';
    POSITION_ORDER.forEach(pos => {
      const list = (startingByPos[pos] || []).sort((a, b) => b.xp - a.xp);
      list.forEach(p => {
        const isCaptain = result.captain && p.id === result.captain.id;
        const isVice = result.vice_captain && p.id === result.vice_captain.id;
        html += `
          <div class="player-row">
            <div class="player-name">
              <span class="pos-tag">${pos}</span>
              <span>${p.web_name} (${p.team_short})</span>
              ${isCaptain ? '<span class="captain-tag">C</span>' : ""}
              ${isVice ? '<span class="vice-tag">V</span>' : ""}
            </div>
            <span class="player-xp">${fmtXp(p.xp)}</span>
          </div>`;
      });
    });
    html += "</div>";

    html += '<div class="transfer-block"><h3>Bench</h3>';
    result.bench.forEach(p => {
      html += `
        <div class="player-row">
          <div class="player-name">
            <span class="pos-tag">${p.position}</span>
            <span>${p.web_name} (${p.team_short})</span>
          </div>
          <span class="player-xp">${fmtXp(p.xp)}</span>
        </div>`;
    });
    html += "</div>";

    html += `
      <div class="summary-row">
        <span>Cost <strong>${fmtCost(result.total_cost)}</strong></span>
        ${remaining !== undefined ? `<span>Remaining <strong>${fmtCost(remaining)}</strong></span>` : ""}
        <span>Total xP <strong>${fmtXp(result.total_xp)}</strong></span>
      </div>`;

    containerEl.innerHTML = html;

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-secondary";
    saveBtn.textContent = "Save this as my squad";
    saveBtn.addEventListener("click", () => onSave(saveBtn));
    containerEl.appendChild(saveBtn);
  }

  async function saveResultAsSquad(result, gameweek, bank, freeTransfers, btn) {
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const squadIds = result.squad.map(p => p.id);
      // Preserve chip usage already recorded against this squad -- omitting
      // chips_used here would upsert it back to empty.
      const chipsUsed = (state.mySquad && state.mySquad.chips_used) || [];
      await apiFetch("/api/squad", {
        method: "POST",
        auth: true,
        body: {
          squad_ids: squadIds,
          captain_id: result.captain ? result.captain.id : null,
          bank: bank,
          free_transfers: freeTransfers,
          gameweek: gameweek,
          chips_used: chipsUsed,
        },
      });
      btn.textContent = "Saved ✓";
      loadMySquad();
    } catch (e) {
      btn.textContent = "Save this as my squad";
      alert("Couldn't save squad: " + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function buildOptimalSquad() {
    const gameweek = parseInt(document.getElementById("buildGameweek").value, 10);
    const horizon = parseInt(document.getElementById("buildHorizon").value, 10);
    const budget = parseFloat(document.getElementById("buildBudget").value);
    const resultEl = document.getElementById("buildResult");
    const btn = document.getElementById("buildSquadBtn");

    btn.disabled = true;
    resultEl.innerHTML = '<p class="hint">Optimizing…</p>';
    try {
      const result = await apiFetch("/api/optimize", {
        method: "POST",
        body: { gameweek, horizon, budget },
      });
      const remaining = Math.round((budget - result.total_cost) * 10) / 10;
      renderSquadResult(result, resultEl, (btn2) =>
        saveResultAsSquad(result, gameweek, remaining, 1, btn2), remaining
      );
    } catch (e) {
      resultEl.innerHTML = `<p class="error">${e.message}</p>`;
    } finally {
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------------
  // Transfer Suggestions
  // ------------------------------------------------------------------

  async function runInlineChipCheck(gameweek, bank) {
    const chipEl = document.getElementById("transferChipResult");
    const horizon = parseInt(document.getElementById("chipHorizon").value, 10) || 8;
    chipEl.innerHTML = '<p class="hint">Checking chip windows…</p>';
    try {
      const chipResult = await apiFetch("/api/chips", {
        method: "POST",
        body: {
          gameweek,
          horizon,
          current_squad_ids: state.mySquad.squad,
          bank,
          chips_used: chipsUsedForHalf(gameweek),
        },
      });
      renderChipAdvisorResult(chipResult, "transferChipResult", true);
    } catch (e) {
      chipEl.innerHTML = `<p class="hint">Chip check failed: ${e.message}</p>`;
    }
  }

  async function getTransferSuggestions() {
    const resultEl = document.getElementById("transferResult");
    const chipEl = document.getElementById("transferChipResult");
    const btn = document.getElementById("transferBtn");

    if (!state.mySquad || !state.mySquad.squad || state.mySquad.squad.length === 0) {
      resultEl.innerHTML = '<p class="hint">Save a squad first (see "My Squad" above).</p>';
      return;
    }

    const gameweek = parseInt(document.getElementById("transferGameweek").value, 10);
    const bank = parseFloat(document.getElementById("transferBank").value);
    const freeTransfers = parseInt(document.getElementById("transferFreeTransfers").value, 10);
    const horizon = parseInt(document.getElementById("transferHorizon").value, 10);

    btn.disabled = true;
    resultEl.innerHTML = '<p class="hint">Thinking…</p>';
    chipEl.innerHTML = "";
    try {
      const result = await apiFetch("/api/transfers", {
        method: "POST",
        body: {
          gameweek,
          horizon,
          current_squad_ids: state.mySquad.squad,
          bank,
          free_transfers: freeTransfers,
          max_transfers: 5,
        },
      });

      // Fire the chip check alongside every transfer run so both are visible
      // in one go, whether or not a transfer is actually recommended.
      runInlineChipCheck(gameweek, bank);

      if (result.n_transfers === 0) {
        resultEl.innerHTML = '<p class="hint">No changes recommended.</p>';
        return;
      }

      let html = '<div class="transfer-block"><h3>Out</h3>';
      result.transfers_out.forEach(p => {
        html += `
          <div class="player-row">
            <div class="player-name">
              <span class="pos-tag">${p.position}</span>
              <span>${p.web_name} (${p.team_short})</span>
            </div>
          </div>`;
      });
      html += '</div><div class="transfer-block"><h3>In</h3>';
      result.transfers_in.forEach(p => {
        html += `
          <div class="player-row">
            <div class="player-name">
              <span class="pos-tag">${p.position}</span>
              <span>${p.web_name} (${p.team_short})</span>
            </div>
            <span class="player-xp">${fmtXp(p.xp)}</span>
          </div>`;
      });
      html += "</div>";

      // Bank left after this transfer = what you had, minus what the swap
      // actually costs (new players in, minus what selling the old ones frees up).
      const spend = result.transfers_in.reduce((s, p) => s + p.cost, 0)
        - result.transfers_out.reduce((s, p) => s + p.cost, 0);
      const bankAfter = Math.round((bank - spend) * 10) / 10;

      html += `
        <div class="summary-row">
          <span>Hit <strong>${result.hit_cost > 0 ? "-" + result.hit_cost : "0"}</strong></span>
          <span>Net gain <strong>${fmtXp(result.net_xp_gain)}</strong></span>
          <span>Bank after <strong>${fmtCost(bankAfter)}</strong></span>
        </div>`;

      resultEl.innerHTML = html;

      const saveBtn = document.createElement("button");
      saveBtn.className = "btn btn-secondary";
      saveBtn.textContent = "Save this squad";
      saveBtn.addEventListener("click", () =>
        saveResultAsSquad(result.new_squad, gameweek, bankAfter, freeTransfers, saveBtn)
      );
      resultEl.appendChild(saveBtn);
    } catch (e) {
      resultEl.innerHTML = `<p class="error">${e.message}</p>`;
    } finally {
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------------
  // Chip Advisor
  // ------------------------------------------------------------------

  function renderChipToggles() {
    const chipsUsed = (state.mySquad && state.mySquad.chips_used) || [];
    ["first", "second"].forEach(half => {
      const container = document.getElementById(half === "first" ? "chipToggleFirst" : "chipToggleSecond");
      container.innerHTML = "";
      CHIP_TYPES.forEach(chip => {
        const key = `${chip}_${half}`;
        const used = chipsUsed.includes(key);
        const label = document.createElement("label");
        label.className = "chip-toggle" + (used ? " used" : "");
        label.innerHTML = `<input type="checkbox" ${used ? "checked" : ""}> ${CHIP_LABELS[chip]}`;
        label.querySelector("input").addEventListener("change", () => toggleChip(chip, half));
        container.appendChild(label);
      });
    });
  }

  async function toggleChip(chip, half) {
    if (!state.mySquad) {
      alert("Save a squad first so chip usage has somewhere to persist.");
      renderChipToggles();
      return;
    }
    const key = `${chip}_${half}`;
    const chipsUsed = new Set(state.mySquad.chips_used || []);
    if (chipsUsed.has(key)) {
      chipsUsed.delete(key);
    } else {
      chipsUsed.add(key);
    }
    state.mySquad.chips_used = Array.from(chipsUsed);
    renderChipToggles();

    try {
      await apiFetch("/api/squad", {
        method: "POST",
        auth: true,
        body: {
          squad_ids: state.mySquad.squad,
          captain_id: state.mySquad.captain_id,
          bank: state.mySquad.bank || 0,
          free_transfers: state.mySquad.free_transfers || 1,
          gameweek: state.mySquad.gameweek,
          chips_used: state.mySquad.chips_used,
        },
      });
    } catch (e) {
      alert("Couldn't save chip usage: " + e.message);
    }
  }

  function chipsUsedForHalf(gameweek) {
    const half = gameweek <= FIRST_HALF_LAST_GW ? "first" : "second";
    return (state.mySquad.chips_used || [])
      .filter(key => key.endsWith(`_${half}`))
      .map(key => key.replace(`_${half}`, ""));
  }

  function renderChipAdvisorResult(result, targetElId, compact) {
    const el = document.getElementById(targetElId || "chipResult");
    let html = "";

    if (compact) {
      html += '<div class="chip-inline-heading">Chip check</div>';
    }

    if (result.headline) {
      const chipLabel = CHIP_LABELS[result.headline.chip];
      html += `
        <div class="chip-headline">
          Best move in this window: play your <strong>${chipLabel}</strong> in
          <strong>GW${result.headline.gameweek}</strong> (~${fmtXp(result.headline.projected_gain)} projected gain).
        </div>`;
    } else {
      html += `<div class="chip-headline">Nothing clears the bar this window — holding every chip looks right for now.</div>`;
    }

    if (compact) {
      el.innerHTML = html;
      return;
    }

    CHIP_TYPES.forEach(chip => {
      const rec = result.recommendations[chip];
      html += `<div class="chip-card">
        <div class="chip-card-title">${CHIP_LABELS[chip]}</div>`;
      if (rec) {
        html += `<div class="chip-card-value">Best in <strong>GW${rec.gameweek}</strong> — ${fmtXp(rec.projected_gain)} projected gain</div>`;
      } else {
        html += `<div class="chip-card-value hint">Already used this half, or no window to score.</div>`;
      }
      html += `</div>`;
    });

    html += `
      <table class="gw-table">
        <thead><tr><th>GW</th><th>Squad DGW/BGW</th><th>League DGW/BGW</th><th>Baseline xP</th></tr></thead>
        <tbody>`;
    result.gameweeks.forEach(r => {
      const squadFlag = r.squad_doubles > 0
        ? `<span class="dgw-flag">${r.squad_doubles} DGW</span>`
        : (r.squad_blanks > 0 ? `<span class="bgw-flag">${r.squad_blanks} BGW</span>` : "-");
      const leagueFlag = r.league_doubles > 0 || r.league_blanks > 0
        ? `${r.league_doubles ? `<span class="dgw-flag">${r.league_doubles} dbl</span>` : ""} ${r.league_blanks ? `<span class="bgw-flag">${r.league_blanks} blk</span>` : ""}`
        : "-";
      html += `<tr>
        <td>${r.gameweek}</td>
        <td>${squadFlag}</td>
        <td>${leagueFlag}</td>
        <td>${fmtXp(r.baseline_xp)}</td>
      </tr>`;
    });
    html += `</tbody></table>`;

    el.innerHTML = html;
  }

  async function analyzeChipWindows() {
    const resultEl = document.getElementById("chipResult");
    const btn = document.getElementById("chipAnalyzeBtn");

    if (!state.mySquad || !state.mySquad.squad || state.mySquad.squad.length === 0) {
      resultEl.innerHTML = '<p class="hint">Save a squad first (see "My Squad" above).</p>';
      return;
    }

    const gameweek = parseInt(document.getElementById("chipGameweek").value, 10);
    const horizon = parseInt(document.getElementById("chipHorizon").value, 10);
    const chipsUsedThisHalf = chipsUsedForHalf(gameweek);

    btn.disabled = true;
    resultEl.innerHTML = '<p class="hint">Scanning fixtures for double/blank gameweeks…</p>';
    try {
      const result = await apiFetch("/api/chips", {
        method: "POST",
        body: {
          gameweek,
          horizon,
          current_squad_ids: state.mySquad.squad,
          bank: state.mySquad.bank || 0,
          chips_used: chipsUsedThisHalf,
        },
      });
      renderChipAdvisorResult(result);
    } catch (e) {
      resultEl.innerHTML = `<p class="error">${e.message}</p>`;
    } finally {
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    document.getElementById("settingsToggle").addEventListener("click", toggleSettings);
    document.getElementById("saveSettings").addEventListener("click", saveSettings);
    document.getElementById("buildSquadBtn").addEventListener("click", buildOptimalSquad);
    document.getElementById("transferBtn").addEventListener("click", getTransferSuggestions);
    document.getElementById("chipAnalyzeBtn").addEventListener("click", analyzeChipWindows);
    renderChipToggles();
    loadMySquad();
  });
})();
