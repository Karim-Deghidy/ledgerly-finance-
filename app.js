import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, onSnapshot,
  addDoc, updateDoc, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const VAULT_STORAGE_KEY = "ledgerly_vault_id_v1";
const LOCAL_KEYS = { accounts: "ledgerly_accounts_v1", transactions: "ledgerly_transactions_v1", budgets: "ledgerly_budgets_v1" };
const PALETTE = ["#2457d6", "#15966a", "#d96d54", "#7755c8", "#d69b34", "#268caa", "#b45b91", "#65758b"];
const EXPENSE_CATEGORIES = ["Food & Dining", "Transport", "Fuel & Gas", "Shopping", "Bills & Utilities", "Health", "Education", "Entertainment", "Travel", "Personal Care", "Home", "Other"];
const INCOME_CATEGORIES = ["Salary", "Freelance", "Business", "Gift", "Investment", "Other"];
const CATEGORY_ICONS = { "Food & Dining": "◒", Transport: "↗", "Fuel & Gas": "🚗", Shopping: "◇", "Bills & Utilities": "⌁", Health: "+", Education: "▤", Entertainment: "♫", Travel: "✈", "Personal Care": "✧", Home: "⌂", Other: "•", Salary: "↗", Freelance: "✎", Business: "▣", Gift: "♡", Investment: "⌁" };

let db = null;
let cloudEnabled = false;
let vaultId = getOrCreateVaultId();
let state = { accounts: [], transactions: [], budgets: [] };
let currentPage = "overview";
let currentTransactionType = "expense";
let transactionSort = { key: "date", direction: "desc" };
let unsubscribe = [];

function getOrCreateVaultId() {
  let id = localStorage.getItem(VAULT_STORAGE_KEY);
  if (!id) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    id = [...bytes].map(v => v.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(VAULT_STORAGE_KEY, id);
  }
  return id;
}

function firebaseConfigured() {
  return firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE_") && firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("YOUR_") && firebaseConfig.appId && !firebaseConfig.appId.startsWith("YOUR_");
}

function localDateISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function currentMonth() { return localDateISO().slice(0, 7); }

