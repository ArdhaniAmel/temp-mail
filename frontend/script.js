const API_BASE =
  (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl)
    ? window.APP_CONFIG.apiBaseUrl
    : ((window.TEMPMAIL_CONFIG && window.TEMPMAIL_CONFIG.apiBase)
        ? window.TEMPMAIL_CONFIG.apiBase
        : "https://mailapi.pakasir.dev/api");

const DEFAULT_DOMAIN = "pakasir.dev";
const AUTO_REFRESH_MS =
  (window.TEMPMAIL_CONFIG && Number(window.TEMPMAIL_CONFIG.autoRefreshMs)) || 10000;

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
const emailModal = document.getElementById("emailModal");
const emailModalBackdrop = document.getElementById("emailModalBackdrop");
const emailModalTitle = document.getElementById("emailModalTitle");
const emailModalBody = document.getElementById("emailModalBody");
const closeEmailModalBtn = document.getElementById("closeEmailModal");

let activeEmail = "";
let autoRefreshTimer = null;
let autoRefreshEnabled = true;
let lastSeenEmailId = "";

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function decodeEntities(str = "") {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = str;
  return textarea.value;
}

function stripHtml(html = "") {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || "").replace(/\s+/g, " ").trim();
}

function normalizeTextLinks(text = '') {
  return String(text || '')
    .replace(/=\r?\n/g, '') // fix email wrapped lines
    .replace(/\r/g, '');
}

function linkifyText(text = '') {
  const normalized = normalizeTextLinks(text);

  // escape dulu
  let safe = escapeHtml(normalized);

  // ubah URL jadi <a>
  safe = safe.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="email-link">$1</a>'
  );

  return safe;
}

