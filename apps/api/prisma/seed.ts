import { PrismaClient, Role } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();
const isProd = process.env.NODE_ENV === 'production';

async function main() {
  const org = await prisma.organization.upsert({
    where: { id: 'org-r2r' },
    update: {},
    create: { id: 'org-r2r', name: 'R2R Marketing Digital', email: 'admin@r2rmarketingdigital.com.br' },
  });

  const passwordHash = await argon2.hash('123456');
  await prisma.user.upsert({
    where: { email: 'admin@r2rmarketingdigital.com.br' },
    update: {},
    create: {
      name: 'Administrador R2R',
      email: 'admin@r2rmarketingdigital.com.br',
      passwordHash,
      role: Role.SUPER_ADMIN,
      organizationId: org.id,
      mustChangePassword: isProd, // em produção obriga trocar
    },
  });

  // Cliente demo
  const client = await prisma.client.upsert({
    where: { id: 'client-demo' },
    update: {},
    create: {
      id: 'client-demo', organizationId: org.id, name: 'Cliente Demonstração',
      companyName: 'Empresa Demo LTDA', segment: 'Varejo', status: 'active',
    },
  });

  const clientPass = await argon2.hash('123456');
  await prisma.user.upsert({
    where: { email: 'cliente@demo.com' },
    update: {},
    create: {
      name: 'Cliente Demo', email: 'cliente@demo.com', passwordHash: clientPass,
      role: Role.CLIENT, organizationId: org.id, clientId: client.id, mustChangePassword: isProd,
    },
  });

  console.log('Seed concluído. Login admin: admin@r2rmarketingdigital.com.br / 123456');
}
main().finally(() => prisma.$disconnect());
