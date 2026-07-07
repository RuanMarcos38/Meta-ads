import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { prisma } from './db.js';
import { slugify } from './utils/slug.js';
import { syncClientMetrics } from './services/metrics.js';

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'r2r-marketing-digital' },
    create: { name: 'R2R Marketing Digital', slug: 'r2r-marketing-digital' },
    update: {}
  });
  const adminPass = await bcrypt.hash('TroqueEssaSenha123', 12);
  await prisma.user.upsert({
    where: { email: 'admin@r2rmarketingdigital.com.br' },
    create: { tenantId: tenant.id, name: 'Administrador', email: 'admin@r2rmarketingdigital.com.br', passwordHash: adminPass, role: Role.ADMIN },
    update: {}
  });
  const client = await prisma.client.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: slugify('Cliente Demonstração') } },
    create: { tenantId: tenant.id, name: 'Cliente Demonstração', slug: slugify('Cliente Demonstração') },
    update: {}
  });
  const clientPass = await bcrypt.hash('Cliente12345', 12);
  await prisma.user.upsert({
    where: { email: 'cliente@demo.com.br' },
    create: { tenantId: tenant.id, clientId: client.id, name: 'Cliente Demo', email: 'cliente@demo.com.br', passwordHash: clientPass, role: Role.CLIENT },
    update: {}
  });
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  await syncClientMetrics({ clientId: client.id, from, to });
  console.log('Seed finalizado. Admin: admin@r2rmarketingdigital.com.br / TroqueEssaSenha123');
}

main().finally(() => prisma.$disconnect());
