import type { FastifyBaseLogger } from 'fastify';
import { env } from '../../config/env.js';
import { prisma } from '../../shared/prisma.js';
import { runSync } from './syncService.js';
import { isMetaRateLimitError } from './MetaAdsService.js';

function configuredIntervalMinutes() {
  const parsed = Number.parseInt(process.env.SYNC_INTERVAL_MINUTES?.trim() || '15', 10);
  const requested = Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
  // Abaixo de 15 minutos, múltiplas contas/BMs podem consumir a quota global
  // da Meta antes de uma janela anterior terminar.
  return Math.max(15, requested);
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
  let metaBackoffUntil = 0;

  async function tick() {
    if (running || stopped) return;
    if (Date.now() < metaBackoffUntil) {
      logger.warn({ retryAt: new Date(metaBackoffUntil).toISOString() }, 'Sincronização Meta aguardando janela segura após rate limit global.');
      return;
    }
    running = true;

    try {
      const accounts = await prisma.metaAdAccount.findMany({
        where: { isActive: true, isAssigned: true },
        select: {
          id: true,
          organizationId: true,
          clientId: true,
          businessId: true,
          connection: { select: { status: true } },
        },
      });

      const scopes = new Map<string, {
        organizationId: string;
        clientId: string;
        businessId?: string;
        accountIds: string[];
      }>();

      for (const account of accounts) {
        if (account.connection.status !== 'active') continue;
        const businessKey = account.businessId || '__SEM_BM__';
        const key = `${account.organizationId}:${account.clientId}:${businessKey}`;
        const current = scopes.get(key) ?? {
          organizationId: account.organizationId,
          clientId: account.clientId,
          businessId: account.businessId || undefined,
          accountIds: [],
        };
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
                businessId: scope.businessId ?? null,
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
                businessId: scope.businessId,
                reason: hasAccountWithoutMetrics ? 'new_account' : 'history_not_completed',
              },
              'Carga inicial controlada de métricas iniciada para BM.',
            );
            // O scheduler faz somente bootstrap de 30 dias. Histórico completo
            // fica reservado à ação explícita para não consumir a quota global.
            await runSync(scope.organizationId, scope.clientId, undefined, 'history', {
              fullHistory: false,
              businessId: scope.businessId,
            });
          } else {
            await runSync(scope.organizationId, scope.clientId, undefined, 'automatic', {
              businessId: scope.businessId,
            });
          }
        } catch (error) {
          if (isMetaRateLimitError(error)) {
            metaBackoffUntil = Date.now() + 15 * 60 * 1000;
            logger.warn({
              err: error,
              organizationId: scope.organizationId,
              clientId: scope.clientId,
              businessId: scope.businessId,
              retryAt: new Date(metaBackoffUntil).toISOString(),
            }, 'Meta atingiu limite global; demais sincronizações foram pausadas para preservar a quota.');
            break;
          }
          logger.error({
            err: error,
            organizationId: scope.organizationId,
            clientId: scope.clientId,
            businessId: scope.businessId,
          }, 'Falha na sincronização automática de uma BM. As demais BMs continuam independentes.');
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

  logger.info(`Sincronização automática Meta configurada a cada ${intervalMinutes} minuto(s), isolada por empresa e BM.`);

  return () => {
    stopped = true;
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
