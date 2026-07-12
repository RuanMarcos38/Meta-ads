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

  it('permite filtro explícito para administrador', () => {
    expect(scopeClient({ ...baseUser, role: 'SUPER_ADMIN' }, 'client-b'))
      .toBe('client-b');
  });
});
