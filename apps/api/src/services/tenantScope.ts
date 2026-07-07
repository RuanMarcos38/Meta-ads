import { prisma } from '../db.js';

export async function assertTenantClient(tenantId: string, clientId: string) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, tenantId },
    select: { id: true }
  });
  if (!client) throw Object.assign(new Error('Cliente nao encontrado para este tenant.'), { statusCode: 404 });
  return client.id;
}

export async function assertTenantAdAccount(tenantId: string, adAccountId: string) {
  const adAccount = await prisma.adAccount.findFirst({
    where: { id: adAccountId, tenantId },
    select: { id: true, clientId: true }
  });
  if (!adAccount) throw Object.assign(new Error('Conta de anuncio nao encontrada para este tenant.'), { statusCode: 404 });
  return adAccount;
}
