import { describe, expect, it } from 'vitest';
import { buildCachedDirectory, chooseDirectoryConnection } from '../businessManagerDirectoryRoutes.js';

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

describe('Business Manager cached directory', () => {
  it('mantém BMs e contas disponíveis para seleção quando a Meta está temporariamente limitada', () => {
    const directory = buildCachedDirectory(
      [
        { metaBusinessId: 'bm-2', name: 'BM Dois', adminEmail: null, status: 'inactive', updatedAt: new Date('2026-09-01T10:00:00.000Z') },
        { metaBusinessId: 'bm-1', name: 'BM Um', adminEmail: 'admin@example.com', status: 'active', updatedAt: new Date('2026-09-02T10:00:00.000Z') },
        { metaBusinessId: 'bm-1', name: 'BM Um Antiga', adminEmail: null, status: 'inactive', updatedAt: new Date('2026-08-01T10:00:00.000Z') },
      ],
      [
        { accountId: 'act_111', name: 'Conta 111', currency: 'BRL', accountStatus: 1, businessId: 'bm-1', businessName: 'BM Um', updatedAt: new Date('2026-09-02T10:00:00.000Z') },
        { accountId: '111', name: 'Conta duplicada', currency: 'BRL', accountStatus: 1, businessId: 'bm-1', businessName: 'BM Um', updatedAt: new Date('2026-08-02T10:00:00.000Z') },
        { accountId: '222', name: 'Conta 222', currency: 'USD', accountStatus: 1, businessId: 'bm-2', businessName: 'BM Dois', updatedAt: new Date('2026-09-01T10:00:00.000Z') },
      ],
    );

    expect(directory).toHaveLength(2);
    expect(directory.find((item) => item.businessId === 'bm-1')?.businessName).toBe('BM Um');
    expect(directory.find((item) => item.businessId === 'bm-1')?.adAccounts).toHaveLength(1);
    expect(directory.find((item) => item.businessId === 'bm-1')?.adAccounts[0].accountId).toBe('111');
    expect(directory.find((item) => item.businessId === 'bm-2')?.adAccounts[0].accountId).toBe('222');
  });
});

describe('Business Manager directory connection resolution', () => {
  it('prioriza a conexão Meta global da ferramenta mesmo quando existe conexão legada da empresa', () => {
    const result = chooseDirectoryConnection('client-target', [
      candidate({ id: 'legacy-client', clientId: 'client-target', updatedAt: new Date('2026-09-01T10:00:00.000Z') }),
      candidate({ id: 'global', clientId: null, updatedAt: new Date('2026-08-31T10:00:00.000Z') }),
    ]);

    expect(result.connection?.id).toBe('global');
    expect(result.source).toBe('organization');
    expect(result.sourceClientId).toBeNull();
  });

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
