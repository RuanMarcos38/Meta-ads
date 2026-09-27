import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../shared/prisma.js';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const suite = integrationEnabled ? describe : describe.skip;

suite('WhatsApp daily delivery guard', () => {
  let organizationId = '';
  let clientId = '';
  const phone = '5547999371478';

  beforeAll(async () => {
    const organization = await prisma.organization.findFirst({ select: { id: true } });
    if (!organization) throw new Error('Organização de integração não encontrada.');
    organizationId = organization.id;
    const client = await prisma.client.create({
      data: {
        organizationId,
        name: 'Cliente Guard WhatsApp CI',
        phone,
      },
      select: { id: true },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    if (organizationId && clientId) {
      await prisma.whatsAppDailyDeliveryGuard.deleteMany({
        where: { organizationId, clientId },
      });
      await prisma.client.delete({ where: { id: clientId } }).catch(() => undefined);
    }
  });

  it('permite somente uma reserva por telefone no mesmo dia', async () => {
    await prisma.whatsAppDailyDeliveryGuard.create({
      data: {
        organizationId,
        clientId,
        phone,
        localDate: '2026-09-27',
        reason: 'DAILY_SUMMARY',
      },
    });

    await expect(prisma.whatsAppDailyDeliveryGuard.create({
      data: {
        organizationId,
        clientId,
        phone,
        localDate: '2026-09-27',
        reason: 'LOW_META_BALANCE',
      },
    })).rejects.toMatchObject<Partial<Prisma.PrismaClientKnownRequestError>>({
      code: 'P2002',
    });
  });

  it('libera nova mensagem apenas no próximo dia', async () => {
    const nextDay = await prisma.whatsAppDailyDeliveryGuard.create({
      data: {
        organizationId,
        clientId,
        phone,
        localDate: '2026-09-28',
        reason: 'DAILY_SUMMARY',
      },
    });
    expect(nextDay.localDate).toBe('2026-09-28');
  });
});
