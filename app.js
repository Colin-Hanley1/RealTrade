// ===================== Supabase client =====================
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===================== State =====================
let trades = [];
let unitSize = 1;

// ===================== Element refs =====================
const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authSubmit = document.getElementById("authSubmit");
const authMsg = document.getElementById("authMsg");
const userEmailEl = document.getElementById("userEmail");

const tradeForm = document.getElementById("tradeForm");
const tradeMsg = document.getElementById("tradeMsg");
const payoutPreview = document.getElementById("payoutPreview");
const f_league = document.getElementById("f_league");
const f_market = document.getElementById("f_market");
const f_team = document.getElementById("f_team");
const f_team_other = document.getElementById("f_team_other");
const teamLabel = document.getElementById("teamLabel");
const teamOtherLabel = document.getElementById("teamOtherLabel");

const LEAGUE_MARKETS = {
  MLB: ["ML", "NRFI", "YRFI"],
  WNBA: ["ML"],
};
const MARKET_LABELS = { ML: "Moneyline", NRFI: "NRFI", YRFI: "YRFI" };

// Not exhaustive (new expansion franchises may be missing) — pick "Other"
// to type any code not listed here.
const TEAM_ABBR = {
  MLB: [
    ["ARI", "Diamondbacks"], ["ATL", "Braves"], ["ATH", "Athletics"], ["BAL", "Orioles"],
    ["BOS", "Red Sox"], ["CHC", "Cubs"], ["CWS", "White Sox"], ["CIN", "Reds"],
    ["CLE", "Guardians"], ["COL", "Rockies"], ["DET", "Tigers"], ["HOU", "Astros"],
    ["KC", "Royals"], ["LAA", "Angels"], ["LAD", "Dodgers"], ["MIA", "Marlins"],
    ["MIL", "Brewers"], ["MIN", "Twins"], ["NYM", "Mets"], ["NYY", "Yankees"],
    ["PHI", "Phillies"], ["PIT", "Pirates"], ["SD", "Padres"], ["SF", "Giants"],
    ["SEA", "Mariners"], ["STL", "Cardinals"], ["TB", "Rays"], ["TEX", "Rangers"],
    ["TOR", "Blue Jays"], ["WSH", "Nationals"],
  ],
  WNBA: [
    ["ATL", "Dream"], ["CHI", "Sky"], ["CONN", "Sun"], ["DAL", "Wings"],
    ["GS", "Valkyries"], ["IND", "Fever"], ["LA", "Sparks"], ["LV", "Aces"],
    ["MIN", "Lynx"], ["NY", "Liberty"], ["PHX", "Mercury"], ["SEA", "Storm"],
    ["WAS", "Mystics"],
  ],
};

function populateTeamOptions() {
  const teams = TEAM_ABBR[f_league.value];
  f_team.innerHTML = teams.map(([code, name]) => `<option value="${code}">${code} — ${name}</option>`).join("") + `<option value="OTHER">Other…</option>`;
}

function refreshMarketOptions() {
  const allowed = LEAGUE_MARKETS[f_league.value];
  for (const opt of f_market.options) {
    opt.hidden = !allowed.includes(opt.value);
  }
  if (!allowed.includes(f_market.value)) f_market.value = allowed[0];
  populateTeamOptions();
  updateTeamVisibility();
}

function updateTeamVisibility() {
  const needsTeam = f_market.value === "ML";
  teamLabel.hidden = !needsTeam;
  f_team.required = needsTeam;
  updateTeamOtherVisibility();
}

function updateTeamOtherVisibility() {
  const showOther = !teamLabel.hidden && f_team.value === "OTHER";
  teamOtherLabel.hidden = !showOther;
  f_team_other.required = showOther;
  if (!showOther) f_team_other.value = "";
}

f_league.addEventListener("change", refreshMarketOptions);
f_market.addEventListener("change", updateTeamVisibility);
f_team.addEventListener("change", updateTeamOtherVisibility);
refreshMarketOptions();

// ===================== Unit size =====================
const f_unitsize = document.getElementById("f_unitsize");
const saveUnitSize = document.getElementById("saveUnitSize");
const unitSizeMsg = document.getElementById("unitSizeMsg");

async function loadUnitSize() {
  const { data, error } = await sb.from("settings").select("unit_size").maybeSingle();
  if (error) {
    console.error(error);
    return;
  }
  unitSize = data ? Number(data.unit_size) : 1;
  f_unitsize.value = unitSize;
  updatePayoutPreview();
}

saveUnitSize.addEventListener("click", async () => {
  const value = parseFloat(f_unitsize.value);
  if (!(value > 0)) {
    setMsg(unitSizeMsg, "Enter a unit size greater than 0.", "error");
    return;
  }
  const { error } = await sb.from("settings").upsert({ unit_size: value }, { onConflict: "user_id" });
  if (error) {
    setMsg(unitSizeMsg, error.message, "error");
    return;
  }
  unitSize = value;
  setMsg(unitSizeMsg, "Saved.", "ok");
  updatePayoutPreview();
});

