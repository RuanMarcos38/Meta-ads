import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from './shared/prisma.js';
import { requireAuth, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';

const adminRoles = ['SUPER_ADMIN', 'AGENCY_ADMIN'] as const;

const clientIdSchema = z.object({ id: z.string().uuid() });
const updateClientSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  companyName: z.string().trim().max(180).nullable().optional(),
  document: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  segment: z.string().trim().max(120).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Informe ao menos um campo para atualizar.',
});

export async function registerClientManagementRoutes(app: FastifyInstance) {
  app.patch('/clients/:id', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = clientIdSchema.safeParse(req.params);
    const body = updateClientSchema.safeParse(req.body);

    if (!params.success || !body.success) {
      return reply.code(400).send(fail('VALIDATION', 'Dados da empresa inválidos.'));
    }

    const existing = await prisma.client.findFirst({
      where: {
        id: params.data.id,
        organizationId: user.organizationId!,
      },
    });

    if (!existing) {
      return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada.'));
    }

    const updated = await prisma.client.update({
      where: { id: existing.id },
      data: body.data,
    });

    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: 'UPDATE_CLIENT',
        entity: 'client',
        entityId: updated.id,
        metadataJson: {
          changedFields: Object.keys(body.data),
          previous: {
            name: existing.name,
            companyName: existing.companyName,
            document: existing.document,
            email: existing.email,
            phone: existing.phone,
            segment: existing.segment,
            status: existing.status,
          },
          current: {
            name: updated.name,
            companyName: updated.companyName,
            document: updated.document,
            email: updated.email,
            phone: updated.phone,
            segment: updated.segment,
            status: updated.status,
          },
        },
      },
    });

    return ok(updated, 'Empresa atualizada com sucesso.');
  });
}
