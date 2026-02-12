/**
 * Shared ID helpers.
 */

const randomValues = (buffer: Uint8Array): Uint8Array => {
  const cryptoValue = globalThis.crypto;

  if (cryptoValue?.getRandomValues) {
    return cryptoValue.getRandomValues(buffer);
  }

  for (let index = 0; index < buffer.length; index += 1) {
    buffer[index] = Math.floor(Math.random() * 256);
  }

  return buffer;
};

/**
 * Generate a UUID v4 string.
 * @returns {string}
 */
export const createUuid = (): string => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const bytes = randomValues(new Uint8Array(16));
  const byte6 = bytes[6] ?? 0;
  const byte8 = bytes[8] ?? 0;
  bytes[6] = (byte6 & 0x0f) | 0x40;
  bytes[8] = (byte8 & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
