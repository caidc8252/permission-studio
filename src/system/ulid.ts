import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encode(value: bigint, length: number): string {
  let result = "";
  let remaining = value;
  for (let index = 0; index < length; index += 1) {
    result = `${ALPHABET[Number(remaining & 31n)]}${result}`;
    remaining >>= 5n;
  }
  return result;
}

export function generateUlid(now = Date.now()): string {
  const random = randomBytes(10);
  let randomness = 0n;
  for (const byte of random) randomness = (randomness << 8n) | BigInt(byte);
  return `${encode(BigInt(now), 10)}${encode(randomness, 16)}`;
}
