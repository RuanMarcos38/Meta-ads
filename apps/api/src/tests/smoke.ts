import assert from 'node:assert/strict';
import { Role } from '@prisma/client';
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

const clientUser = { role: Role.CLIENT, clientId: 'client-a' };
const requestedClientId = 'client-b';
const resolvedClientId = clientUser.role === Role.CLIENT ? clientUser.clientId : requestedClientId;

assert.equal(resolvedClientId, 'client-a');
assert.notEqual(resolvedClientId, requestedClientId);

console.log('Smoke tests passed.');
