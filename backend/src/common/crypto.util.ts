import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function encryptAes256(plainText: string, secret: string): string {
  const iv = randomBytes(16);
  const key = deriveKey(secret);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptAes256(payload: string, secret: string): string {
  const [ivHex, dataHex] = payload.split(':');
  if (!ivHex || !dataHex) {
    throw new Error('Invalid encrypted payload format.');
  }
  const key = deriveKey(secret);
  const iv = Buffer.from(ivHex, 'hex');
  const encryptedText = Buffer.from(dataHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  return decrypted.toString('utf8');
}
