import { describe, expect, it } from 'vitest';
import { scopeClient } from '../shared/auth.js';

const baseUser = {
  id: 'user-1',
  organizationId: 'org-r2r',
};

const EMPTY_TENANT_UUID = '00000000-0000-0000-0000-000000000000';

describe('scopeClient', () => {
  it('ignora clientId solicitado por usuário CLIENT de empresa única', () => {
    expect(scopeClient({ ...baseUser, role: 'CLIENT', clientId: 'client-a' }, 'client-b'))
      .toBe('client-a');
  });

  it('restringe MANAGER de empresa única ao cliente atribuído', () => {
    expect(scopeClient({ ...baseUser, role: 'MANAGER', clientId: 'client-a' }, 'client-b'))
      .toBe('client-a');
  });

  it('permite CLIENT multiempresa selecionar outra empresa explicitamente vinculada', () => {
    expect(scopeClient({ ...baseUser, role: 'CLIENT', clientId: 'client-a', clientIds: ['client-a', 'client-b'] }, 'client-b'))
      .toBe('client-b');
  });

  it('bloqueia CLIENT multiempresa ao solicitar empresa não vinculada', () => {
    expect(scopeClient({ ...baseUser, role: 'CLIENT', clientId: 'client-a', clientIds: ['client-a', 'client-b'] }, 'client-c'))
      .toBe(EMPTY_TENANT_UUID);
  });

  it('nunca libera consolidado para CLIENT sem empresa atribuída', () => {
    expect(scopeClient({ ...baseUser, role: 'CLIENT' }, 'client-b'))
      .toBe(EMPTY_TENANT_UUID);
  });

  it('nunca libera consolidado para MANAGER sem empresa atribuída', () => {
    expect(scopeClient({ ...baseUser, role: 'MANAGER' }, 'client-b'))
      .toBe(EMPTY_TENANT_UUID);
  });

  it('permite filtro explícito para administrador', () => {
    expect(scopeClient({ ...baseUser, role: 'SUPER_ADMIN' }, 'client-b'))
      .toBe('client-b');
  });
});
