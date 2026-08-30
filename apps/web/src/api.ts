import axios from 'axios';

export const apiBaseURL = import.meta.env.VITE_API_BASE_URL || 'https://api-gestao.r2rmarketingdigital.com.br';

export const api = axios.create({
  baseURL: apiBaseURL,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Sincronizações reais podem percorrer várias contas Meta e levar cerca de 1 minuto.
  // O timeout maior fica restrito aos endpoints de sync; o restante mantém resposta rápida.
  if (config.url?.includes('/sync')) {
    config.timeout = 120000;
  }

  // Compatibilidade de produção: alguns proxies/reverse proxies podem rejeitar PATCH
  // mesmo quando a API aceita o endpoint. A autorização de contas possui uma rota POST
  // equivalente e idempotente no backend, então convertemos somente este caso específico.
  if (
    config.method?.toLowerCase() === 'patch'
    && /^\/meta\/client-accounts\/[^/]+\/assignment$/.test(config.url || '')
  ) {
    config.method = 'post';
  }

  return config;
});

let refreshRequest: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const request = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
    const isAuthRoute = request?.url?.includes('/auth/login') || request?.url?.includes('/auth/refresh');

    if (error.response?.status === 401 && request && !request._retry && !isAuthRoute) {
      request._retry = true;
      const refresh = localStorage.getItem('refresh');

      if (refresh) {
        try {
          refreshRequest ??= axios
            .post(`${apiBaseURL}/auth/refresh-bm`, { refresh }, { timeout: 15000 })
            .then((response) => response.data.data.token as string)
            .finally(() => { refreshRequest = null; });

          const token = await refreshRequest;
          localStorage.setItem('token', token);
          request.headers.Authorization = `Bearer ${token}`;
          return api(request);
        } catch {
          // O tratamento abaixo encerra a sessão local.
        }
      }

      localStorage.removeItem('token');
      localStorage.removeItem('refresh');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') window.location.assign('/login');
    }

    return Promise.reject(error);
  },
);
