import axios from 'axios';

export const apiBaseURL = import.meta.env.VITE_API_BASE_URL || 'https://api-gestao.r2rmarketingdigital.com.br';

export const api = axios.create({
  baseURL: apiBaseURL,
  timeout: 15000,
});

type CompatRequest = {
  _retry?: boolean;
  _assignmentCompatPost?: boolean;
  _assignmentLegacyPatch?: boolean;
};

const assignmentPath = (url?: string) => /^\/meta\/client-accounts\/[^/]+\/assignment$/.test(url || '');

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Sincronizações reais podem percorrer várias contas Meta e levar cerca de 1 minuto.
  // O timeout maior fica restrito aos endpoints de sync; o restante mantém resposta rápida.
  if (config.url?.includes('/sync')) {
    config.timeout = 120000;
  }

  // Compatibilidade de produção: preferimos POST para autorização de conta, pois alguns
  // proxies/reverse proxies rejeitam PATCH. Se o backend ainda estiver na versão antiga,
  // o interceptor de resposta faz fallback automático para PATCH sem alterar a tela.
  const compat = config as typeof config & CompatRequest;
  if (
    config.method?.toLowerCase() === 'patch'
    && assignmentPath(config.url)
    && !compat._assignmentLegacyPatch
  ) {
    config.method = 'post';
    compat._assignmentCompatPost = true;
  }

  return config;
});

let refreshRequest: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const request = error.config as (typeof error.config & CompatRequest) | undefined;
    const isAuthRoute = request?.url?.includes('/auth/login') || request?.url?.includes('/auth/refresh');

    if (
      request
      && request._assignmentCompatPost
      && !request._assignmentLegacyPatch
      && request.method?.toLowerCase() === 'post'
      && assignmentPath(request.url)
      && [404, 405].includes(Number(error.response?.status || 0))
    ) {
      request._assignmentLegacyPatch = true;
      request.method = 'patch';
      return api(request);
    }

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
