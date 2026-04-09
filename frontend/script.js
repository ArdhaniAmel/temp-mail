class TempMailApp {
    constructor() {
        this.config = window.TEMPMAIL_CONFIG || {};
        this.apiBase = this.config.apiBase || 'https://mailapi.pakasir.dev/api';
        this.defaultDomains = Array.isArray(this.config.defaultDomains) && this.config.defaultDomains.length
            ? this.config.defaultDomains
            : ['pakasir.dev'];
        this.currentEmail = null;
        this.autoRefreshInterval = null;
        this.domains = [];

        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadDomains();
        this.showToast('Ready. Generate an address to start receiving mail.', 'info');
    }

    async loadDomains() {
        try {
            const response = await fetch(`${this.apiBase}/domains`);
            const data = await response.json();

            if (data.success && Array.isArray(data.domains) && data.domains.length) {
                this.domains = data.domains;
            } else {
                this.domains = [...this.defaultDomains];
            }
        } catch (error) {
            console.warn('Falling back to default domains:', error);
            this.domains = [...this.defaultDomains];
            this.showToast('Using fallback domain list.', 'info');
        }

        this.populateDomainSelect();
    }

    async generateEmail() {
        const domain = document.getElementById('domainSelect').value;

        if (!domain) {
            this.showToast('Please select a domain first', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.apiBase}/email/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain })
            });
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to generate email');
            }

            this.currentEmail = data.email;
            this.updateEmailDisplay(data.email, data.expires_at);
            document.getElementById('emailListSection').style.display = 'block';
            await this.loadEmails();
            this.showToast('Email generated successfully!', 'success');
        } catch (error) {
            console.error(error);
            this.showToast(error.message || 'Failed to generate email', 'error');
        }
    }

    async loadEmails() {
        if (!this.currentEmail) return;

        const loadingEl = document.getElementById('loadingEmails');
        const noEmailsEl = document.getElementById('noEmails');

        loadingEl.style.display = 'block';
        noEmailsEl.style.display = 'none';

        try {
            const response = await fetch(`${this.apiBase}/emails/${encodeURIComponent(this.currentEmail)}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load emails');
            }

            this.displayEmails(data.emails || []);
            await this.updateEmailStats();
        } catch (error) {
            console.error(error);
            this.showToast('Failed to load emails', 'error');
        } finally {
            loadingEl.style.display = 'none';
        }
    }

    async loadEmailStats() {
        if (!this.currentEmail) return;

        try {
            const response = await fetch(`${this.apiBase}/stats/${encodeURIComponent(this.currentEmail)}`);
            const data = await response.json();

            if (data.success) {
                const stats = data.stats || { total_emails: 0, unread_emails: 0 };
                document.getElementById('totalEmails').textContent = stats.total_emails || 0;
                document.getElementById('unreadEmails').textContent = stats.unread_emails || 0;
                document.getElementById('emailCount').textContent = stats.total_emails || 0;
                document.getElementById('emailStats').style.display = 'flex';
            }
        } catch (error) {
            console.error('Error loading email stats:', error);
        }
    }

    async loadEmailDetails(emailId) {
        if (!this.currentEmail) return;

        try {
            const response = await fetch(`${this.apiBase}/email/${encodeURIComponent(this.currentEmail)}/${encodeURIComponent(emailId)}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load email details');
            }

            this.showEmailModal(data.email);
            await this.updateEmailStats();
        } catch (error) {
            console.error(error);
            this.showToast('Failed to load email details', 'error');
        }
    }

    async deleteEmail(emailId) {
        if (!this.currentEmail) return;
        if (!confirm('Delete this email?')) return;

        try {
            const response = await fetch(`${this.apiBase}/email/${encodeURIComponent(this.currentEmail)}/${encodeURIComponent(emailId)}`, {
                method: 'DELETE'
            });
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to delete email');
            }

            this.closeModal();
            await this.loadEmails();
            this.showToast('Email deleted successfully', 'success');
        } catch (error) {
            console.error(error);
            this.showToast('Failed to delete email', 'error');
        }
    }

    populateDomainSelect() {
        const select = document.getElementById('domainSelect');
        select.innerHTML = '<option value="">Choose a domain...</option>';

        this.domains.forEach(domain => {
            const option = document.createElement('option');
            option.value = domain;
            option.textContent = domain;
            select.appendChild(option);
        });

        if (this.domains.length === 1) {
            select.value = this.domains[0];
        }
    }

    updateEmailDisplay(email, expiresAt) {
        document.getElementById('currentEmail').value = email;
        document.getElementById('currentEmailAddress').textContent = email;

        const expiry = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);
        document.getElementById('expirationTime').textContent = expiry.toLocaleString();

        document.getElementById('emailInfo').style.display = 'flex';
        document.getElementById('checkEmailsBtn').disabled = false;
    }

    displayEmails(emails) {
        const container = document.getElementById('emailContainer');
        const loadingEl = document.getElementById('loadingEmails');
        const noEmailsEl = document.getElementById('noEmails');

        container.querySelectorAll('.email-item').forEach(item => item.remove());

        if (!emails.length) {
            noEmailsEl.style.display = 'block';
            return;
        }

        noEmailsEl.style.display = 'none';

        emails.forEach(email => {
            const emailItem = this.createEmailItem(email);
            container.insertBefore(emailItem, loadingEl);
        });
    }

    createEmailItem(email) {
        const item = document.createElement('div');
        item.className = `email-item ${email.is_read ? '' : 'unread'}`;
        item.onclick = () => this.loadEmailDetails(email.email_id);

        const date = new Date(email.received_at);
        const previewText = (email.body_text || email.body_html || '').replace(/\s+/g, ' ').trim();
        const preview = previewText ? `${previewText.substring(0, 120)}${previewText.length > 120 ? '…' : ''}` : 'No content available';

        item.innerHTML = `
            <div class="email-header">
                <span class="email-sender">${this.escapeHtml(email.sender || 'Unknown sender')}</span>
                <span class="email-date">${date.toLocaleString()}</span>
            </div>
            <div class="email-subject">${this.escapeHtml(email.subject || 'No Subject')}</div>
            <div class="email-preview">${this.escapeHtml(preview)}</div>
        `;

        return item;
    }

    showEmailModal(email) {
        const modal = document.getElementById('emailModal');
        document.getElementById('emailSubject').textContent = email.subject || 'No Subject';
        document.getElementById('emailFrom').textContent = email.sender || 'Unknown sender';
        document.getElementById('emailTo').textContent = email.recipient;
        document.getElementById('emailDate').textContent = new Date(email.received_at).toLocaleString();
        document.getElementById('emailTextBody').textContent = email.body_text || 'No text content';
        document.getElementById('emailHtmlBody').srcdoc = email.body_html || '<p style="font-family: sans-serif;">No HTML content</p>';

        const attachmentsEl = document.getElementById('emailAttachments');
        const attachmentsList = document.getElementById('attachmentsList');

        attachmentsList.innerHTML = '';
        if (Array.isArray(email.attachments) && email.attachments.length) {
            email.attachments.forEach(attachment => {
                const attachmentItem = document.createElement('div');
                attachmentItem.className = 'attachment-item';
                attachmentItem.innerHTML = `
                    <i class="fas fa-paperclip attachment-icon"></i>
                    <span>${this.escapeHtml(attachment.filename || 'attachment')}</span>
                    <small>(${this.formatFileSize(Number(attachment.size) || 0)})</small>
                `;
                attachmentsList.appendChild(attachmentItem);
            });
            attachmentsEl.style.display = 'block';
        } else {
            attachmentsEl.style.display = 'none';
        }

        document.getElementById('deleteEmailBtn').onclick = () => this.deleteEmail(email.email_id);
        modal.classList.add('active');
    }

    closeModal() {
        document.getElementById('emailModal').classList.remove('active');
    }

    async updateEmailStats() {
        await this.loadEmailStats();
    }

    async copyEmailToClipboard() {
        if (!this.currentEmail) {
            this.showToast('No email to copy', 'error');
            return;
        }

        try {
            await navigator.clipboard.writeText(this.currentEmail);
            this.showToast('Email copied to clipboard!', 'success');
        } catch {
            const emailInput = document.getElementById('currentEmail');
            emailInput.select();
            document.execCommand('copy');
            this.showToast('Email copied to clipboard!', 'success');
        }
    }

    toggleAutoRefresh() {
        const btn = document.getElementById('autoRefreshBtn');
        const intervalMs = Number(this.config.autoRefreshMs || 15000);

        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
            btn.classList.remove('auto-refresh-active');
            this.showToast('Auto-refresh disabled', 'info');
            return;
        }

        this.autoRefreshInterval = setInterval(() => this.loadEmails(), intervalMs);
        btn.classList.add('auto-refresh-active');
        this.showToast(`Auto-refresh enabled (${Math.round(intervalMs / 1000)}s)`, 'success');
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle';
        toast.innerHTML = `<i class="fas fa-${icon}"></i><span>${this.escapeHtml(message)}</span>`;
        container.appendChild(toast);

        setTimeout(() => toast.remove(), 4000);
    }

    bindEvents() {
        document.getElementById('generateBtn').onclick = () => this.generateEmail();
        document.getElementById('refreshBtn').onclick = () => this.generateEmail();
        document.getElementById('copyBtn').onclick = () => this.copyEmailToClipboard();
        document.getElementById('checkEmailsBtn').onclick = () => {
            document.getElementById('emailListSection').style.display = 'block';
            this.loadEmails();
        };
        document.getElementById('refreshEmailsBtn').onclick = () => this.loadEmails();
        document.getElementById('autoRefreshBtn').onclick = () => this.toggleAutoRefresh();
        document.getElementById('closeModal').onclick = () => this.closeModal();
        document.getElementById('emailModal').onclick = (e) => {
            if (e.target.id === 'emailModal') this.closeModal();
        };
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.onclick = () => this.switchTab(btn.dataset.tab);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModal();
        });
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`${tabName}Content`).classList.add('active');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text ?? '');
        return div.innerHTML;
    }

    formatFileSize(bytes) {
        if (!bytes) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.tempMailApp = new TempMailApp();
});
