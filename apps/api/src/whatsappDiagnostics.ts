import axios from 'axios';
import type { FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { ok } from './shared/response.js';

function safeBaseUrl() {
  if (!env.whatsapp.baseUrl) return null;
  try {
    const parsed = new URL(env.whatsapp.baseUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'invalid-url';
  }
}

function normalizeState(payload: any) {
  return String(
    payload?.instance?.state
      || payload?.state
      || payload?.connectionStatus
      || payload?.status
      || '',
  ).trim().toLowerCase();
}

export async function registerWhatsappDiagnostics(app: FastifyInstance) {
  app.get('/diagnostics/whatsapp', async () => {
    const configured = Boolean(env.whatsapp.baseUrl && env.whatsapp.apiKey && env.whatsapp.instance);
    const base = {
      configured,
      provider: 'evolution-api',
      host: safeBaseUrl(),
      instanceConfigured: Boolean(env.whatsapp.instance),
      apiKeyConfigured: Boolean(env.whatsapp.apiKey),
    };

    if (!configured) {
      return ok({
        ...base,
        reachable: false,
        connected: false,
        state: 'not_configured',
        category: 'CONFIGURATION_REQUIRED',
      });
    }

    try {
      const baseUrl = env.whatsapp.baseUrl.replace(/\/$/, '');
      const response = await axios.get(
        `${baseUrl}/instance/connectionState/${encodeURIComponent(env.whatsapp.instance)}`,
        {
          headers: { apikey: env.whatsapp.apiKey },
          timeout: 10_000,
          validateStatus: () => true,
        },
      );

      const state = normalizeState(response.data);
      const connected = ['open', 'connected', 'online'].includes(state);
      const reachable = response.status >= 200 && response.status < 500;
      let category = connected ? 'CONNECTED' : 'NOT_CONNECTED';
      if (response.status === 401 || response.status === 403) category = 'AUTHENTICATION_FAILED';
      else if (response.status === 404) category = 'INSTANCE_NOT_FOUND';
      else if (response.status >= 500) category = 'EVOLUTION_SERVER_ERROR';

      return ok({
        ...base,
        reachable,
        connected,
        state: state || 'unknown',
        httpStatus: response.status,
        category,
      });
    } catch (error: any) {
      const code = String(error?.code || '');
      const category = code === 'ECONNABORTED'
        ? 'TIMEOUT'
        : ['ENOTFOUND', 'EAI_AGAIN'].includes(code)
          ? 'DNS_ERROR'
          : ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)
            ? 'UNREACHABLE'
            : 'REQUEST_FAILED';

      return ok({
        ...base,
        reachable: false,
        connected: false,
        state: 'unreachable',
        category,
      });
    }
  });
}
