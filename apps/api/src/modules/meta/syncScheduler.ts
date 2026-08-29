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
        where: { isActive: true },
        select: {
          organizationId: true,
          clientId: true,
          connection: { select: { status: true } },
        },
      });

      const scopes = new Map<string, { organizationId: string; clientId: string }>();
      for (const account of accounts) {
        if (account.connection.status !== 'active') continue;
        const key = `${account.organizationId}:${account.clientId}`;
        scopes.set(key, { organizationId: account.organizationId, clientId: account.clientId });
      }

      for (const scope of scopes.values()) {
        try {
          await runSync(scope.organizationId, scope.clientId, undefined, 'automatic');
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

  logger.info(`Sincronização automática Meta configurada para cada ${intervalMinutes} minuto(s).`);

  return () => {
    stopped = true;
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
