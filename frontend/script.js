const API_BASE =
  (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl)
    ? window.APP_CONFIG.apiBaseUrl
    : "https://mailapi.pakasir.dev/api";

const DEFAULT_DOMAIN = "pakasir.dev";

const currentEmailInput = document.getElementById("currentEmail");
const customNameInput = document.getElementById("customNameInput");
const domainSelect = document.getElementById("domainSelect");

const generateBtn = document.getElementById("generateBtn");
const createCustomBtn = document.getElementById("createCustomBtn");
const checkEmailsBtn = document.getElementById("checkEmailsBtn");
const copyBtn = document.getElementById("copyBtn");
const refreshBtn = document.getElementById("refreshBtn");
const refreshEmailsBtn = document.getElementById("refreshEmailsBtn");
const autoRefreshBtn = document.getElementById("autoRefreshBtn");

const emailInfo = document.getElementById("emailInfo");
const expirationTime = document.getElementById("expirationTime");
const emailCount = document.getElementById("emailCount");

const emailListSection = document.getElementById("emailListSection");
const currentEmailAddress = document.getElementById("currentEmailAddress");
const emailStats = document.getElementById("emailStats");
const totalEmails = document.getElementById("totalEmails");
const unreadEmails = document.getElementById("unreadEmails");

const loadingEmails = document.getElementById("loadingEmails");
const noEmails = document.getElementById("noEmails");
const emailsList = document.getElementById("emailsList");

let activeEmail = "";
let autoRefreshTimer = null;
let autoRefreshEnabled = true;

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeEmailInput(value, selectedDomain = DEFAULT_DOMAIN) {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.includes("@")) return raw;
  return `${raw}@${selectedDomain}`;
}

function isValidTempAddress(email) {
  return /^[a-z0-9._%+-]+@pakasir\.dev$/i.test(email);
}

function getEmailFromPath() {
  const path = decodeURIComponent(window.location.pathname.replace(/^\/+/, "").trim());
  if (!path) return "";
  return isValidTempAddress(path) ? path.toLowerCase() : "";
}

function updateUrlForInbox(email) {
  const encoded = encodeURIComponent(email);
  window.history.replaceState({}, "", `${window.location.origin}/${encoded}`);
}

function setButtonState(disabled) {
  [
    generateBtn,
    createCustomBtn,
    checkEmailsBtn,
    refreshBtn,
    refreshEmailsBtn
  ].forEach((btn) => {
    if (btn) btn.disabled = disabled;
  });
}

function showLoading(show) {
  loadingEmails.style.display = show ? "block" : "none";
}

function showNoEmails(show) {
  noEmails.style.display = show ? "block" : "none";
}

function formatDate(dateString) {
  try {
    return new Date(dateString).toLocaleString();
  } catch {
    return dateString || "-";
  }
}

function setExpiration() {
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
  expirationTime.textContent = formatDate(expiry.toISOString());
}