function extractFirstLink(text = '') {
  const normalized = normalizeTextLinks(text);
  const matches = normalized.match(/https?:\/\/[^\s<>"']+/gi) || [];

  // prioritaskan link verifikasi
  const priority = matches.find(url =>
    /verify|confirm|activate|auth|login|signin/i.test(url)
  );

  return priority || matches[0] || '';
}

function openEmailModal(title, mail) {
  if (!emailModal || !emailModalTitle || !emailModalBody) return;

  emailModalTitle.textContent = title || "Email Detail";
  emailModalBody.innerHTML = "";

  if (mail.body_html && mail.body_html.trim()) {
    const iframe = document.createElement("iframe");
    iframe.className = "email-html-frame";
    iframe.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    emailModalBody.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(mail.body_html);
    doc.close();
  } else {
    const pre = document.createElement("pre");
    pre.className = "email-modal-text";
    pre.textContent = mail.body_text || mail.snippet || "(No content)";
    emailModalBody.appendChild(pre);
  }

  emailModal.style.display = "block";
}

function closeEmailModal() {
  if (!emailModal || !emailModalBody) return;
  emailModal.style.display = "none";
  emailModalBody.innerHTML = "";
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

function setExpiration(expiresAt = null) {
  const expiry = expiresAt
    ? new Date(expiresAt)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message =
      data?.error ||
      data?.message ||
      `HTTP ${res.status}`;
    throw new Error(message);
  }

  return data;
}

async function generateRandomEmail() {
  const domain = domainSelect.value || DEFAULT_DOMAIN;

  const data = await fetchJson(`${API_BASE}/email/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({ domain })
  });

  if (!data.success || !data.email) {
    throw new Error(data?.error || "API did not return email");
  }

  return data;
}

async function fetchInboxBundle(email) {
  const [inboxData, statsData] = await Promise.all([
    fetchJson(`${API_BASE}/emails/${encodeURIComponent(email)}`, {
      method: "GET",
      headers: { Accept: "application/json" }
    }),
    fetchJson(`${API_BASE}/stats/${encodeURIComponent(email)}`, {
      method: "GET",
      headers: { Accept: "application/json" }
    })
  ]);

  return {
    emails: inboxData.emails || [],
    stats: statsData.stats || {
      total_emails: (inboxData.emails || []).length,
      unread_emails: (inboxData.emails || []).length
    }
  };
}

async function loadInbox(email, opts = {}) {
  if (!email || !isValidTempAddress(email)) {
    emailsList.innerHTML = "";
    showNoEmails(true);
    totalEmails.textContent = "0";
    unreadEmails.textContent = "0";
    emailCount.textContent = "0";
    return;
  }

  const retries = Number.isFinite(opts.retries) ? opts.retries : 0;
  const retryDelay = Number.isFinite(opts.retryDelay) ? opts.retryDelay : 1500;

  try {
    setButtonState(true);
    showLoading(true);
    showNoEmails(false);

    let lastError = null;
    let result = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        result = await fetchInboxBundle(email);
        break;
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          await wait(retryDelay);
        }
      }
    }

    if (!result) throw lastError || new Error("Failed to fetch inbox");

    renderEmails(result.emails, result.stats);
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

function getPreviewText(mail) {
  return (
    mail.snippet ||
    mail.body_text ||
    stripHtml(mail.body_html || "") ||
    "(No content)"
  );
}

function renderEmails(emails, stats = null) {
  emailsList.innerHTML = "";

  const total = stats?.total_emails ?? (Array.isArray(emails) ? emails.length : 0);
  const unread = stats?.unread_emails ?? total;

  totalEmails.textContent = String(total);
  unreadEmails.textContent = String(unread);
  emailCount.textContent = String(total);

  if (!emails || emails.length === 0) {
    lastSeenEmailId = "";
    showNoEmails(true);
    return;
  }

  showNoEmails(false);

  const newestId = emails[0]?.email_id || "";
  if (newestId && newestId !== lastSeenEmailId && lastSeenEmailId) {
    document.title = `(${emails.length}) New mail - TempMail`;
  }
  lastSeenEmailId = newestId;

  emails.forEach((mail) => {
    const item = document.createElement("div");
    item.className = "email-item";

    const sender = escapeHtml(mail.sender_name || mail.sender || "Unknown sender");
    const subject = escapeHtml(mail.subject || "(No subject)");
    const previewText = getPreviewText(mail);
    const body = linkifyText(previewText);
    const verifyLink = extractFirstLink(previewText);
    const received = formatDate(mail.received_at || "");
    const otp = escapeHtml(mail.otp_code || "");

    item.innerHTML = `
      <div class="email-item-header">
        <div class="email-item-main">
          <div class="email-item-from">${sender}</div>
          <div class="email-item-subject">${subject}</div>
        </div>
        <div class="email-item-date">${received}</div>
      </div>

      <div class="email-actions-row">
        ${otp ? `<div class="otp-badge">OTP: ${otp}</div>` : ""}
        ${verifyLink ? `
          <a href="${verifyLink}" target="_blank" rel="noopener noreferrer" class="verify-link-btn">
            🔗 Open Verification Link
          </a>
        ` : ""}
        <button type="button" class="open-email-btn">📩 Open Email</button>
      </div>

      <div class="email-item-body">
        <div class="email-text">${body}</div>
      </div>
    `;

    const openBtn = item.querySelector(".open-email-btn");
    if (openBtn) {
      openBtn.addEventListener("click", () => {
        openEmailModal(mail.subject || "Email Detail", mail);
      });
    }

    if (otp) {
      item.addEventListener("dblclick", async () => {
        try {
          await navigator.clipboard.writeText(mail.otp_code);
          alert(`OTP copied: ${mail.otp_code}`);
        } catch {
          // ignore
        }
      });
    }

    emailsList.appendChild(item);
  });
}

async function handleGenerateRandom() {
  try {
    setButtonState(true);

    const result = await generateRandomEmail();
    const email = result.email;

    setActiveEmail(email);
    setExpiration(result.expires_at || null);
    await loadInbox(email, { retries: 1, retryDelay: 1000 });
    startAutoRefresh();
  } catch (err) {
    console.error(err);
    alert(`Failed to generate email: ${err.message}`);
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
  await loadInbox(email, { retries: 1, retryDelay: 1000 });
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
  await loadInbox(email, { retries: 2, retryDelay: 1500 });
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
    autoRefreshBtn.title = `Auto Refresh ON (${Math.round(AUTO_REFRESH_MS / 1000)}s)`;
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
  autoRefreshBtn.title = `Auto Refresh ON (${Math.round(AUTO_REFRESH_MS / 1000)}s)`;
  autoRefreshTimer = setInterval(() => {
    if (activeEmail) loadInbox(activeEmail, { retries: 1, retryDelay: 800 });
  }, AUTO_REFRESH_MS);
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
  refreshEmailsBtn.addEventListener("click", () => activeEmail && loadInbox(activeEmail, { retries: 2, retryDelay: 1200 }));
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

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && activeEmail) {
      loadInbox(activeEmail, { retries: 1, retryDelay: 800 });
    }
  });

  if (closeEmailModalBtn) {
    closeEmailModalBtn.addEventListener("click", closeEmailModal);
  }
  if (emailModalBackdrop) {
    emailModalBackdrop.addEventListener("click", closeEmailModal);
  }

  document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeEmailModal();
      }
  });
}

async function init() {
  bindEvents();

  const emailFromUrl = getEmailFromPath();

  if (emailFromUrl) {
    setActiveEmail(emailFromUrl);
    await loadInbox(emailFromUrl, { retries: 2, retryDelay: 1200 });
    startAutoRefresh();
    return;
  }

  autoRefreshBtn.classList.add("active");
  autoRefreshBtn.title = `Auto Refresh ON (${Math.round(AUTO_REFRESH_MS / 1000)}s)`;
  showNoEmails(true);
}

document.addEventListener("DOMContentLoaded", init);
