import { describe, expect, it } from 'vitest';
import { scopeClient } from '../shared/auth.js';

const baseUser = {
  id: 'user-1',
  organizationId: 'org-r2r',
};

describe('scopeClient', () => {
  it('ignora clientId solicitado por usuário CLIENT', () => {
    expect(scopeClient({ ...baseUser, role: 'CLIENT', clientId: 'client-a' }, 'client-b'))
      .toBe('client-a');
  });

  it('restringe MANAGER ao cliente atribuído', () => {
    expect(scopeClient({ ...baseUser, role: 'MANAGER', clientId: 'client-a' }, 'client-b'))
      .toBe('client-a');
  });

  it('nunca libera consolidado para CLIENT sem empresa atribuída', () => {
    expect(scopeClient({ ...baseUser, role: 'CLIENT' }, 'client-b'))
      .toBe('__no_assigned_client__');
  });

  it('nunca libera consolidado para MANAGER sem empresa atribuída', () => {
    expect(scopeClient({ ...baseUser, role: 'MANAGER' }, 'client-b'))
      .toBe('__no_assigned_client__');
  });

  it('permite filtro explícito para administrador', () => {
    expect(scopeClient({ ...baseUser, role: 'SUPER_ADMIN' }, 'client-b'))
      .toBe('client-b');
  });
});