const historyBody = document.getElementById("historyBody");
const historyEmpty = document.getElementById("historyEmpty");
const filterStatus = document.getElementById("filterStatus");
const filterEvent = document.getElementById("filterEvent");

const riskFlagsEl = document.getElementById("riskFlags");
const statTotal = document.getElementById("statTotal");
const statExposure = document.getElementById("statExposure");
const statWinRate = document.getElementById("statWinRate");
const statPnl = document.getElementById("statPnl");

// ===================== Helpers =====================
function money(n) {
  const sign = n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toFixed(2)} Rax`;
}

function shares(price, stake) {
  return stake / (price / 100);
}

function pnlFor(trade) {
  if (trade.status === "open") return null;
  if (trade.status === "push") return 0;
  const sh = shares(trade.price, trade.stake);
  if (trade.status === "won") return sh - trade.stake;
  if (trade.status === "lost") return -trade.stake;
  return null;
}

function setMsg(el, text, kind) {
  el.textContent = text || "";
  el.classList.remove("error", "ok");
  if (kind) el.classList.add(kind);
}

// ===================== Auth =====================
function showApp(session) {
  authView.hidden = true;
  appView.hidden = false;
  userEmailEl.textContent = session.user.email;
  loadUnitSize();
  loadTrades();
}

function showAuth() {
  appView.hidden = true;
  authView.hidden = false;
  trades = [];
}

// A 15s watchdog: if the request hangs (rare, but seen with some browser
// extensions that intercept fetch) surface that instead of leaving the
// button disabled and the user staring at nothing.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s — check for browser extensions blocking requests to supabase.co`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg(authMsg, "");
  authSubmit.disabled = true;
  const email = authEmail.value.trim();
  const password = authPassword.value;

  try {
    const { data, error } = await withTimeout(sb.auth.signInWithPassword({ email, password }), 15000, "Sign in");
    if (error) throw error;
    if (!data.session) throw new Error("Signed in but no session was returned — please retry.");
    showApp(data.session);
  } catch (err) {
    console.error(err);
    setMsg(authMsg, err.message, "error");
  } finally {
    authSubmit.disabled = false;
  }
});

document.getElementById("signOutBtn").addEventListener("click", async () => {
  await sb.auth.signOut();
  showAuth();
});

// Covers page load/refresh with an existing session, and keeps state in
// sync if the session changes in another tab (e.g. signing out elsewhere).
sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    showApp(session);
  } else {
    showAuth();
  }
});

// ===================== Tabs =====================
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.getElementById("panel-new").hidden = btn.dataset.tab !== "new";
    document.getElementById("panel-history").hidden = btn.dataset.tab !== "history";
    document.getElementById("panel-dashboard").hidden = btn.dataset.tab !== "dashboard";
  });
});

// ===================== New trade form =====================
const f_price = document.getElementById("f_price");
const f_units = document.getElementById("f_units");

function updatePayoutPreview() {
  const price = parseFloat(f_price.value);
  const units = parseFloat(f_units.value);
  if (price > 0 && price < 100 && units > 0) {
    const stake = units * unitSize;
    const payout = shares(price, stake);
    payoutPreview.textContent = `Stake ${units}u (${money(stake)}) at ${price}% → returns ${money(payout)} if correct`;
  } else {
    payoutPreview.textContent = "Stake 0u (0.00 Rax) at 0% → returns 0.00 Rax if correct";
  }
}
f_price.addEventListener("input", updatePayoutPreview);
f_units.addEventListener("input", updatePayoutPreview);

tradeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg(tradeMsg, "");

  const teamCode = f_team.value === "OTHER" ? f_team_other.value.trim().toUpperCase() : f_team.value;
  const outcome = f_market.value === "ML" ? `${teamCode} ML` : MARKET_LABELS[f_market.value];
  const units = parseFloat(f_units.value);

  const payload = {
    // user_id is intentionally omitted — the trades table defaults it to
    // auth.uid(), so no extra getUser()/getSession() round-trip is needed here.
    trade_date: document.getElementById("f_date").value,
    league: f_league.value,
    event: document.getElementById("f_event").value.trim(),
    outcome,
    price: parseFloat(f_price.value),
    units,
    // stake is captured in Rax at the unit size in effect right now, so a
    // later change to unit size doesn't retroactively change past trades.
    stake: units * unitSize,
    notes: document.getElementById("f_notes").value.trim() || null,
    status: "open",
  };

  const { error } = await sb.from("trades").insert(payload);
  if (error) {
    if (error.message.includes("trades_user_id_fkey")) {
      // The session's JWT is still cryptographically valid but its user no
      // longer exists (e.g. the account was deleted/recreated) — a fresh
      // sign-in mints a token tied to the current account.
      await sb.auth.signOut();
      showAuth();
      setMsg(authMsg, "Your session pointed at an account that no longer exists — please sign in again.", "error");
      return;
    }
    setMsg(tradeMsg, error.message, "error");
    return;
  }
  setMsg(tradeMsg, "Trade logged.", "ok");
  tradeForm.reset();
  refreshMarketOptions();
  updatePayoutPreview();
  loadTrades();
});

