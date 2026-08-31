import { describe, expect, it } from 'vitest';
import { chooseDirectoryConnection } from '../businessManagerDirectoryRoutes.js';

const candidate = (overrides: Partial<{
  id: string;
  clientId: string | null;
  metaUserId: string | null;
  accessTokenEncrypted: string;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  updatedAt: Date;
}> = {}) => ({
  id: 'conn-1',
  clientId: 'client-a',
  metaUserId: 'meta-user-1',
  accessTokenEncrypted: 'encrypted',
  tokenExpiresAt: null,
  scopes: 'ads_read,business_management',
  updatedAt: new Date('2026-08-31T12:00:00.000Z'),
  ...overrides,
});

describe('Business Manager directory connection resolution', () => {
  it('prioriza a conexão Meta específica da empresa', () => {
    const result = chooseDirectoryConnection('client-target', [
      candidate({ id: 'shared', clientId: 'client-a', updatedAt: new Date('2026-08-31T13:00:00.000Z') }),
      candidate({ id: 'own', clientId: 'client-target', updatedAt: new Date('2026-08-31T11:00:00.000Z') }),
    ]);

    expect(result.connection?.id).toBe('own');
    expect(result.source).toBe('client');
  });

  it('usa conexão de outra empresa quando todas pertencem ao mesmo usuário Meta', () => {
    const result = chooseDirectoryConnection('velluto', [
      candidate({ id: 'r2r', clientId: 'r2r', metaUserId: '1496478629162483' }),
      candidate({ id: 'ecojoi', clientId: 'ecojoi', metaUserId: '1496478629162483', updatedAt: new Date('2026-08-30T10:00:00.000Z') }),
    ]);

    expect(result.connection?.id).toBe('r2r');
    expect(result.source).toBe('organization');
  });

  it('bloqueia fallback quando existem usuários Meta diferentes', () => {
    const result = chooseDirectoryConnection('velluto', [
      candidate({ id: 'one', metaUserId: 'meta-user-1' }),
      candidate({ id: 'two', clientId: 'client-b', metaUserId: 'meta-user-2' }),
    ]);

    expect(result.connection).toBeNull();
    expect(result.source).toBe('ambiguous');
  });

  it('informa ausência quando não existe conexão Meta ativa', () => {
    const result = chooseDirectoryConnection('velluto', []);
    expect(result.connection).toBeNull();
    expect(result.source).toBe('none');
  });
});