function money(value) {
  const n = Number(value || 0);
  return `EGP ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortMoney(value) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1000000) return `EGP ${(n / 1000000).toFixed(1)}m`;
  if (Math.abs(n) >= 10000) return `EGP ${(n / 1000).toFixed(1)}k`;
  return money(n);
}

function formatDate(date) {
  if (!date) return "—";
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

function defaultAccounts() {
  return [
    { id: "cash", name: "Cash", type: "cash", openingBalance: 0, color: PALETTE[0], archived: false, createdAt: Date.now() },
    { id: "card-1", name: "Bank Card 1", type: "card", openingBalance: 0, color: PALETTE[1], archived: false, createdAt: Date.now() },
    { id: "card-2", name: "Bank Card 2", type: "card", openingBalance: 0, color: PALETTE[3], archived: false, createdAt: Date.now() }
  ];
}

function readLocal(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
  catch { return fallback; }
}

function persistLocal() {
  localStorage.setItem(LOCAL_KEYS.accounts, JSON.stringify(state.accounts));
  localStorage.setItem(LOCAL_KEYS.transactions, JSON.stringify(state.transactions));
  localStorage.setItem(LOCAL_KEYS.budgets, JSON.stringify(state.budgets));
}

function updateSyncUI(mode, message) {
  const dot = $("#sync-dot");
  const label = $("#sync-label");
  const desc = $("#sync-description");
  dot?.classList.toggle("online", mode === "online");
  if (label) label.textContent = mode === "online" ? "Firebase connected" : mode === "error" ? "Sync issue" : "Local storage";
  if (desc) desc.textContent = message || (mode === "online" ? "Your data syncs through Firebase." : "Your data is saved on this device.");
}

async function initialiseData() {
  if (!firebaseConfigured()) {
    state.accounts = readLocal(LOCAL_KEYS.accounts, null);
    state.transactions = readLocal(LOCAL_KEYS.transactions, []);
    state.budgets = readLocal(LOCAL_KEYS.budgets, []);
    if (state.accounts === null) state.accounts = defaultAccounts();
    persistLocal();
    updateSyncUI("local", "Add your Firebase config to enable cloud sync.");
    renderAll();
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    const vaultRef = doc(db, "vaults", vaultId);
    const vaultSnap = await getDoc(vaultRef);

    if (!vaultSnap.exists()) {
      await setDoc(vaultRef, { createdAt: Date.now(), app: "ledgerly", version: 1 });
      const localAccounts = readLocal(LOCAL_KEYS.accounts, null);
      const seedAccounts = Array.isArray(localAccounts) && localAccounts.length ? localAccounts : defaultAccounts();
      for (const account of seedAccounts) await setDoc(doc(db, "vaults", vaultId, "accounts", account.id), account);
      const localTransactions = readLocal(LOCAL_KEYS.transactions, []);
      const localBudgets = readLocal(LOCAL_KEYS.budgets, []);
      for (const tx of localTransactions) await setDoc(doc(db, "vaults", vaultId, "transactions", tx.id), tx);
      for (const budget of localBudgets) await setDoc(doc(db, "vaults", vaultId, "budgets", budget.id), budget);
    }

    cloudEnabled = true;
    updateSyncUI("online", "Your data is syncing with Firebase.");

    const accountsRef = collection(db, "vaults", vaultId, "accounts");
    const transactionsRef = collection(db, "vaults", vaultId, "transactions");
    const budgetsRef = collection(db, "vaults", vaultId, "budgets");

    unsubscribe.push(onSnapshot(accountsRef, snap => {
      state.accounts = snap.docs.map(item => ({ ...item.data(), id: item.id }));
      renderAll();
    }, handleCloudError));

    unsubscribe.push(onSnapshot(transactionsRef, snap => {
      state.transactions = snap.docs.map(item => ({ ...item.data(), id: item.id }));
      renderAll();
    }, handleCloudError));

    unsubscribe.push(onSnapshot(budgetsRef, snap => {
      state.budgets = snap.docs.map(item => ({ ...item.data(), id: item.id }));
      renderAll();
    }, handleCloudError));

  } catch (error) {
    console.error(error);
    cloudEnabled = false;
    state.accounts = readLocal(LOCAL_KEYS.accounts, defaultAccounts());
    state.transactions = readLocal(LOCAL_KEYS.transactions, []);
    state.budgets = readLocal(LOCAL_KEYS.budgets, []);
    updateSyncUI("error", "Firebase could not connect. Your local data is still available.");
    renderAll();
    toast("Firebase connection failed. Check your config and Firestore rules.", "error");
  }
}

function handleCloudError(error) {
  console.error(error);
  updateSyncUI("error", "Firebase sync error. Check your Firestore rules and connection.");
  toast("A Firebase sync error occurred.", "error");
}

function accountById(id) { return state.accounts.find(a => a.id === id); }

function accountBalance(accountId) {
  const account = accountById(accountId);
  if (!account) return 0;
  let balance = Number(account.openingBalance || 0);

  for (const tx of state.transactions) {
    const amount = Number(tx.amount || 0);
    if (tx.type === "income" && tx.accountId === accountId) balance += amount;
    if (tx.type === "expense" && tx.accountId === accountId) balance -= amount;
    if (tx.type === "transfer" && tx.fromAccountId === accountId) balance -= amount;
    if (tx.type === "transfer" && tx.toAccountId === accountId) balance += amount;
  }
  return balance;
}

function currentMonthTransactions() {
  return state.transactions.filter(tx => (tx.date || "").startsWith(currentMonth()));
}

function monthTotals() {
  const txs = currentMonthTransactions();
  const income = txs.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount || 0), 0);
  const expenses = txs.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount || 0), 0);
  return {
    income,
    expenses,
    savings: income - expenses,
    incomeCount: txs.filter(t => t.type === "income").length,
    expenseCount: txs.filter(t => t.type === "expense").length
  };
}

function txAccountLabel(tx) {
  if (tx.type === "transfer") return `${accountById(tx.fromAccountId)?.name || "Account"} → ${accountById(tx.toAccountId)?.name || "Account"}`;
  return accountById(tx.accountId)?.name || "Deleted account";
}

function txTitle(tx) {
  if (tx.type === "transfer") return tx.note || "Account transfer";
  return tx.note || tx.category || (tx.type === "income" ? "Income" : "Expense");
}

function sortedTransactions(items = state.transactions) {
  return [...items].sort((a, b) => (b.date || "").localeCompare(a.date || "") || Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function activeAccounts() { return state.accounts.filter(a => !a.archived); }

function renderAll() {
  renderOverview();
  renderTransactions();
  renderAccounts();
  renderBudgets();
  renderReports();
}

function renderOverview() {
  const totals = monthTotals();
  const totalBalance = state.accounts.reduce((sum, account) => sum + accountBalance(account.id), 0);
  $("#total-balance").textContent = money(totalBalance);
  $("#monthly-income").textContent = money(totals.income);
  $("#monthly-expenses").textContent = money(totals.expenses);
  $("#monthly-savings").textContent = money(totals.savings);
  $("#income-count").textContent = `${totals.incomeCount} income ${totals.incomeCount === 1 ? "entry" : "entries"}`;
  $("#expense-count").textContent = `${totals.expenseCount} expense ${totals.expenseCount === 1 ? "entry" : "entries"}`;
  const rate = totals.income > 0 ? Math.round((totals.savings / totals.income) * 100) : 0;
  $("#savings-rate").textContent = `${rate}% saved this month`;
  $("#spending-month").textContent = new Date().toLocaleDateString("en-GB", { month: "short", year: "numeric" });

  const accounts = activeAccounts();
  $("#overview-accounts").innerHTML = accounts.length ? accounts.slice(0, 5).map(account => `
    <div class="account-mini">
      <span class="account-symbol" style="background:${account.color}18;color:${account.color}">${account.type === "cash" ? "▤" : "▣"}</span>
      <span class="account-mini-copy"><strong>${escapeHTML(account.name)}</strong><small>${account.type === "cash" ? "Cash wallet" : "Bank card"}</small></span>
      <span class="account-mini-balance">${money(accountBalance(account.id))}</span>
    </div>`).join("") : `<div class="empty-state">No active accounts yet. Add your first account.</div>`;

  const expensesByCategory = {};
  currentMonthTransactions().filter(tx => tx.type === "expense").forEach(tx => {
    expensesByCategory[tx.category || "Other"] = (expensesByCategory[tx.category || "Other"] || 0) + Number(tx.amount || 0);
  });

  const categories = Object.entries(expensesByCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = Math.max(...categories.map(c => c[1]), 1);

  $("#spending-breakdown").innerHTML = categories.length ? categories.map(([name, amount]) => `
    <div class="spend-row">
      <span class="spend-label">${escapeHTML(name)}</span>
      <div class="spend-track"><div class="spend-fill" style="width:${Math.max(3, amount / max * 100)}%"></div></div>
      <span class="spend-amount">${shortMoney(amount)}</span>
    </div>`).join("") : `<div class="empty-state compact">No expenses recorded this month.</div>`;

  const recent = sortedTransactions().slice(0, 5);
  $("#recent-transactions").innerHTML = recent.length ? recent.map(tx => recentTransactionHTML(tx)).join("") : `<div class="empty-state">Your transactions will appear here.</div>`;
  renderOverviewBudgets();
}

function recentTransactionHTML(tx) {
  const isIncome = tx.type === "income";
  const isTransfer = tx.type === "transfer";
  const symbol = isTransfer ? "⇄" : isIncome ? "↗" : (CATEGORY_ICONS[tx.category] || "↘");
  const amountLabel = `${isIncome ? "+" : isTransfer ? "↔ " : "−"}${money(tx.amount)}`;

  return `<div class="recent-item">
    <span class="tx-symbol ${tx.type}">${symbol}</span>
    <span class="recent-copy">
      <strong>${escapeHTML(txTitle(tx))}</strong>
      <small>${escapeHTML(isTransfer ? txAccountLabel(tx) : `${tx.category || (isIncome ? "Income" : "Expense")} · ${txAccountLabel(tx)}`)} · ${formatDate(tx.date)}</small>
    </span>
    <span class="recent-amount ${isIncome ? "income" : ""}">${amountLabel}</span>
  </div>`;
}
function renderOverviewBudgets() {
  const month = currentMonth();
  const budgets = state.budgets.filter(b => b.month === month).slice(0, 3);
  const container = $("#overview-budgets");

  if (!budgets.length) {
    container.innerHTML = `<div class="empty-state">No budgets yet. Create one to start tracking a category.</div>`;
    return;
  }

  container.innerHTML = budgets.map(b => {
    const spent = currentMonthTransactions().filter(t => t.type === "expense" && t.category === b.category).reduce((s, t) => s + Number(t.amount || 0), 0);
    const pct = b.amount > 0 ? spent / b.amount * 100 : 0;
    return `<div class="budget-preview-item"><div class="budget-preview-top"><span>${escapeHTML(b.category)}</span><strong>${money(spent)} / ${money(b.amount)}</strong></div><div class="progress-track"><div class="progress-fill ${pct > 100 ? "over" : ""}" style="width:${Math.min(100, pct)}%"></div></div><small>${pct > 100 ? `${money(spent - b.amount)} over budget` : `${money(b.amount - spent)} remaining`}</small></div>`;
  }).join("");
}

function renderTransactions() {
  const search = ($("#transaction-search")?.value || "").toLowerCase().trim();
  const type = $("#transaction-type-filter")?.value || "all";
  const month = $("#transaction-month-filter")?.value || "all";
  const day = $("#transaction-day-filter")?.value || "";

  let txs = sortedTransactions().filter(tx => {
    const matchesType = type === "all" || tx.type === type;
    const matchesMonth = month === "all" || (tx.date || "").startsWith(month);
    const matchesDay = !day || tx.date === day;
    const text = `${txTitle(tx)} ${tx.category || ""} ${txAccountLabel(tx)} ${tx.note || ""}`.toLowerCase();
    return matchesType && matchesMonth && matchesDay && (!search || text.includes(search));
  });

  const sortValue = tx => {
    if (transactionSort.key === "description") return txTitle(tx).toLowerCase();
    if (transactionSort.key === "type") return tx.type || "";
    if (transactionSort.key === "account") return txAccountLabel(tx).toLowerCase();
    if (transactionSort.key === "amount") return Number(tx.amount || 0);
    return tx.date || "";
  };

  txs.sort((a, b) => {
    const av = sortValue(a), bv = sortValue(b);
    const result = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
    return result * (transactionSort.direction === "asc" ? 1 : -1);
  });

  const container = $("#transactions-list");

  if (!txs.length) {
    container.innerHTML = `<div class="empty-state">No transactions match these filters.</div>`;
    return;
  }

  const sortHeader = (key, label) => `<th><button type="button" class="sort-header ${transactionSort.key === key ? "sorted" : ""}" data-sort-tx="${key}">${label}<span>${transactionSort.key === key ? (transactionSort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>`;

  container.innerHTML = `<table class="data-table"><thead><tr>${sortHeader("description", "DESCRIPTION")}${sortHeader("type", "TYPE")}${sortHeader("account", "ACCOUNT")}${sortHeader("date", "DATE")}${sortHeader("amount", "AMOUNT")}<th></th></tr></thead><tbody>${txs.map(tx => {
    const label = tx.type === "income" ? "Income" : tx.type === "expense" ? "Expense" : "Transfer";
    const amountClass = tx.type === "income" ? "positive" : "";
    const prefix = tx.type === "income" ? "+" : tx.type === "expense" ? "−" : "";

    return `<tr>
      <td>${escapeHTML(txTitle(tx))}${tx.category ? `<div style="font-size:9px;color:#a0aaba;font-weight:400;margin-top:3px"><span style="margin-right:4px">${CATEGORY_ICONS[tx.category] || "↘"}</span>${escapeHTML(tx.category)}</div>` : ""}</td>
      <td><span class="type-pill ${tx.type}">${label}</span></td>
      <td>${escapeHTML(txAccountLabel(tx))}</td>
      <td>${formatDate(tx.date)}</td>
      <td class="table-amount ${amountClass}">${prefix}${money(tx.amount)}</td>
      <td><div class="row-actions"><button data-edit-tx="${escapeHTML(tx.id)}" aria-label="Edit transaction">Edit</button><button data-delete-tx="${escapeHTML(tx.id)}" aria-label="Delete transaction">×</button></div></td>
    </tr>`;
  }).join("")}</tbody></table>`;
}

function populateMonthFilter() {
  const select = $("#transaction-month-filter");
  if (!select) return;

  const selected = select.value || "all";
  const options = [`<option value="all">All dates</option>`];

  for (let i = 0; i < 15; i++) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    options.push(`<option value="${value}">${d.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</option>`);
  }

  select.innerHTML = options.join("");
  select.value = options.some(x => x.includes(`value="${selected}"`)) ? selected : "all";
}

function renderAccounts() {
  const active = activeAccounts();

  $("#accounts-grid").innerHTML = active.length ? active.map(account => `
    <article class="account-card">
      <div class="account-card-top">
        <span class="account-symbol" style="background:${account.color}18;color:${account.color}">${account.type === "cash" ? "▤" : "▣"}</span>
        <button class="account-menu" data-edit-account="${escapeHTML(account.id)}" aria-label="Edit account">···</button>
      </div>
      <h3>${escapeHTML(account.name)}</h3>
      <div class="account-type">${account.type === "cash" ? "CASH WALLET" : "BANK CARD"} · OPENING ${money(account.openingBalance)}</div>
      <div class="account-balance">${money(accountBalance(account.id))}</div>
      <div class="account-card-actions">
        <button data-edit-account="${escapeHTML(account.id)}">Edit details</button>
        <button data-archive-account="${escapeHTML(account.id)}">Archive</button>
        <button data-delete-account="${escapeHTML(account.id)}">Delete</button>
      </div>
    </article>`).join("") : `<div class="panel empty-state" style="grid-column:1/-1">No active accounts. Add a cash wallet or bank card to get started.</div>`;

  const archived = state.accounts.filter(a => a.archived);
  $("#archived-panel").style.display = archived.length ? "block" : "none";
  $("#archived-accounts").innerHTML = archived.map(account => `
    <div class="archived-chip">
      <span class="account-symbol" style="width:27px;height:27px;border-radius:8px;background:${account.color}18;color:${account.color};font-size:12px">${account.type === "cash" ? "▤" : "▣"}</span>
      <span><strong>${escapeHTML(account.name)}</strong><br><small>${money(accountBalance(account.id))}</small></span>
      <button data-restore-account="${escapeHTML(account.id)}">Restore</button>
      <button data-delete-account="${escapeHTML(account.id)}">Delete</button>
    </div>`).join("");
}

function renderBudgets() {
  const month = currentMonth();
  const budgets = state.budgets.filter(b => b.month === month);
  const spent = budgets.reduce((sum, b) => sum + currentMonthTransactions().filter(t => t.type === "expense" && t.category === b.category).reduce((s, t) => s + Number(t.amount || 0), 0), 0);
  const total = budgets.reduce((s, b) => s + Number(b.amount || 0), 0);

  $("#budget-total").textContent = money(total);
  $("#budget-spent").textContent = money(spent);
  $("#budget-remaining").textContent = money(total - spent);

  $("#budgets-grid").innerHTML = budgets.length ? budgets.map(b => {
    const amountSpent = currentMonthTransactions().filter(t => t.type === "expense" && t.category === b.category).reduce((s, t) => s + Number(t.amount || 0), 0);
    const pct = b.amount > 0 ? amountSpent / b.amount * 100 : 0;

    return `<article class="budget-card">
      <div class="budget-card-top"><strong>${escapeHTML(b.category)}</strong><button data-delete-budget="${escapeHTML(b.id)}" aria-label="Delete budget">×</button></div>
      <div class="budget-card-amount">${money(b.amount)}</div>
      <div class="budget-card-sub">Monthly limit · ${new Date(`${b.month}-02T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
      <div class="progress-track"><div class="progress-fill ${pct > 100 ? "over" : ""}" style="width:${Math.min(100, pct)}%"></div></div>
      <div class="budget-card-foot"><span>${money(amountSpent)} spent</span><strong>${pct.toFixed(0)}%</strong><span>${pct > 100 ? `${money(amountSpent - b.amount)} over` : `${money(b.amount - amountSpent)} left`}</span></div>
    </article>`;
  }).join("") : `<div class="panel empty-state" style="grid-column:1/-1">No budgets for this month. Create a budget to set a spending limit.</div>`;
}

function renderReports() {
  const months = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const monthValues = months.map(m => {
    const txs = state.transactions.filter(t => (t.date || "").startsWith(m));
    return {
      month: m,
      income: txs.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount || 0), 0),
      expense: txs.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount || 0), 0)
    };
  });

  const max = Math.max(1, ...monthValues.flatMap(m => [m.income, m.expense]));

  $("#cashflow-chart").innerHTML = `<div class="chart-months">${monthValues.map(m => `
    <div class="chart-month">
      <div class="chart-bars">
        <div class="chart-bar income" title="Income: ${money(m.income)}" style="height:${Math.max(m.income ? 3 : 0, m.income / max * 100)}%"></div>
        <div class="chart-bar expense" title="Expenses: ${money(m.expense)}" style="height:${Math.max(m.expense ? 3 : 0, m.expense / max * 100)}%"></div>
      </div>
      <small>${new Date(`${m.month}-02T12:00:00`).toLocaleDateString("en-GB", { month: "short" })}</small>
    </div>`).join("")}</div><div class="chart-legend"><span><i class="legend-dot income"></i>Income</span><span><i class="legend-dot expense"></i>Expenses</span></div>`;

  const byCategory = {};
  currentMonthTransactions().filter(t => t.type === "expense").forEach(t => {
    byCategory[t.category || "Other"] = (byCategory[t.category || "Other"] || 0) + Number(t.amount || 0);
  });

  const ranked = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 6);

  $("#report-categories").innerHTML = ranked.length ? ranked.map(([name, amount]) => `
    <div class="report-category">
      <span class="report-category-icon">${CATEGORY_ICONS[name] || "•"}</span>
      <span class="report-category-copy"><strong>${escapeHTML(name)}</strong><small>${currentMonthTransactions().filter(t => t.type === "expense" && t.category === name).length} transactions</small></span>
      <span class="report-category-amount">${money(amount)}</span>
    </div>`).join("") : `<div class="empty-state">Add expenses to see your spending breakdown.</div>`;

  const totals = monthTotals();
  const activeCount = activeAccounts().length;

  const insights = [
    { icon: "◈", title: "Your account setup", text: `You currently have ${activeCount} active ${activeCount === 1 ? "account" : "accounts"}. Keep cash and card balances up to date.` },
    { icon: "↗", title: "Savings this month", text: totals.income > 0 ? `You have kept ${Math.max(0, Math.round(totals.savings / totals.income * 100))}% of recorded income after expenses.` : "Add your salary or other income to see your savings rate." },
    { icon: "◎", title: "Track consistently", text: state.transactions.length ? `You have recorded ${state.transactions.length} transactions. Regular entries make reports more useful.` : "Record purchases as they happen for a more accurate picture." }
  ];

  $("#insights-list").innerHTML = insights.map(i => `<article class="insight"><span class="insight-icon">${i.icon}</span><strong>${i.title}</strong><p>${i.text}</p></article>`).join("");
}

