import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { fail } from '../../common/domain';

const options = {N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024};
const dummySalt = randomBytes(16);
const dummyDigest = randomBytes(32);
const derive = (password: string, salt: Buffer): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 32, options, (error, key) => error ? reject(error) : resolve(key));
});
export function account(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9._-]{3,64}$/i.test(value)) fail('VALIDATION_ERROR', '账号需为3至64位字母、数字或._-');
  return value.toLowerCase();
}
export function password(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail('VALIDATION_ERROR', '密码需为12至128个字符');
  return value;
}
export async function hashPassword(value: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password(value), salt);
  return `scrypt$1$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(value: string, encoded: string | null | undefined): Promise<boolean> {
  const match = typeof encoded === 'string' ? /^scrypt\$1\$16384\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded) : null;
  const actual = await derive(value, match ? Buffer.from(match[1], 'hex') : dummySalt);
  return timingSafeEqual(actual, match ? Buffer.from(match[2], 'hex') : dummyDigest) && !!match;
}
