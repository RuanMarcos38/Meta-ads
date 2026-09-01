import { buildApp } from './app.js';
import { env } from './config/env.js';
import { startMetaSyncScheduler } from './modules/meta/syncScheduler.js';
import { startNotificationScheduler } from './modules/notifications/notificationScheduler.js';

async function main() {
  const app = await buildApp();
  let stopMetaScheduler: () => void = () => {};
  let stopNotificationScheduler: () => void = () => {};

  app.addHook('onClose', async () => {
    stopMetaScheduler();
    stopNotificationScheduler();
  });

  await app.listen({ port: env.port, host: '0.0.0.0' });
  stopMetaScheduler = startMetaSyncScheduler(app.log);
  stopNotificationScheduler = startNotificationScheduler(app.log);
  app.log.info(`API rodando na porta ${env.port} | DEMO_MODE=${env.demoMode}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
