import argon2 from 'argon2';
import bcrypt from 'bcryptjs';

const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'];

export type PasswordVerification = {
  valid: boolean;
  upgradedHash?: string;
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<PasswordVerification> {
  if (!password || !storedHash) return { valid: false };

  try {
    if (storedHash.startsWith('$argon2')) {
      return { valid: await argon2.verify(storedHash, password) };
    }

    if (BCRYPT_PREFIXES.some((prefix) => storedHash.startsWith(prefix))) {
      const valid = await bcrypt.compare(password, storedHash);
      if (!valid) return { valid: false };

      return {
        valid: true,
        upgradedHash: await hashPassword(password),
      };
    }
  } catch {
    return { valid: false };
  }

  return { valid: false };
}
