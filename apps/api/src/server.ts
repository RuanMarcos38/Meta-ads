import { buildApp } from './app.js';
import { env } from './config/env.js';
import { startMetaSyncScheduler } from './modules/meta/syncScheduler.js';

async function main() {
  const app = await buildApp();
  let stopScheduler: () => void = () => {};

  app.addHook('onClose', async () => {
    stopScheduler();
  });

  await app.listen({ port: env.port, host: '0.0.0.0' });
  stopScheduler = startMetaSyncScheduler(app.log);
  app.log.info(`API rodando na porta ${env.port} | DEMO_MODE=${env.demoMode}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
