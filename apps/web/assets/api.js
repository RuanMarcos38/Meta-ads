(() => {
  const config = window.APP_CONFIG || {};
  const tokenKey = 'gestaoAdsToken';
  const userKey = 'gestaoAdsUser';

  function apiBase() {
    return String(config.API_BASE_URL || '').replace(/\/+$/, '');
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
    if (!enabled()) throw new Error('API nao configurada. Verifique API_BASE_URL em config.js.');
    const token = getToken();
    const response = await fetch(`${apiBase()}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json().catch(() => ({})) : await response.text();
    if (response.status === 401) clearSession();
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
    getUser,
    setUser
  };
})();
