import { buildApp } from './app.js';
import { env } from './config/env.js';

async function main() {
  const app = await buildApp();
  await app.listen({ port: env.port, host: '0.0.0.0' });
  app.log.info(`API rodando na porta ${env.port} | DEMO_MODE=${env.demoMode}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
