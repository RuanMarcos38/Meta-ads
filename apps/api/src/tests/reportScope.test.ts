import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerWorkspaceRoutes } from '../workspaceRoutes.js';

const mocks = vi.hoisted(() => ({ findMany: vi.fn().mockResolvedValue([]) }));
vi.mock('../shared/prisma.js', () => ({ prisma: { report: { findMany: mocks.findMany } } }));

const clientId = '00000000-0000-4000-8000-000000000001';
const adAccountId = '00000000-0000-4000-8000-000000000002';
const apps: ReturnType<typeof Fastify>[] = [];

async function setup() {
  const app = Fastify();
  apps.push(app);
  await app.register(jwt, { secret: 'isolated-report-route-test-secret' });
  await registerWorkspaceRoutes(app);
  await app.ready();
  const token = app.jwt.sign({ id: 'test-admin', organizationId: 'test-org', role: 'SUPER_ADMIN' });
  return { app, headers: { authorization: `Bearer ${token}` } };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.clearAllMocks();
});

describe('report list account scope', () => {
  it('passes organization, company, BM and selected account to the database', async () => {
    const { app, headers } = await setup();
    const response = await app.inject({ url: `/workspace/reports?clientId=${clientId}&businessId=test-bm&adAccountId=${adAccountId}`, headers });
    expect(response.statusCode).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledOnce();
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'test-org', clientId, businessId: 'test-bm', adAccountId });
  });

  it('keeps company-wide reports available when no account is selected', async () => {
    const { app, headers } = await setup();
    expect((await app.inject({ url: `/workspace/reports?clientId=${clientId}`, headers })).statusCode).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'test-org', clientId });
  });

  it('rejects invalid account IDs before querying the database', async () => {
    const { app, headers } = await setup();
    expect((await app.inject({ url: '/workspace/reports?adAccountId=invalid', headers })).statusCode).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('requires authentication before listing reports', async () => {
    const { app } = await setup();
    expect((await app.inject({ url: '/workspace/reports' })).statusCode).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
