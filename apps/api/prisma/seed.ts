import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();
const isProd = process.env.NODE_ENV === 'production';
const adminName = process.env.SEED_ADMIN_NAME?.trim() || 'Administrador R2R';
const adminEmail = (process.env.SEED_ADMIN_EMAIL?.trim() || 'admin@r2rmarketingdigital.com.br').toLowerCase();
const adminPassword = process.env.SEED_ADMIN_PASSWORD?.trim() || (isProd ? '' : '123456');
const forceAdminPasswordReset = (process.env.FORCE_ADMIN_PASSWORD_RESET ?? 'false').toLowerCase() === 'true';
const seedDemoClient = (process.env.SEED_DEMO_CLIENT ?? (isProd ? 'false' : 'true')) === 'true';

function validateAdminPassword(password: string) {
  if (!password || (isProd && password.length < 12)) {
    throw new Error('SEED_ADMIN_PASSWORD precisa ter pelo menos 12 caracteres em produção.');
  }
}

async function main() {
  const organization = await prisma.organization.upsert({
    where: { id: 'org-r2r' },
    update: { name: 'R2R Marketing Digital', email: adminEmail },
    create: {
      id: 'org-r2r',
      name: 'R2R Marketing Digital',
      email: adminEmail,
    },
  });

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  const shouldWritePassword = !existingAdmin || forceAdminPasswordReset;

  if (shouldWritePassword) validateAdminPassword(adminPassword);

  if (existingAdmin) {
    await prisma.user.update({
      where: { id: existingAdmin.id },
      data: {
        name: adminName,
        role: Role.SUPER_ADMIN,
        organizationId: organization.id,
        isActive: true,
        ...(shouldWritePassword
          ? {
              passwordHash: await argon2.hash(adminPassword),
              mustChangePassword: isProd,
            }
          : {}),
      },
    });
  } else {
    await prisma.user.create({
      data: {
        name: adminName,
        email: adminEmail,
        passwordHash: await argon2.hash(adminPassword),
        role: Role.SUPER_ADMIN,
        organizationId: organization.id,
        isActive: true,
        mustChangePassword: isProd,
      },
    });
  }

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
    const existingDemo = await prisma.user.findUnique({ where: { email: 'cliente@demo.com' } });

    if (!existingDemo) {
      const demoPasswordHash = await argon2.hash(demoPassword);
      await prisma.user.create({
        data: {
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
  }

  const passwordAction = !existingAdmin
    ? 'administrador criado'
    : forceAdminPasswordReset
      ? 'senha administrativa redefinida'
      : 'administrador preservado sem alterar a senha';

  console.log(`Seed concluído para ${adminEmail}: ${passwordAction}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());