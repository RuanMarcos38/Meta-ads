import type { FastifyInstance, FastifyRequest } from 'fastify';

type WorkspaceContextPayload = {
  success?: boolean;
  data?: {
    clients?: Array<{
      id?: string;
      _count?: { users?: number; adAccounts?: number; businessManagers?: number };
      [key: string]: unknown;
    }>;
    businesses?: Array<{ clientId?: string; status?: string; [key: string]: unknown }>;
    accounts?: Array<{ clientId?: string; isAssigned?: boolean; isActive?: boolean; [key: string]: unknown }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function requestPath(req: FastifyRequest) {
  return String(req.raw.url || '').split('?')[0];
}

/**
 * Corrige somente os contadores exibidos no seletor de empresas.
 * O banco pode manter registros históricos/inativos por auditoria, mas eles não podem
 * aparecer como BMs ou contas atualmente autorizadas para a empresa.
 */
export function normalizeWorkspaceContextCounts(input: WorkspaceContextPayload): WorkspaceContextPayload {
  const data = input?.data;
  if (!data || !Array.isArray(data.clients)) return input;

  const businesses = Array.isArray(data.businesses) ? data.businesses : [];
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];

  const activeBusinessCounts = new Map<string, number>();
  const assignedAccountCounts = new Map<string, number>();

  for (const business of businesses) {
    const clientId = String(business?.clientId || '');
    if (!clientId || business?.status === 'inactive') continue;
    activeBusinessCounts.set(clientId, (activeBusinessCounts.get(clientId) || 0) + 1);
  }

  for (const account of accounts) {
    const clientId = String(account?.clientId || '');
    if (!clientId || !account?.isAssigned || !account?.isActive) continue;
    assignedAccountCounts.set(clientId, (assignedAccountCounts.get(clientId) || 0) + 1);
  }

  return {
    ...input,
    data: {
      ...data,
      clients: data.clients.map((client) => {
        const clientId = String(client?.id || '');
        return {
          ...client,
          _count: {
            ...(client?._count || {}),
            businessManagers: activeBusinessCounts.get(clientId) || 0,
            adAccounts: assignedAccountCounts.get(clientId) || 0,
          },
        };
      }),
    },
  };
}

/**
 * Compatibilidade de segurança: builds antigos ainda chamam /refresh.
 * Essa chamada é encaminhada internamente para /import-from-meta, cuja regra atual
 * atualiza somente BMs previamente selecionadas e nunca importa todas as BMs da conta Meta.
 */
export async function registerWorkspaceSafetyHooks(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (req.method !== 'POST' || requestPath(req) !== '/workspace/business-managers/refresh') return;

    const authorization = req.headers.authorization;
    const proxied = await app.inject({
      method: 'POST',
      url: '/workspace/business-managers/import-from-meta',
      headers: authorization ? { authorization } : {},
      payload: (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {},
    });

    const contentType = proxied.headers['content-type'];
    if (contentType) reply.header('content-type', contentType);
    reply.header('x-gestao-bm-refresh-mode', 'explicit-selection');

    let body: unknown = proxied.body;
    try { body = proxied.json(); } catch { /* mantém texto quando não for JSON */ }
    return reply.code(proxied.statusCode).send(body);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (requestPath(req) !== '/workspace/context' || reply.statusCode >= 400) return payload;

    const text = Buffer.isBuffer(payload)
      ? payload.toString('utf8')
      : typeof payload === 'string'
        ? payload
        : null;
    if (!text) return payload;

    try {
      const parsed = JSON.parse(text) as WorkspaceContextPayload;
      return JSON.stringify(normalizeWorkspaceContextCounts(parsed));
    } catch {
      return payload;
    }
  });
}
