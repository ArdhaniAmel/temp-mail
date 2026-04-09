const API_BASE = "https://mailapi.pakasir.dev/api";
const DEFAULT_DOMAIN = "pakasir.dev";

const emailInput = document.getElementById("email");
const domainSelect = document.getElementById("domain");
const generateBtn = document.getElementById("generateBtn");
const checkBtn = document.getElementById("checkBtn");
const refreshBtn = document.getElementById("refreshBtn");
const copyBtn = document.getElementById("copyBtn");

const inboxTitle = document.getElementById("inboxTitle");
const inboxList = document.getElementById("inboxList");
const totalCount = document.getElementById("totalCount");
const unreadCount = document.getElementById("unreadCount");
const expiresAt = document.getElementById("expiresAt");
const emailCount = document.getElementById("emailCount");

let currentEmail = "";
let refreshInterval = null;

function escapeHtml(str = "") {
  return str
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

  if (isValidTempAddress(path)) {
    return path.toLowerCase();
  }

  return "";
}

function updateUrlForInbox(email) {
  const cleanEmail = encodeURIComponent(email);
  const newUrl = `${window.location.origin}/${cleanEmail}`;
  window.history.replaceState({}, "", newUrl);
}

function formatDate(dateString) {
  try {
    const d = new Date(dateString);
    return d.toLocaleString();
  } catch {
    return dateString || "-";
  }
}

function setLoadingState(isLoading) {
  generateBtn.disabled = isLoading;
  checkBtn.disabled = isLoading;

  if (refreshBtn) refreshBtn.disabled = isLoading;
}

function setActiveEmail(email) {
  currentEmail = email;
  emailInput.value = email;
  inboxTitle.textContent = `Inbox for ${email}`;
  updateUrlForInbox(email);

  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (expiresAt) expiresAt.textContent = formatDate(expires.toISOString());
}

function renderEmptyInbox() {
  inboxList.innerHTML = `
    <div class="empty-state">
      <p>No emails yet.</p>
    </div>
  `;
  totalCount.textContent = "0";
  unreadCount.textContent = "0";
  emailCount.textContent = "0";
}

function renderEmails(emails) {
  if (!Array.isArray(emails) || emails.length === 0) {
    renderEmptyInbox();
    return;
  }

  totalCount.textContent = String(emails.length);
  unreadCount.textContent = String(emails.length);
  emailCount.textContent = String(emails.length);

  inboxList.innerHTML = emails
    .map((mail) => {
      const from = escapeHtml(mail.sender || "Unknown sender");
      const subject = escapeHtml(mail.subject || "(No subject)");
      const bodyText = escapeHtml(mail.body_text || "");
      const receivedAt = formatDate(mail.received_at || "");

      return `
        <div class="email-card">
          <div class="email-header">
            <div>
              <div class="email-from">${from}</div>
              <div class="email-subject">${subject}</div>
            </div>
            <div class="email-date">${receivedAt}</div>
          </div>
          <div class="email-body">
            <pre>${bodyText}</pre>
          </div>
        </div>
      `;
    })
    .join("");
}

async function fetchJson(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${text}`);
  }

  return res.json();
}

async function loadInbox(email) {
  if (!email || !isValidTempAddress(email)) {
    renderEmptyInbox();
    return;
  }

  try {
    setLoadingState(true);

    const url = `${API_BASE}/inbox?email=${encodeURIComponent(email)}`;
    const data = await fetchJson(url);

    renderEmails(data.emails || []);
  } catch (err) {
    console.error("Failed to load inbox:", err);
    inboxList.innerHTML = `
      <div class="empty-state">
        <p>Failed to load inbox.</p>
        <p style="opacity:.7;font-size:14px;">${escapeHtml(err.message || "Unknown error")}</p>
      </div>
    `;
  } finally {
    setLoadingState(false);
  }
}

async function generateRandomEmail() {
  const data = await fetchJson(`${API_BASE}/generate-email`);
  if (!data.email) {
    throw new Error("Email not returned by API");
  }
  return data.email;
}

async function handleGenerateEmail() {
  try {
    setLoadingState(true);

    const domain = domainSelect?.value || DEFAULT_DOMAIN;
    const typed = emailInput.value.trim();

    let email = "";

    if (typed) {
      email = normalizeEmailInput(typed, domain);

      if (!isValidTempAddress(email)) {
        alert("Format email tidak valid. Contoh: nama123 atau nama123@pakasir.dev");
        return;
      }
    } else {
      email = await generateRandomEmail();
    }

    setActiveEmail(email);
    await loadInbox(email);
    startAutoRefresh();
  } catch (err) {
    console.error("Generate email failed:", err);
    alert("Failed to fetch. Cek API / Worker / CORS.");
  } finally {
    setLoadingState(false);
  }
}

async function handleCheckEmails() {
  const domain = domainSelect?.value || DEFAULT_DOMAIN;
  const typed = emailInput.value.trim();

  if (!typed) {
    alert("Masukkan nama email atau alamat email penuh.");
    return;
  }

  const email = normalizeEmailInput(typed, domain);

  if (!isValidTempAddress(email)) {
    alert("Email tidak valid. Gunakan domain @pakasir.dev");
    return;
  }

  setActiveEmail(email);
  await loadInbox(email);
  startAutoRefresh();
}

async function copyCurrentEmail() {
  if (!currentEmail) return;

  try {
    await navigator.clipboard.writeText(currentEmail);
    alert("Email copied!");
  } catch (err) {
    console.error("Copy failed:", err);
    alert("Gagal copy email.");
  }
}

function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);

  refreshInterval = setInterval(() => {
    if (currentEmail) {
      loadInbox(currentEmail);
    }
  }, 10000);
}

function bindEvents() {
  if (generateBtn) generateBtn.addEventListener("click", handleGenerateEmail);
  if (checkBtn) checkBtn.addEventListener("click", handleCheckEmails);
  if (refreshBtn) refreshBtn.addEventListener("click", () => currentEmail && loadInbox(currentEmail));
  if (copyBtn) copyBtn.addEventListener("click", copyCurrentEmail);

  emailInput.addEventListener("keydown", async (e) => {
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

  renderEmptyInbox();
}

document.addEventListener("DOMContentLoaded", init);
