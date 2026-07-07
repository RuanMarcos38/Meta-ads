import assert from 'node:assert/strict';
import { Role } from '@prisma/client';
import { canManageRole, isClientScopedRole, isInternalRole } from '../services/accessControl.js';
import { normalizeMetric } from '../services/normalizer.js';

const metric = normalizeMetric({
  platform: 'GOOGLE',
  adAccountExternalId: '123',
  campaignExternalId: 'abc',
  campaignName: 'Teste',
  date: '2026-07-07',
  spend: 100,
  impressions: 1000,
  clicks: 50,
  conversions: 10,
  purchaseValue: 250
});

assert.equal(metric.ctr, 5);
assert.equal(metric.cpc, 2);
assert.equal(metric.cpm, 100);
assert.equal(metric.costPerResult, 10);
assert.equal(metric.roas, 2.5);

const clientUser = { role: Role.USER, clientId: 'client-a' };
const requestedClientId = 'client-b';
const resolvedClientId = isClientScopedRole(clientUser.role) ? clientUser.clientId : requestedClientId;

assert.equal(resolvedClientId, 'client-a');
assert.notEqual(resolvedClientId, requestedClientId);
assert.equal(isClientScopedRole(Role.CLIENT), true);
assert.equal(isClientScopedRole(Role.USER), true);
assert.equal(isInternalRole(Role.COMPANY_ADMIN), true);
assert.equal(canManageRole(Role.SUPER_ADMIN, Role.COMPANY_ADMIN), true);
assert.equal(canManageRole(Role.COMPANY_ADMIN, Role.MANAGER), true);
assert.equal(canManageRole(Role.COMPANY_ADMIN, Role.SUPER_ADMIN), false);
assert.equal(canManageRole(Role.MANAGER, Role.USER), true);
assert.equal(canManageRole(Role.MANAGER, Role.COMPANY_ADMIN), false);

console.log('Smoke tests passed.');
