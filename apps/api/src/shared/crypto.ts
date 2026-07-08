import crypto from 'crypto';
import { env } from '../config/env.js';

const KEY = Buffer.from(env.encryptionKey, 'hex');
const ALGO = 'aes-256-gcm';

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}