function setActiveEmail(email) {
  activeEmail = email;
  currentEmailInput.value = email;
  currentEmailAddress.textContent = email;
  emailInfo.style.display = "flex";
  emailListSection.style.display = "block";
  emailStats.style.display = "flex";
  updateUrlForInbox(email);
  setExpiration();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${text}`);
  }

  return await res.json();
}

async function generateRandomEmail() {
  const data = await fetchJson(`${API_BASE}/generate-email`);
  if (!data.email) throw new Error("API did not return email");
  return data.email;
}

function renderEmails(emails) {
  emailsList.innerHTML = "";

  const total = Array.isArray(emails) ? emails.length : 0;
  totalEmails.textContent = String(total);
  unreadEmails.textContent = String(total);
  emailCount.textContent = String(total);

  if (!total) {
    showNoEmails(true);
    return;
  }

  showNoEmails(false);

  emails.forEach((mail) => {
    const item = document.createElement("div");
    item.className = "email-item";

    const sender = escapeHtml(mail.sender || "Unknown sender");
    const subject = escapeHtml(mail.subject || "(No subject)");
    const body = escapeHtml(mail.body_text || "");
    const received = formatDate(mail.received_at || "");

    item.innerHTML = `
      <div class="email-item-header">
        <div class="email-item-main">
          <div class="email-item-from">${sender}</div>
          <div class="email-item-subject">${subject}</div>
        </div>
        <div class="email-item-date">${received}</div>
      </div>
      <div class="email-item-body">
        <pre>${body}</pre>
      </div>
    `;

    emailsList.appendChild(item);
  });
}

async function loadInbox(email) {
  if (!email || !isValidTempAddress(email)) {
    emailsList.innerHTML = "";
    showNoEmails(true);
    totalEmails.textContent = "0";
    unreadEmails.textContent = "0";
    emailCount.textContent = "0";
    return;
  }

  try {
    setButtonState(true);
    showLoading(true);
    showNoEmails(false);

    const data = await fetchJson(`${API_BASE}/inbox?email=${encodeURIComponent(email)}`);
    renderEmails(data.emails || []);
  } catch (err) {
    console.error("Failed to load inbox:", err);
    emailsList.innerHTML = `
      <div class="email-item">
        <div class="email-item-subject">Failed to load inbox</div>
        <div class="email-item-body">
          <pre>${escapeHtml(err.message || "Unknown error")}</pre>
        </div>
      </div>
    `;
    totalEmails.textContent = "0";
    unreadEmails.textContent = "0";
    emailCount.textContent = "0";
  } finally {
    showLoading(false);
    setButtonState(false);
  }
}

async function handleGenerateRandom() {
  try {
    setButtonState(true);
    const email = await generateRandomEmail();
    setActiveEmail(email);
    await loadInbox(email);
    startAutoRefresh();
  } catch (err) {
    console.error(err);
    alert("Failed to generate email.");
  } finally {
    setButtonState(false);
  }
}

async function handleCreateCustom() {
  const typed = customNameInput.value.trim();
  const domain = domainSelect.value || DEFAULT_DOMAIN;

  if (!typed) {
    alert("Masukkan nama email custom dulu.");
    return;
  }

  const email = normalizeEmailInput(typed, domain);

  if (!isValidTempAddress(email)) {
    alert("Format tidak valid. Contoh: john123 atau john123@pakasir.dev");
    return;
  }

  setActiveEmail(email);
  await loadInbox(email);
  startAutoRefresh();
}

async function handleCheckEmails() {
  const typedCurrent = currentEmailInput.value.trim();
  const typedCustom = customNameInput.value.trim();
  const domain = domainSelect.value || DEFAULT_DOMAIN;

  let email = "";

  if (typedCurrent) {
    email = normalizeEmailInput(typedCurrent, domain);
  } else if (typedCustom) {
    email = normalizeEmailInput(typedCustom, domain);
  } else if (activeEmail) {
    email = activeEmail;
  }

  if (!email || !isValidTempAddress(email)) {
    alert("Masukkan email yang valid.");
    return;
  }

  setActiveEmail(email);
  await loadInbox(email);
  startAutoRefresh();
}

async function handleCopy() {
  if (!activeEmail) {
    alert("Belum ada email aktif.");
    return;
  }

  try {
    await navigator.clipboard.writeText(activeEmail);
    alert("Email copied.");
  } catch (err) {
    console.error(err);
    alert("Gagal copy email.");
  }
}

function toggleAutoRefresh() {
  autoRefreshEnabled = !autoRefreshEnabled;

  if (autoRefreshEnabled) {
    startAutoRefresh();
    autoRefreshBtn.classList.add("active");
    autoRefreshBtn.title = "Auto Refresh ON (10s)";
  } else {
    stopAutoRefresh();
    autoRefreshBtn.classList.remove("active");
    autoRefreshBtn.title = "Auto Refresh OFF";
  }
}

function startAutoRefresh() {
  stopAutoRefresh();

  if (!autoRefreshEnabled) return;

  autoRefreshBtn.classList.add("active");
  autoRefreshTimer = setInterval(() => {
    if (activeEmail) loadInbox(activeEmail);
  }, 10000);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function bindEvents() {
  generateBtn.addEventListener("click", handleGenerateRandom);
  createCustomBtn.addEventListener("click", handleCreateCustom);
  checkEmailsBtn.addEventListener("click", handleCheckEmails);
  copyBtn.addEventListener("click", handleCopy);
  refreshBtn.addEventListener("click", handleGenerateRandom);
  refreshEmailsBtn.addEventListener("click", () => activeEmail && loadInbox(activeEmail));
  autoRefreshBtn.addEventListener("click", toggleAutoRefresh);

  customNameInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await handleCreateCustom();
    }
  });

  currentEmailInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await handleCheckEmails();
    }
  });
}

async function init() {
  bindEvents();

  const emailFromUrl = getEmailFromPath();

  if (emailFromUrl) {
    setActiveEmail(emailFromUrl);
    await loadInbox(emailFromUrl);
    startAutoRefresh();
    return;
  }

  autoRefreshBtn.classList.add("active");
  showNoEmails(true);
}

document.addEventListener("DOMContentLoaded", init);
