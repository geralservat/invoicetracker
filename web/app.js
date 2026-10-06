import { createClient } from "@supabase/supabase-js";
import {
  recalculateInvoice, nextId, dueDateFor, paymentTermsLabel, isConsignation,
  monthKeyOf, monthLabel, clearedInMonth, toISODate, parseISODate,
} from "./logic.js";

const cfg = window.INVOICE_TRACKING_CONFIG;
const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const S = {
  profile: null,
  customers: new Map(),
  route: "login",
  routeArg: "",
  invoices: [],
  recordPreselect: "",
  deferredInstall: null,
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => `${Number(n ?? 0).toFixed(2)} MT`;
const fmtDay = (iso) => {
  const d = parseISODate(iso);
  return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
};

function friendlyError(e) {
  const m = String(e?.message ?? e);
  if (/failed to fetch|networkerror|load failed|offline/i.test(m) || !navigator.onLine)
    return "No internet connection. Connect to Wi-Fi or mobile data and try again.";
  if (/invalid login credentials/i.test(m)) return "Incorrect email or password.";
  if (/email not confirmed/i.test(m)) return "Email not confirmed — ask your admin to confirm it.";
  return m;
}

/* ---------- data ---------- */

async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  return loadProfile();
}

async function loadProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb
    .from("profiles").select("*").eq("auth_user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Signed in, but no profile is linked for this account.");
  if (String(data.status).toUpperCase() !== "ACTIVE")
    throw new Error("This account is inactive. Contact your admin.");
  S.profile = data;
  await sb.from("profiles").update({ last_login: new Date().toISOString() }).eq("auth_user_id", user.id);
  const { data: custs } = await sb.from("customers").select("customer_id,customer_name");
  S.customers = new Map((custs ?? []).map((c) => [c.customer_id, c.customer_name]));
  return data;
}

function scopedInvoicesQuery() {
  let q = sb.from("invoices").select("*").order("invoice_date", { ascending: false });
  if (!S.profile?.can_view_all_invoices) q = q.eq("salesperson_id", S.profile.user_id);
  return q;
}

async function loadInvoices() {
  const { data, error } = await scopedInvoicesQuery();
  if (error) throw error;
  S.invoices = data ?? [];
}

async function recordPayment({ invoice, amount, dateISO, method, reference }) {
  const { data: existing } = await sb.from("payments").select("payment_id");
  const newId = nextId("PAY", (existing ?? []).map((r) => r.payment_id));
  const now = new Date().toISOString();
  const { error: insErr } = await sb.from("payments").insert({
    payment_id: newId, invoice_id: invoice.invoice_id, customer_id: invoice.customer_id,
    salesperson_id: invoice.salesperson_id, payment_date: dateISO, amount,
    payment_method: method, reference_number: reference,
    received_by: S.profile.full_name ?? "", remarks: "",
    created_at: now, updated_at: now, payment_status: "CLEARED",
  });
  if (insErr) throw insErr;
  const { data: pays } = await sb.from("payments").select("*").eq("invoice_id", invoice.invoice_id);
  const clearedTotal = (pays ?? []).filter((p) => p.payment_status === "CLEARED")
    .reduce((s, p) => s + Number(p.amount), 0);
  const calc = recalculateInvoice({
    invoiceAmount: Number(invoice.invoice_amount), clearedTotal,
    dueDateStr: invoice.due_date, termsDays: invoice.payment_terms_days,
  });
  const lastPaid = (pays ?? []).filter((p) => p.payment_status === "CLEARED")
    .map((p) => p.payment_date).sort().pop() ?? null;
  const { error: upErr } = await sb.from("invoices").update({
    amount_paid: calc.amountPaid, balance: calc.balance, status: calc.status,
    days_overdue: calc.daysOverdue, last_payment_date: lastPaid, updated_at: now,
  }).eq("invoice_id", invoice.invoice_id);
  if (upErr) throw upErr;
}

/* ---------- shell ---------- */

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function shell(title, body, active) {
  const tabs = [
    ["dashboard", "🏠", "Home"],
    ["invoices", "🧾", "Invoices"],
    ["record", "💰", "Record"],
  ];
  return `
    ${navigator.onLine ? "" : `<div class="offline-bar">Offline — showing last loaded data</div>`}
    <div class="topbar"><h1>${esc(title)}</h1>
      <button id="btn-logout">Sign out</button></div>
    <main>${installBanner()}${body}</main>
    <nav class="tabbar">${tabs.map(([r, ico, label]) =>
      `<button data-route="${r}" class="${active === r ? "on" : ""}"><span class="ico">${ico}</span>${label}</button>`).join("")}
    </nav>`;
}

