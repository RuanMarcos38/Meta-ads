(() => {
  const config = window.APP_CONFIG || {};
  const tokenKey = 'gestaoAdsToken';
  const userKey = 'gestaoAdsUser';
  const apiBaseKey = 'gestaoAdsApiBase';

  function cleanUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function autoApiBase() {
    const host = window.location.hostname || '';
    if (host === 'gestao.r2rmarketingdigital.com.br') return 'https://api-gestao.r2rmarketingdigital.com.br';
    if (host.startsWith('gestao.')) return `https://${host.replace(/^gestao\./, 'api-gestao.')}`;
    return '';
  }

  function apiBase() {
    let stored = '';
    try { stored = localStorage.getItem(apiBaseKey) || ''; } catch (_) {}
    return cleanUrl(stored || config.API_BASE_URL || autoApiBase());
  }

  function setApiBase(value) {
    const cleaned = cleanUrl(value);
    if (!cleaned) return;
    localStorage.setItem(apiBaseKey, cleaned);
  }

  function getToken() {
    return localStorage.getItem(tokenKey);
  }

  function setToken(token) {
    localStorage.setItem(tokenKey, token);
  }

  function clearSession() {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(userKey);
    localStorage.removeItem('gestaoAdsLogged');
  }

  function setUser(user) {
    localStorage.setItem(userKey, JSON.stringify(user || null));
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(userKey) || 'null');
    } catch {
      return null;
    }
  }

  function enabled() {
    return config.DEMO_MODE === false && Boolean(apiBase());
  }

  async function request(path, options = {}) {
    const base = apiBase();
    if (!enabled()) throw new Error('API nao configurada. Verifique API_BASE_URL em config.js.');
    const token = getToken();
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {})
        }
      });
    } catch (error) {
      throw new Error(`Nao foi possivel conectar na API ${base}. Verifique dominio, SSL, CORS e EasyPanel.`);
    }

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const data = isJson ? await response.json().catch(() => ({})) : await response.text();
    if (response.status === 401) clearSession();
    if (!isJson && typeof data === 'string' && data.trim().startsWith('<')) {
      throw new Error('A API retornou HTML. O dominio da API provavelmente esta apontando para o frontend ou hospedagem errada.');
    }
    if (!response.ok) throw new Error((data && data.message) || 'Nao foi possivel carregar os dados.');
    return data;
  }

  async function login(email, password) {
    const result = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setToken(result.token);
    setUser(result.user);
    return result;
  }

  window.GestaoAdsAPI = {
    enabled,
    request,
    login,
    logout: clearSession,
    clearSession,
    getToken,
    setApiBase,
    apiBase,
    getUser,
    setUser
  };
})();
