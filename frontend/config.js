window.TEMPMAIL_CONFIG = {
  apiBase: window.location.hostname === 'localhost'
    ? 'http://127.0.0.1:8787/api'
    : 'https://mailapi.pakasir.dev/api',
  defaultDomains: ['pakasir.dev'],
  appName: 'Pakasir TempMail',
  autoRefreshMs: 15000
};
