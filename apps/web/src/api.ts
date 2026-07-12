import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'https://api-gestao.r2rmarketingdigital.com.br';

export const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
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
            .post(`${baseURL}/auth/refresh`, { refresh })
            .then((response) => response.data.data.token as string)
            .finally(() => { refreshRequest = null; });

          const token = await refreshRequest;
          localStorage.setItem('token', token);
          request.headers.Authorization = `Bearer ${token}`;
          return api(request);
        } catch {
          // O tratamento abaixo encerra a sessão.
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
