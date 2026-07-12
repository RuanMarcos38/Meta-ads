import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();
const isProd = process.env.NODE_ENV === 'production';
const adminName = process.env.SEED_ADMIN_NAME?.trim() || 'Administrador R2R';
const adminEmail = (process.env.SEED_ADMIN_EMAIL?.trim() || 'admin@r2rmarketingdigital.com.br').toLowerCase();
const adminPassword = process.env.SEED_ADMIN_PASSWORD?.trim() || (isProd ? '' : '123456');
const seedDemoClient = (process.env.SEED_DEMO_CLIENT ?? (isProd ? 'false' : 'true')) === 'true';

async function main() {
  if (!adminPassword || (isProd && adminPassword.length < 12)) {
    throw new Error('SEED_ADMIN_PASSWORD precisa ter pelo menos 12 caracteres em produção.');
  }

  const organization = await prisma.organization.upsert({
    where: { id: 'org-r2r' },
    update: { name: 'R2R Marketing Digital', email: adminEmail },
    create: {
      id: 'org-r2r',
      name: 'R2R Marketing Digital',
      email: adminEmail,
    },
  });

  const passwordHash = await argon2.hash(adminPassword);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: adminName,
      passwordHash,
      role: Role.SUPER_ADMIN,
      organizationId: organization.id,
      isActive: true,
      mustChangePassword: isProd,
    },
    create: {
      name: adminName,
      email: adminEmail,
      passwordHash,
      role: Role.SUPER_ADMIN,
      organizationId: organization.id,
      mustChangePassword: isProd,
    },
  });

  if (seedDemoClient) {
    const client = await prisma.client.upsert({
      where: { id: 'client-demo' },
      update: {},
      create: {
        id: 'client-demo',
        organizationId: organization.id,
        name: 'Cliente Demonstração',
        companyName: 'Empresa Demo LTDA',
        segment: 'Varejo',
        status: 'active',
      },
    });

    const demoPassword = process.env.SEED_DEMO_PASSWORD?.trim() || '123456';
    const demoPasswordHash = await argon2.hash(demoPassword);
    await prisma.user.upsert({
      where: { email: 'cliente@demo.com' },
      update: {},
      create: {
        name: 'Cliente Demo',
        email: 'cliente@demo.com',
        passwordHash: demoPasswordHash,
        role: Role.CLIENT,
        organizationId: organization.id,
        clientId: client.id,
        mustChangePassword: isProd,
      },
    });
  }

  console.log(`Seed concluído para ${adminEmail}. A senha não foi exibida.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