// ===================== Load / render =====================
async function loadTrades() {
  const { data, error } = await sb.from("trades").select("*").order("trade_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    return;
  }
  trades = data;
  renderHistory();
  renderDashboard();
}

function renderHistory() {
  const statusFilter = filterStatus.value;
  const eventFilter = filterEvent.value.trim().toLowerCase();

  const rows = trades.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (eventFilter && !t.event.toLowerCase().includes(eventFilter)) return false;
    return true;
  });

  historyBody.innerHTML = "";
  historyEmpty.hidden = rows.length > 0;

  for (const t of rows) {
    const tr = document.createElement("tr");
    const pnl = pnlFor(t);
    const pnlClass = pnl === null ? "" : pnl > 0 ? "pnl-pos" : pnl < 0 ? "pnl-neg" : "pnl-zero";
    const pnlText = pnl === null ? "—" : money(pnl);

    tr.innerHTML = `
      <td>${t.trade_date}</td>
      <td>${escapeHtml(t.league || "—")}</td>
      <td>${escapeHtml(t.event)}</td>
      <td>${escapeHtml(t.outcome)}</td>
      <td>${t.price}%</td>
      <td>${t.units ? `${t.units}u · ` : ""}${money(t.stake)}</td>
      <td><span class="badge badge-${t.status}">${t.status}</span></td>
      <td class="${pnlClass}">${pnlText}</td>
      <td class="row-actions"></td>
    `;

    const actionsCell = tr.querySelector(".row-actions");

    if (t.status === "open") {
      const select = document.createElement("select");
      select.innerHTML = `
        <option value="">Settle…</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
        <option value="push">Push</option>
      `;
      select.addEventListener("change", async () => {
        if (!select.value) return;
        await sb.from("trades").update({ status: select.value }).eq("id", t.id);
        loadTrades();
      });
      actionsCell.appendChild(select);
    }

    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.className = "danger";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`Delete trade "${t.event} — ${t.outcome}"?`)) return;
      await sb.from("trades").delete().eq("id", t.id);
      loadTrades();
    });
    actionsCell.appendChild(delBtn);

    historyBody.appendChild(tr);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

filterStatus.addEventListener("change", renderHistory);
filterEvent.addEventListener("input", renderHistory);

function renderDashboard() {
  const open = trades.filter((t) => t.status === "open");
  const settled = trades.filter((t) => t.status !== "open");
  const won = settled.filter((t) => t.status === "won");
  const lost = settled.filter((t) => t.status === "lost");

  statTotal.textContent = trades.length;
  statExposure.textContent = money(open.reduce((sum, t) => sum + Number(t.stake), 0));

  const decided = won.length + lost.length;
  statWinRate.textContent = decided === 0 ? "—" : `${((won.length / decided) * 100).toFixed(1)}%`;

  const realizedPnl = settled.reduce((sum, t) => sum + (pnlFor(t) || 0), 0);
  statPnl.textContent = money(realizedPnl);
  statPnl.classList.toggle("pnl-pos", realizedPnl > 0);
  statPnl.classList.toggle("pnl-neg", realizedPnl < 0);

  renderRiskFlags(open);
}

function renderRiskFlags(openTrades) {
  const groups = {};
  for (const t of openTrades) {
    const key = t.event.trim().toLowerCase();
    if (!groups[key]) groups[key] = { label: t.event.trim(), trades: [] };
    groups[key].trades.push(t);
  }

  const flags = [];
  for (const key in groups) {
    const group = groups[key];
    const distinctOutcomes = new Set(group.trades.map((t) => t.outcome.trim().toLowerCase()));
    if (distinctOutcomes.size < 2) continue;

    const sum = group.trades.reduce((s, t) => s + Number(t.price), 0);
    if (sum >= 100) {
      flags.push({ level: "red", text: `Guaranteed loss — combined price ${sum.toFixed(1)}% across ${distinctOutcomes.size} outcomes on "${group.label}"` });
    } else if (sum >= 85) {
      flags.push({ level: "yellow", text: `Thin margin — combined price ${sum.toFixed(1)}% across ${distinctOutcomes.size} outcomes on "${group.label}"` });
    }
  }

  riskFlagsEl.innerHTML = "";
  for (const flag of flags) {
    const div = document.createElement("div");
    div.className = `risk-flag ${flag.level}`;
    div.innerHTML = `<span class="flag-tag">${flag.level === "red" ? "Lose-Lose" : "Warning"}</span><span>${escapeHtml(flag.text)}</span>`;
    riskFlagsEl.appendChild(div);
  }
}

// default the date field to today
document.getElementById("f_date").value = new Date().toISOString().slice(0, 10);
