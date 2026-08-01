import argon2 from 'argon2';
import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { verifyPassword } from './password.js';

describe('verifyPassword', () => {
  it('valida hash Argon2 sem solicitar migração', async () => {
    const hash = await argon2.hash('SenhaSegura123!');
    const result = await verifyPassword('SenhaSegura123!', hash);

    expect(result.valid).toBe(true);
    expect(result.upgradedHash).toBeUndefined();
  });

  it('valida hash bcrypt legado e gera hash Argon2 novo', async () => {
    const legacyHash = await bcrypt.hash('123456', 10);
    const result = await verifyPassword('123456', legacyHash);

    expect(result.valid).toBe(true);
    expect(result.upgradedHash?.startsWith('$argon2')).toBe(true);
  });

  it('recusa senha incorreta e hash malformado', async () => {
    const legacyHash = await bcrypt.hash('123456', 10);

    await expect(verifyPassword('senha-errada', legacyHash)).resolves.toEqual({ valid: false });
    await expect(verifyPassword('123456', 'hash-invalido')).resolves.toEqual({ valid: false });
  });
});