function installBanner() {
  if (isStandalone || localStorage.getItem("hide-install") === "1") return "";
  if (S.deferredInstall)
    return `<div class="install-banner">Install this app for quick access.
      <br /><button class="action" id="btn-install">Install app</button></div>`;
  if (isIOS)
    return `<div class="install-banner">On iPhone: tap <b>Share → Add to Home Screen</b> to install.
      <br /><button class="ghost" id="btn-hide-install">Dismiss</button></div>`;
  return "";
}

function bindShell(active) {
  document.querySelectorAll("[data-route]").forEach((b) =>
    b.addEventListener("click", () => go(b.dataset.route)));
  const lo = $("#btn-logout");
  if (lo) lo.addEventListener("click", async () => { await sb.auth.signOut(); S.profile = null; go("login"); });
  const ins = $("#btn-install");
  if (ins) ins.addEventListener("click", async () => {
    if (S.deferredInstall) { S.deferredInstall.prompt(); S.deferredInstall = null; render(); }
  });
  const hi = $("#btn-hide-install");
  if (hi) hi.addEventListener("click", () => { localStorage.setItem("hide-install", "1"); render(); });
}

/* ---------- screens ---------- */

function loginScreen(err = "") {
  document.title = "Sign In — Invoice Tracking";
  $("#app").innerHTML = `
    <div class="topbar"><h1>Invoice Tracking</h1><span></span></div>
    <main><div class="card">
      <h2 style="margin-top:0">Sign in</h2>
      <label>Email</label>
      <input id="f-email" type="email" autocomplete="username" />
      <label>Password</label>
      <input id="f-pass" type="password" autocomplete="current-password" />
      ${err ? `<div class="err">${esc(err)}</div>` : ""}
      <button class="action" id="btn-login">Sign In</button>
    </div></main>`;
  $("#btn-login").addEventListener("click", async () => {
    $("#btn-login").disabled = true;
    try {
      await signIn($("#f-email").value, $("#f-pass").value);
      await refreshData();
      go("dashboard");
    } catch (e) {
      loginScreen(friendlyError(e));
    }
  });
}

function dashboardScreen() {
  document.title = "Dashboard — Invoice Tracking";
  const open = S.invoices.filter((i) => i.status !== "PAID");
  const od = S.invoices.filter((i) => i.status === "OVERDUE");
  const tot = (l) => l.reduce((s, i) => s + Number(i.balance), 0);
  const nowKey = toISODate(new Date()).slice(0, 7);
  const att = S.invoices
    .filter((i) => i.status === "OVERDUE" || i.status === "PARTIALLY_PAID")
    .sort((a, b) => b.days_overdue - a.days_overdue);
  const first = (S.profile?.full_name ?? "").split(" ")[0];
  $("#app").innerHTML = shell(`Hello, ${esc(first)}`, `
    <div class="grid2">
      <div class="metric m-red"><div class="t">Overdue</div><div class="v">${money(tot(od))}</div><div class="s">${od.length} invoices</div></div>
      <div class="metric m-blue"><div class="t">Outstanding</div><div class="v">${money(tot(open))}</div><div class="s">${open.length} invoices</div></div>
    </div>
    <div class="metric m-green"><div class="t">Collected ${esc(monthLabel(nowKey))}</div>
      <div class="v">${money(S.monthTotal)}</div><div class="s">${S.monthCount} payments</div></div>
    <div class="card"><div class="row"><b>Collections by month</b></div>
      ${(S.months ?? []).map((m) => `<div class="row item"><span>${esc(m.label)}</span><b>${money(m.total)} (${m.count})</b></div>`).join("") || `<div class="hint">No collections yet</div>`}
    </div>
    <div class="card"><b>Needs attention (${att.length})</b>
      ${att.slice(0, 10).map((i) => `
        <div class="item row" data-inv="${esc(i.invoice_id)}" style="cursor:pointer">
          <span>${esc(i.invoice_number)}<br /><small>${esc(S.customers.get(i.customer_id) ?? "")}</small></span>
          <span><span class="badge b-${i.status}">${i.status}</span><br /><b>${money(i.balance)}</b></span>
        </div>`).join("") || `<div class="hint">All clear 🎉</div>`}
    </div>`, "dashboard");
  bindShell();
  document.querySelectorAll("[data-inv]").forEach((el) =>
    el.addEventListener("click", () => go("invoice", el.dataset.inv)));
}

