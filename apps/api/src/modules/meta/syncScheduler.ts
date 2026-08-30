import type { FastifyBaseLogger } from 'fastify';
import { env } from '../../config/env.js';
import { prisma } from '../../shared/prisma.js';
import { runSync } from './syncService.js';

function configuredIntervalMinutes() {
  const parsed = Number.parseInt(process.env.SYNC_INTERVAL_MINUTES?.trim() || '5', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

export function startMetaSyncScheduler(logger: FastifyBaseLogger) {
  const intervalMinutes = configuredIntervalMinutes();
  const intervalMs = intervalMinutes * 60 * 1000;

  if (env.demoMode) {
    logger.info('Sincronização automática Meta desativada porque DEMO_MODE=true.');
    return () => undefined;
  }

  let running = false;
  let stopped = false;

  async function tick() {
    if (running || stopped) return;
    running = true;

    try {
      const accounts = await prisma.metaAdAccount.findMany({
        where: { isActive: true, isAssigned: true },
        select: {
          id: true,
          organizationId: true,
          clientId: true,
          connection: { select: { status: true } },
        },
      });

      const scopes = new Map<string, { organizationId: string; clientId: string; accountIds: string[] }>();
      for (const account of accounts) {
        if (account.connection.status !== 'active') continue;
        const key = `${account.organizationId}:${account.clientId}`;
        const current = scopes.get(key) ?? { organizationId: account.organizationId, clientId: account.clientId, accountIds: [] };
        current.accountIds.push(account.id);
        scopes.set(key, current);
      }

      for (const scope of scopes.values()) {
        try {
          const [importedAccounts, successfulHistoryJob] = await Promise.all([
            prisma.insightDaily.findMany({
              where: {
                organizationId: scope.organizationId,
                clientId: scope.clientId,
                level: 'campaign',
                adAccountId: { in: scope.accountIds },
              },
              distinct: ['adAccountId'],
              select: { adAccountId: true },
            }),
            prisma.syncJob.findFirst({
              where: {
                organizationId: scope.organizationId,
                clientId: scope.clientId,
                type: 'history',
                status: 'success',
              },
              select: { id: true },
            }),
          ]);

          const importedIds = new Set(importedAccounts.map((item) => item.adAccountId));
          const hasAccountWithoutMetrics = scope.accountIds.some((id) => !importedIds.has(id));
          const needsHistory = hasAccountWithoutMetrics || !successfulHistoryJob;

          if (needsHistory) {
            logger.info(
              {
                organizationId: scope.organizationId,
                clientId: scope.clientId,
                reason: hasAccountWithoutMetrics ? 'new_account' : 'history_not_completed',
              },
              'Importação histórica completa obrigatória iniciada para empresa/BM.',
            );
            await runSync(scope.organizationId, scope.clientId, undefined, 'history', { fullHistory: true });
          } else {
            await runSync(scope.organizationId, scope.clientId, undefined, 'automatic');
          }
        } catch (error) {
          logger.error({ err: error, organizationId: scope.organizationId, clientId: scope.clientId }, 'Falha na sincronização automática Meta.');
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Falha ao preparar a sincronização automática Meta.');
    } finally {
      running = false;
    }
  }

  const initialTimer = setTimeout(() => { void tick(); }, Math.min(30_000, intervalMs));
  const intervalTimer = setInterval(() => { void tick(); }, intervalMs);

  logger.info(`Sincronização automática Meta configurada para cada ${intervalMinutes} minuto(s), com backfill histórico completo obrigatório por empresa e em novas contas.`);

  return () => {
    stopped = true;
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