function setPage(page) {
  currentPage = page;
  $$(".page").forEach(el => el.classList.toggle("active", el.id === `page-${page}`));
  $$(".nav-item, .mobile-nav-item").forEach(el => el.classList.toggle("active", el.dataset.page === page));

  const labels = {
    overview: ["YOUR FINANCES, AT A GLANCE", "Overview"],
    transactions: ["YOUR MONEY MOVEMENTS", "Transactions"],
    accounts: ["YOUR CASH & BANK CARDS", "Accounts"],
    budgets: ["PLAN YOUR SPENDING", "Budgets"],
    reports: ["UNDERSTAND YOUR HABITS", "Reports"]
  };

  $("#page-eyebrow").textContent = labels[page][0];
  $("#page-title").textContent = labels[page][1];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function toast(message, type = "success") {
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.textContent = message;
  $("#toast-region").append(el);
  setTimeout(() => el.remove(), 3200);
}

function openModal(title, content, eyebrow = "LEDGERLY") {
  $("#modal-title").textContent = title;
  $("#modal-eyebrow").textContent = eyebrow;
  $("#modal-content").innerHTML = content;
  $("#modal-backdrop").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal() {
  $("#modal-backdrop").hidden = true;
  document.body.style.overflow = "";
}
function transactionFormMarkup(tx, type) {
  const accounts = [...activeAccounts()];
  const referencedIds = [tx?.accountId, tx?.fromAccountId, tx?.toAccountId].filter(Boolean);

  referencedIds.forEach(id => {
    const account = accountById(id);
    if (account && !accounts.some(a => a.id === id)) accounts.push(account);
  });

  const amount = tx?.amount ?? "";
  const date = tx?.date || localDateISO();
  const note = tx?.note || "";
  const category = tx?.category || (type === "income" ? "Salary" : "Food & Dining");
  const accountId = tx?.accountId || accounts[0]?.id || "";
  const fromId = tx?.fromAccountId || accounts[0]?.id || "";
  const toId = tx?.toAccountId || accounts.find(a => a.id !== fromId)?.id || "";

  const categoryOptions = (type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map(c => `<option ${category === c ? "selected" : ""}>${c}</option>`).join("");
  const accountOptions = accounts.map(a => `<option value="${escapeHTML(a.id)}" ${accountId === a.id ? "selected" : ""}>${escapeHTML(a.name)} · ${a.type === "cash" ? "Cash" : "Card"}</option>`).join("");
  const fromOptions = accounts.map(a => `<option value="${escapeHTML(a.id)}" ${fromId === a.id ? "selected" : ""}>${escapeHTML(a.name)}</option>`).join("");
  const toOptions = accounts.filter(a => a.id !== fromId).map(a => `<option value="${escapeHTML(a.id)}" ${toId === a.id ? "selected" : ""}>${escapeHTML(a.name)}</option>`).join("");

  return `<form id="transaction-form" data-edit-id="${escapeHTML(tx?.id || "")}">
    <div class="segmented" id="transaction-type-tabs">
      <button type="button" data-tx-type="expense" class="${type === "expense" ? "active" : ""}">Expense</button>
      <button type="button" data-tx-type="income" class="${type === "income" ? "active" : ""}">Income</button>
      <button type="button" data-tx-type="transfer" class="${type === "transfer" ? "active" : ""}">Transfer</button>
    </div>
    <div class="form-grid" style="margin-top:15px">
      <div class="field full"><label>Amount · EGP</label><input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" value="${escapeHTML(amount)}" required /></div>
      ${type === "transfer"
        ? `<div class="field"><label>From account</label><select name="fromAccountId" required>${fromOptions}</select></div><div class="field"><label>To account</label><select name="toAccountId" required>${toOptions}</select></div>`
        : `<div class="field"><label>${type === "income" ? "Income source" : "Category"}</label><select name="category">${categoryOptions}</select></div><div class="field"><label>Account</label><select name="accountId" required>${accountOptions}</select></div>`}
      <div class="field"><label>Date</label><input name="date" type="date" value="${escapeHTML(date)}" required /></div>
      <div class="field"><label>Note · Optional</label><input name="note" type="text" maxlength="90" placeholder="Add a short note" value="${escapeHTML(note)}" /></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="button button-ghost" data-close-modal>Cancel</button>
      <button type="submit" class="button button-primary">${tx ? "Save changes" : "Save transaction"}</button>
    </div>
  </form>`;
}

function openTransactionModal(tx = null, presetType = "expense") {
  if (!activeAccounts().length && !tx) {
    toast("Add an active account before recording a transaction.", "error");
    setPage("accounts");
    return;
  }

  currentTransactionType = tx?.type || presetType;
  openModal(tx ? "Edit transaction" : "Add transaction", transactionFormMarkup(tx, currentTransactionType), "MONEY MOVEMENT");

  const modalContent = $("#modal-content");

  modalContent.onclick = event => {
    const btn = event.target.closest("[data-tx-type]");
    if (!btn) return;

    const form = $("#transaction-form");
    const current = Object.fromEntries(new FormData(form).entries());
    const newType = btn.dataset.txType;

    const draft = {
      ...tx,
      amount: current.amount,
      date: current.date,
      note: current.note,
      category: current.category,
      accountId: current.accountId,
      fromAccountId: current.fromAccountId,
      toAccountId: current.toAccountId
    };

    currentTransactionType = newType;
    modalContent.innerHTML = transactionFormMarkup(draft, newType);
    bindTransactionForm(tx);
  };

  bindTransactionForm(tx);
}

function bindTransactionForm(originalTx) {
  const form = $("#transaction-form");
  if (!form) return;

  const fromSelect = $("[name=fromAccountId]", form);

  fromSelect?.addEventListener("change", () => {
    const to = $("[name=toAccountId]", form);
    const current = to.value;

    to.innerHTML = activeAccounts()
      .filter(a => a.id !== fromSelect.value)
      .map(a => `<option value="${escapeHTML(a.id)}">${escapeHTML(a.name)}</option>`)
      .join("");

    if ([...to.options].some(o => o.value === current)) to.value = current;
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const data = Object.fromEntries(new FormData(form).entries());
    const amount = Number(data.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      toast("Enter an amount greater than zero.", "error");
      return;
    }

    const type = currentTransactionType;

    if (type === "transfer" && (!data.fromAccountId || !data.toAccountId || data.fromAccountId === data.toAccountId)) {
      toast("Choose two different accounts for the transfer.", "error");
      return;
    }

    const payload = {
      type,
      amount,
      date: data.date,
      note: data.note.trim(),
      createdAt: originalTx?.createdAt || Date.now()
    };

    if (type === "transfer") {
      payload.fromAccountId = data.fromAccountId;
      payload.toAccountId = data.toAccountId;
    } else {
      payload.category = data.category;
      payload.accountId = data.accountId;
    }

    try {
      if (originalTx) await updateTransaction(originalTx.id, payload);
      else await createTransaction(payload);

      closeModal();
      toast(originalTx ? "Transaction updated." : "Transaction saved.");
    } catch (error) {
      console.error(error);
      toast("Could not save the transaction.", "error");
    }
  });
}

async function createTransaction(payload) {
  const record = { ...payload, id: uid() };

  if (cloudEnabled) {
    await setDoc(doc(db, "vaults", vaultId, "transactions", record.id), record);
  } else {
    state.transactions.push(record);
    persistLocal();
    renderAll();
  }
}

async function updateTransaction(id, payload) {
  if (cloudEnabled) {
    await updateDoc(doc(db, "vaults", vaultId, "transactions", id), payload);
  } else {
    state.transactions = state.transactions.map(t => t.id === id ? { ...t, ...payload } : t);
    persistLocal();
    renderAll();
  }
}

async function removeTransaction(id) {
  if (!confirm("Delete this transaction? This cannot be undone.")) return;

  if (cloudEnabled) {
    await deleteDoc(doc(db, "vaults", vaultId, "transactions", id));
  } else {
    state.transactions = state.transactions.filter(t => t.id !== id);
    persistLocal();
    renderAll();
  }

  toast("Transaction deleted.");
}

function accountFormMarkup(account = null) {
  const color = account?.color || PALETTE[0];

  return `<form id="account-form" data-edit-id="${escapeHTML(account?.id || "")}">
    <div class="form-grid">
      <div class="field full">
        <label>Account name</label>
        <input name="name" maxlength="35" placeholder="e.g. CIB, Cash, Savings" value="${escapeHTML(account?.name || "")}" required />
      </div>
      <div class="field">
        <label>Account type</label>
        <select name="type">
          <option value="cash" ${account?.type !== "card" ? "selected" : ""}>Cash wallet</option>
          <option value="card" ${account?.type === "card" ? "selected" : ""}>Bank card</option>
        </select>
      </div>
      <div class="field">
        <label>Opening balance · EGP</label>
        <input name="openingBalance" type="number" step="0.01" value="${escapeHTML(account?.openingBalance ?? 0)}" required />
        <span class="field-hint">The balance in this account before you start tracking transactions.</span>
      </div>
      <div class="field full">
        <label>Account colour</label>
        <div class="color-options">${PALETTE.map(c => `<button type="button" class="color-choice ${c === color ? "selected" : ""}" data-color="${c}" style="background:${c}" aria-label="Choose colour ${c}"></button>`).join("")}</div>
        <input type="hidden" name="color" value="${color}" />
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="button button-ghost" data-close-modal>Cancel</button>
      <button type="submit" class="button button-primary">${account ? "Save account" : "Add account"}</button>
    </div>
  </form>`;
}

function openAccountModal(account = null) {
  openModal(account ? "Edit account" : "Add account", accountFormMarkup(account), "ACCOUNT MANAGEMENT");

  $$("[data-color]").forEach(btn => btn.addEventListener("click", () => {
    $$("[data-color]").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    $("[name=color]").value = btn.dataset.color;
  }));

  $("#account-form").addEventListener("submit", async event => {
    event.preventDefault();

    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const openingBalance = Number(data.openingBalance);

    if (!data.name.trim() || !Number.isFinite(openingBalance)) {
      toast("Enter a valid account name and opening balance.", "error");
      return;
    }

    const id = account?.id || uid();
    const record = {
      id,
      name: data.name.trim(),
      type: data.type,
      openingBalance,
      color: data.color,
      archived: account?.archived || false,
      createdAt: account?.createdAt || Date.now()
    };

    try {
      await saveAccount(record);
      closeModal();
      toast(account ? "Account updated." : "Account added.");
    } catch (error) {
      console.error(error);
      toast("Could not save this account.", "error");
    }
  });
}

async function saveAccount(account) {
  if (cloudEnabled) {
    await setDoc(doc(db, "vaults", vaultId, "accounts", account.id), account, { merge: true });
  } else {
    const index = state.accounts.findIndex(a => a.id === account.id);
    if (index >= 0) state.accounts[index] = account;
    else state.accounts.push(account);
    persistLocal();
    renderAll();
  }
}

async function archiveAccount(id, archived = true) {
  const account = accountById(id);
  if (!account) return;

  await saveAccount({ ...account, archived });
  toast(archived ? "Account archived. Its history is preserved." : "Account restored.");
}

function openDeleteAccountModal(id) {
  const account = accountById(id);
  if (!account) return;

  const related = state.transactions.filter(t => t.accountId === id || t.fromAccountId === id || t.toAccountId === id);

  openModal("Delete account?", `
    <p class="confirm-copy">You are about to delete <strong>${escapeHTML(account.name)}</strong>. ${related.length ? `It has ${related.length} linked transaction${related.length === 1 ? "" : "s"}.` : "It has no linked transactions."}</p>
    ${related.length
      ? `<div class="confirm-box">Deleting this account will also permanently delete its linked transactions. If you want to keep the history, archive the account instead.</div>`
      : `<div class="confirm-box">This action cannot be undone.</div>`}
    <div class="modal-actions">
      <button class="button button-ghost" data-close-modal>Cancel</button>
      <button class="button button-soft" id="archive-from-delete">Archive instead</button>
      <button class="danger-button" id="confirm-delete-account">Delete${related.length ? " account & history" : " account"}</button>
    </div>`, "ACCOUNT MANAGEMENT");

  $("#archive-from-delete").addEventListener("click", async () => {
    await archiveAccount(id, true);
    closeModal();
  });

  $("#confirm-delete-account").addEventListener("click", async () => {
    try {
      if (cloudEnabled) {
        for (let i = 0; i < related.length; i += 450) {
          const batch = writeBatch(db);
          related.slice(i, i + 450).forEach(tx => batch.delete(doc(db, "vaults", vaultId, "transactions", tx.id)));
          await batch.commit();
        }
        await deleteDoc(doc(db, "vaults", vaultId, "accounts", id));
      } else {
        state.transactions = state.transactions.filter(t => !related.some(r => r.id === t.id));
        state.accounts = state.accounts.filter(a => a.id !== id);
        persistLocal();
        renderAll();
      }

      closeModal();
      toast("Account deleted.");
    } catch (error) {
      console.error(error);
      toast("Could not delete this account.", "error");
    }
  });
}

function budgetFormMarkup() {
  const categories = [...new Set([...EXPENSE_CATEGORIES, ...state.transactions.filter(t => t.type === "expense").map(t => t.category).filter(Boolean)])];

  return `<form id="budget-form">
    <div class="form-grid">
      <div class="field full">
        <label>Spending category</label>
        <select name="category">${categories.map(c => `<option>${escapeHTML(c)}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>Monthly limit · EGP</label>
        <input name="amount" type="number" min="1" step="0.01" placeholder="e.g. 3000" required />
      </div>
      <div class="field">
        <label>Month</label>
        <input name="month" type="month" value="${currentMonth()}" required />
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="button button-ghost" data-close-modal>Cancel</button>
      <button type="submit" class="button button-primary">Save budget</button>
    </div>
  </form>`;
}

function openBudgetModal() {
  openModal("Create a budget", budgetFormMarkup(), "MONTHLY PLANNING");

  $("#budget-form").addEventListener("submit", async event => {
    event.preventDefault();

    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const amount = Number(data.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      toast("Enter a budget greater than zero.", "error");
      return;
    }

    const record = { id: uid(), category: data.category, amount, month: data.month, createdAt: Date.now() };

    try {
      if (cloudEnabled) {
        await setDoc(doc(db, "vaults", vaultId, "budgets", record.id), record);
      } else {
        state.budgets.push(record);
        persistLocal();
        renderAll();
      }

      closeModal();
      toast("Budget created.");
    } catch (error) {
      console.error(error);
      toast("Could not save this budget.", "error");
    }
  });
}

async function deleteBudget(id) {
  if (!confirm("Delete this budget?")) return;

  if (cloudEnabled) {
    await deleteDoc(doc(db, "vaults", vaultId, "budgets", id));
  } else {
    state.budgets = state.budgets.filter(b => b.id !== id);
    persistLocal();
    renderAll();
  }

  toast("Budget deleted.");
}

function openVaultSettings() {
  const cloudStatus = cloudEnabled
    ? `<span class="type-pill income">Firebase connected</span>`
    : `<span class="type-pill transfer">Local mode · Firebase not configured</span>`;

  openModal("Sync & backup", `
    <div style="display:grid;gap:13px">
      <div>${cloudStatus}</div>
      <p class="setting-note">No sign-in screen is used. This app uses a private Vault ID to locate your data in Firestore. Copy this key to another device to open the same finance data there.</p>
      <div class="vault-key" id="vault-key-value">${vaultId}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="button button-soft" id="copy-vault-key">Copy Vault ID</button>
        <button class="button button-ghost" id="download-backup">Download JSON backup</button>
      </div>
      <div class="field">
        <label>Use an existing Vault ID on this device</label>
        <input type="text" id="existing-vault-id" placeholder="Paste the Vault ID from your other device" autocomplete="off" />
        <button type="button" class="button button-soft" id="connect-vault-id">Connect this device to that Vault</button>
        <span class="field-hint">This replaces the current Vault ID on this device. It does not delete the other Vault.</span>
      </div>
      <div class="field">
        <label>Restore from JSON backup</label>
        <input type="file" id="restore-file" accept="application/json,.json" />
        <span class="field-hint">Restoring replaces the current data in this Vault. Make a backup first.</span>
      </div>
      <div class="confirm-box">Security note: because there is no authentication, anyone who obtains this Vault ID can access and change its data. Keep it private and do not publish it in your GitHub repository.</div>
      ${!cloudEnabled ? `<p class="setting-note">To enable Firebase: open <strong>firebase-config.js</strong>, paste your Firebase Web App configuration, create a Firestore database, then publish the included <strong>firestore.rules</strong>. The app will automatically use Firebase on the next reload.</p>` : ""}
    </div>
    <div class="modal-actions"><button type="button" class="button button-primary" data-close-modal>Done</button></div>`, "YOUR PRIVATE DATA");

  $("#copy-vault-key").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(vaultId);
      toast("Vault ID copied.");
    } catch {
      toast("Could not copy. Select the key and copy it manually.", "error");
    }
  });

  $("#download-backup").addEventListener("click", exportBackup);

  $("#connect-vault-id").addEventListener("click", async () => {
    const nextId = $("#existing-vault-id").value.trim();

    if (!/^[a-f0-9]{40,80}$/i.test(nextId)) {
      toast("Enter a valid Vault ID.", "error");
      return;
    }

    if (!cloudEnabled) {
      toast("Configure Firebase first, then connect this Vault ID.", "error");
      return;
    }

    if (!confirm("Switch this device to the entered Vault ID? The current Vault remains in Firebase.")) return;

    unsubscribe.forEach(stop => stop());
    unsubscribe = [];
    vaultId = nextId;
    localStorage.setItem(VAULT_STORAGE_KEY, vaultId);
    state = { accounts: [], transactions: [], budgets: [] };
    closeModal();

    await initialiseData();
    toast("This device is now connected to the selected Vault.");
  });

  $("#restore-file").addEventListener("change", restoreBackup);
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportBackup() {
  const payload = {
    app: "Ledgerly",
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts: state.accounts,
    transactions: state.transactions,
    budgets: state.budgets
  };

  downloadBlob(JSON.stringify(payload, null, 2), `ledgerly-backup-${localDateISO()}.json`, "application/json");
  toast("Backup downloaded.");
}

async function restoreBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());

    if (!Array.isArray(payload.accounts) || !Array.isArray(payload.transactions) || !Array.isArray(payload.budgets)) {
      throw new Error("Invalid backup format");
    }

    if (!confirm("Replace the current Vault data with this backup? This cannot be undone.")) return;

    if (cloudEnabled) {
      const collections = ["accounts", "transactions", "budgets"];

      for (const name of collections) {
        const ref = collection(db, "vaults", vaultId, name);
        const snap = await getDocs(ref);
        let batch = writeBatch(db);
        let count = 0;

        for (const item of snap.docs) {
          batch.delete(item.ref);
          count++;
          if (count === 450) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }

        if (count) await batch.commit();
      }

      for (const [name, records] of [["accounts", payload.accounts], ["transactions", payload.transactions], ["budgets", payload.budgets]]) {
        let batch = writeBatch(db);
        let count = 0;

        for (const record of records) {
          batch.set(doc(db, "vaults", vaultId, name, record.id), record);
          count++;
          if (count === 450) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }

        if (count) await batch.commit();
      }
    } else {
      state.accounts = payload.accounts;
      state.transactions = payload.transactions;
      state.budgets = payload.budgets;
      persistLocal();
      renderAll();
    }

    closeModal();
    toast("Backup restored successfully.");
  } catch (error) {
    console.error(error);
    toast("Could not restore this backup. Check the JSON file.", "error");
  }
}

function exportCSV() {
  const rows = [["Date", "Type", "Description", "Category", "Account", "Amount EGP"]];

  sortedTransactions().forEach(tx => rows.push([
    tx.date || "",
    tx.type,
    txTitle(tx),
    tx.category || "",
    txAccountLabel(tx),
    tx.amount
  ]));

  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

  downloadBlob("\ufeff" + csv, `ledgerly-transactions-${localDateISO()}.csv`, "text/csv;charset=utf-8");
  toast("CSV report exported.");
}

function bindEvents() {
  $$("[data-page]").forEach(btn => btn.addEventListener("click", () => setPage(btn.dataset.page)));
  $$("[data-go]").forEach(btn => btn.addEventListener("click", () => setPage(btn.dataset.go)));

  $("#quick-add-btn").addEventListener("click", () => openTransactionModal());
  $("#transactions-add-btn").addEventListener("click", () => openTransactionModal());
  $("#overview-add-income").addEventListener("click", () => openTransactionModal(null, "income"));
  $("#accounts-add-btn").addEventListener("click", () => openAccountModal());
  $("#overview-add-account").addEventListener("click", () => openAccountModal());
  $("#budgets-add-btn").addEventListener("click", openBudgetModal);

  $("#vault-settings-btn").addEventListener("click", openVaultSettings);
  $("#settings-btn").addEventListener("click", openVaultSettings);
  $("#mobile-settings-btn").addEventListener("click", openVaultSettings);
  $("#footer-vault-btn").addEventListener("click", openVaultSettings);

  $("#export-csv-btn").addEventListener("click", exportCSV);
  $("#backup-btn").addEventListener("click", exportBackup);

  $("#transaction-search").addEventListener("input", renderTransactions);
  $("#transaction-type-filter").addEventListener("change", renderTransactions);
  $("#transaction-month-filter").addEventListener("change", renderTransactions);
  $("#transaction-day-filter").addEventListener("change", renderTransactions);

  $("#transactions-list").addEventListener("click", event => {
    const header = event.target.closest("[data-sort-tx]");
    if (!header) return;

    const key = header.dataset.sortTx;

    transactionSort = {
      key,
      direction: transactionSort.key === key && transactionSort.direction === "asc" ? "desc" : "asc"
    };

    renderTransactions();
  });

  $("#modal-close").addEventListener("click", closeModal);

  $("#modal-backdrop").addEventListener("click", event => {
    if (event.target.id === "modal-backdrop") closeModal();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !$("#modal-backdrop").hidden) closeModal();
  });

  $("#modal-content").addEventListener("click", event => {
    if (event.target.closest("[data-close-modal]")) closeModal();

    const editTx = event.target.closest("[data-edit-tx]")?.dataset.editTx;
    const deleteTx = event.target.closest("[data-delete-tx]")?.dataset.deleteTx;
    const editAccount = event.target.closest("[data-edit-account]")?.dataset.editAccount;
    const archiveAccountId = event.target.closest("[data-archive-account]")?.dataset.archiveAccount;
    const deleteAccountId = event.target.closest("[data-delete-account]")?.dataset.deleteAccount;
    const restoreAccountId = event.target.closest("[data-restore-account]")?.dataset.restoreAccount;
    const deleteBudgetId = event.target.closest("[data-delete-budget]")?.dataset.deleteBudget;

    if (editTx) openTransactionModal(state.transactions.find(t => t.id === editTx));
    if (deleteTx) removeTransaction(deleteTx);
    if (editAccount) openAccountModal(accountById(editAccount));
    if (archiveAccountId) archiveAccount(archiveAccountId, true);
    if (deleteAccountId) openDeleteAccountModal(deleteAccountId);
    if (restoreAccountId) archiveAccount(restoreAccountId, false);
    if (deleteBudgetId) deleteBudget(deleteBudgetId);
  });

  document.addEventListener("click", event => {
    const editTx = event.target.closest("[data-edit-tx]")?.dataset.editTx;
    const deleteTx = event.target.closest("[data-delete-tx]")?.dataset.deleteTx;
    const editAccount = event.target.closest("[data-edit-account]")?.dataset.editAccount;
    const archiveAccountId = event.target.closest("[data-archive-account]")?.dataset.archiveAccount;
    const deleteAccountId = event.target.closest("[data-delete-account]")?.dataset.deleteAccount;
    const restoreAccountId = event.target.closest("[data-restore-account]")?.dataset.restoreAccount;
    const deleteBudgetId = event.target.closest("[data-delete-budget]")?.dataset.deleteBudget;

    if (editTx) openTransactionModal(state.transactions.find(t => t.id === editTx));
    else if (deleteTx) removeTransaction(deleteTx);
    else if (editAccount) openAccountModal(accountById(editAccount));
    else if (archiveAccountId) archiveAccount(archiveAccountId, true);
    else if (deleteAccountId) openDeleteAccountModal(deleteAccountId);
    else if (restoreAccountId) archiveAccount(restoreAccountId, false);
    else if (deleteBudgetId) deleteBudget(deleteBudgetId);
  });
}

function updateTodayLabel() {
  $("#today-label").textContent = new Date().toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

bindEvents();
populateMonthFilter();
updateTodayLabel();
initialiseData();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(error => console.warn("Service worker registration failed", error)));
}