function invoicesScreen() {
  document.title = "Invoices — Invoice Tracking";
  const q = (S.invQuery ?? "").toLowerCase();
  const list = S.invoices.filter((i) =>
    !q || i.invoice_number.toLowerCase().includes(q) ||
    (S.customers.get(i.customer_id) ?? "").toLowerCase().includes(q));
  $("#app").innerHTML = shell("Invoices", `
    <div class="card"><input id="f-q" placeholder="Search number or customer…" value="${esc(S.invQuery ?? "")}" /></div>
    ${list.map((i) => `
      <div class="card item" data-inv="${esc(i.invoice_id)}" style="cursor:pointer">
        <div class="row"><b>${esc(i.invoice_number)}</b><span class="badge b-${i.status}">${i.status}</span></div>
        <div class="hint">${esc(S.customers.get(i.customer_id) ?? i.customer_id)} • ${esc(i.invoice_date ?? "")}</div>
        <div class="row" style="margin-top:6px"><span class="hint">${esc(paymentTermsLabel(i.payment_terms_days))}</span><b>${money(i.balance)}</b></div>
      </div>`).join("") || `<div class="card hint">No invoices found</div>`}`, "invoices");
  bindShell();
  $("#f-q").addEventListener("input", (e) => { S.invQuery = e.target.value; });
  $("#f-q").addEventListener("change", () => invoicesScreen());
  document.querySelectorAll("[data-inv]").forEach((el) =>
    el.addEventListener("click", () => go("invoice", el.dataset.inv)));
}

async function invoiceScreen(id) {
  const inv = S.invoices.find((i) => i.invoice_id === id);
  if (!inv) { go("invoices"); return; }
  document.title = `${inv.invoice_number} — Invoice Tracking`;
  $("#app").innerHTML = shell(inv.invoice_number, `<div class="card">Loading…</div>`, "invoices");
  bindShell();
  let pays = [];
  try {
    const { data, error } = await sb.from("payments").select("*").eq("invoice_id", id).order("payment_date", { ascending: false });
    if (error) throw error;
    pays = data ?? [];
  } catch (e) {
    pays = [];
  }
  $("#app").innerHTML = shell(inv.invoice_number, `
    <div class="card">
      <div class="row"><span>${esc(S.customers.get(inv.customer_id) ?? "")}</span><span class="badge b-${inv.status}">${inv.status}</span></div>
      <div class="item row"><span class="hint">Terms</span><b>${esc(paymentTermsLabel(inv.payment_terms_days))}</b></div>
      <div class="item row"><span class="hint">Due</span><b>${esc(inv.due_date ?? "")}</b></div>
      <div class="item row"><span class="hint">Amount</span><b>${money(inv.invoice_amount)}</b></div>
      <div class="item row"><span class="hint">Paid</span><b>${money(inv.amount_paid)}</b></div>
      <div class="item row"><span class="hint">Balance</span><b>${money(inv.balance)}</b></div>
    </div>
    <div class="card"><b>Payments (${pays.length})</b>
      ${pays.map((p) => `<div class="item row"><span>${esc(p.payment_date)}<br /><small>${esc(p.payment_method)} • ${esc(p.payment_status)}</small></span><b>${money(p.amount)}</b></div>`).join("") || `<div class="hint">None yet</div>`}
    </div>
    ${S.profile?.can_record_payment ? `<button class="action" id="btn-topay">Record payment</button>` : ""}`, "invoices");
  bindShell();
  const b = $("#btn-topay");
  if (b) b.addEventListener("click", () => { S.recordPreselect = id; go("record"); });
}

