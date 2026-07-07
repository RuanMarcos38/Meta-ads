import bcrypt from 'bcryptjs';
import { Role, UserStatus } from '@prisma/client';
import { prisma } from './db.js';
import { env } from './env.js';
import { KNOWN_FEATURES } from './services/features.js';
import { syncClientMetrics } from './services/sync.js';
import { slugify } from './utils/slug.js';

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'r2r-marketing-digital' },
    create: { name: 'R2R Marketing Digital', slug: 'r2r-marketing-digital' },
    update: { name: 'R2R Marketing Digital', status: 'ACTIVE' }
  });

  const adminPassword = env.SEED_ADMIN_PASSWORD;
  const admin = await prisma.user.upsert({
    where: { email: env.SEED_ADMIN_EMAIL.toLowerCase() },
    create: {
      tenantId: tenant.id,
      name: 'Administrador',
      email: env.SEED_ADMIN_EMAIL.toLowerCase(),
      passwordHash: await bcrypt.hash(adminPassword, 12),
      role: Role.COMPANY_ADMIN,
      status: UserStatus.ACTIVE
    },
    update: { tenantId: tenant.id, role: Role.COMPANY_ADMIN, status: UserStatus.ACTIVE }
  });

  const client = await prisma.client.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: slugify('R2R Marketing Digital') } },
    create: {
      tenantId: tenant.id,
      name: 'R2R Marketing Digital',
      tradeName: 'R2R Marketing Digital',
      slug: slugify('R2R Marketing Digital'),
      email: 'admin@r2rmarketingdigital.com.br',
      status: 'ACTIVE'
    },
    update: { status: 'ACTIVE' }
  });

  const clientUser = await prisma.user.upsert({
    where: { email: 'cliente@r2rmarketingdigital.com.br' },
    create: {
      tenantId: tenant.id,
      clientId: client.id,
      name: 'Cliente R2R',
      email: 'cliente@r2rmarketingdigital.com.br',
      passwordHash: await bcrypt.hash('123456', 12),
      role: Role.USER,
      status: UserStatus.ACTIVE
    },
    update: { tenantId: tenant.id, clientId: client.id, role: Role.USER, status: UserStatus.ACTIVE }
  });

  await prisma.clientUser.upsert({
    where: { clientId_userId: { clientId: client.id, userId: clientUser.id } },
    create: { tenantId: tenant.id, clientId: client.id, userId: clientUser.id, role: Role.USER },
    update: { role: Role.USER }
  });

  for (const featureName of KNOWN_FEATURES) {
    await prisma.featureFlag.upsert({
      where: { tenantId_featureName: { tenantId: tenant.id, featureName } },
      create: { tenantId: tenant.id, featureName, enabled: true },
      update: {}
    });
  }

  if (env.DEMO_MODE) {
    const to = new Date().toISOString().slice(0, 10);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 7);
    await syncClientMetrics({
      tenantId: tenant.id,
      clientId: client.id,
      from: fromDate.toISOString().slice(0, 10),
      to,
      requestedBy: admin.id
    });
  }

  console.log(`Seed finalizado. Admin: ${env.SEED_ADMIN_EMAIL} / ${adminPassword}`);
  console.log('Cliente demo: cliente@r2rmarketingdigital.com.br / 123456');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