function recordScreen(err = "") {
  document.title = "Record Payment — Invoice Tracking";
  const open = S.invoices.filter((i) => i.status !== "PAID");
  const sel = S.recordPreselect || open[0]?.invoice_id || "";
  const inv = S.invoices.find((i) => i.invoice_id === sel);
  const today = toISODate(new Date());
  $("#app").innerHTML = shell("Record Payment", `
    <div class="card">
      <label>Invoice *</label>
      <select id="f-inv">${open.map((i) => `<option value="${esc(i.invoice_id)}" ${i.invoice_id === sel ? "selected" : ""}>${esc(i.invoice_number)} — ${money(i.balance)}</option>`).join("")}</select>
      <label>Amount *</label>
      <input id="f-amt" type="number" step="0.01" min="0" value="${inv ? Number(inv.balance).toFixed(2) : ""}" />
      <label>Payment date * (monthly collection follows this date)</label>
      <input id="f-date" type="date" value="${S.recordDate ?? today}" />
      <label>Method *</label>
      <select id="f-method">${["BANK_TRANSFER", "CASH", "CHEQUE", "MOMO", "M_PESA", "OTHER"].map((m) => `<option>${m}</option>`).join("")}</select>
      <label>Reference</label>
      <input id="f-ref" />
      ${err ? `<div class="err">${esc(err)}</div>` : ""}
      <button class="action" id="btn-save">Record Payment</button>
    </div>`, "record");
  bindShell();
  $("#f-inv").addEventListener("change", (e) => { S.recordPreselect = e.target.value; S.recordDate = $("#f-date").value; recordScreen(); });
  $("#btn-save").addEventListener("click", async () => {
    const invoice = S.invoices.find((i) => i.invoice_id === $("#f-inv").value);
    const amount = parseFloat($("#f-amt").value);
    const dateISO = $("#f-date").value || today;
    S.recordDate = dateISO;
    if (!invoice) return recordScreen("Select an invoice.");
    if (!(amount > 0)) return recordScreen("Enter a valid amount greater than 0.");
    if (amount - Number(invoice.balance) > 0.005)
      return recordScreen(`Amount cannot exceed balance (${money(invoice.balance)}).`);
    $("#btn-save").disabled = true;
    try {
      await recordPayment({ invoice, amount, dateISO, method: $("#f-method").value, reference: $("#f-ref").value.trim() });
      await refreshData();
      S.recordPreselect = "";
      go("invoice", invoice.invoice_id);
    } catch (e) {
      recordScreen(friendlyError(e));
    }
  });
}

/* ---------- router ---------- */

async function refreshData() {
  await loadInvoices();
  const { data: pays } = await sb.from("payments").select("payment_date,amount,payment_status");
  const nowKey = toISODate(new Date()).slice(0, 7);
  // RLS already scopes rows server-side; month math is client-side.
  const byMonth = new Map();
  for (const p of pays ?? []) {
    if (p.payment_status !== "CLEARED") continue;
    const k = monthKeyOf(p.payment_date);
    const e = byMonth.get(k) ?? { total: 0, count: 0 };
    e.total += Number(p.amount); e.count++;
    byMonth.set(k, e);
  }
  S.months = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 6)
    .map(([k, v]) => ({ key: k, label: monthLabel(k), total: v.total, count: v.count }));
  const cur = byMonth.get(nowKey) ?? { total: 0, count: 0 };
  S.monthTotal = cur.total; S.monthCount = cur.count;
}

function render() {
  if (!S.profile) return loginScreen();
  if (S.route === "dashboard") return dashboardScreen();
  if (S.route === "invoices") return invoicesScreen();
  if (S.route === "record") return recordScreen();
  if (S.route === "invoice") return invoiceScreen(S.routeArg);
  return dashboardScreen();
}

function go(route, arg = "") {
  S.route = route; S.routeArg = arg;
  location.hash = `#/${route}${arg ? "/" + encodeURIComponent(arg) : ""}`;
}

async function boot() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    S.deferredInstall = e;
    render();
  });
  window.addEventListener("online", () => render());
  window.addEventListener("offline", () => render());
  window.addEventListener("hashchange", () => {
    const [, r, a] = location.hash.split("/");
    if (r) { S.route = r; S.routeArg = a ? decodeURIComponent(a) : ""; render(); }
  });
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      await loadProfile();
      await refreshData();
      const [, r, a] = location.hash.split("/");
      S.route = r || "dashboard"; S.routeArg = a ? decodeURIComponent(a) : "";
    }
  } catch { /* fall through to login */ }
  render();
}

boot();
