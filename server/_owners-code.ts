import crypto from "node:crypto";
import { getSql } from "./_db.js";

export const OWNER_CODE_PREFIX = "SD96";
const OWNER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const OWNER_CODE_RANDOM_LENGTH = 8;

export function randomOwnerCode() {
  const bytes = crypto.randomBytes(OWNER_CODE_RANDOM_LENGTH);
  let suffix = "";
  for (let index = 0; index < OWNER_CODE_RANDOM_LENGTH; index += 1) {
    suffix += OWNER_CODE_ALPHABET[bytes[index] % OWNER_CODE_ALPHABET.length];
  }
  return `${OWNER_CODE_PREFIX}${suffix}`;
}

export async function uniqueOwnerCode(reservedCodes?: Set<string>) {
  const sql = getSql();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = randomOwnerCode();
    if (reservedCodes?.has(candidate)) continue;
    const [exists] = await sql<any[]>`
      select 1
      where exists(select 1 from owners.members where referral_code=${candidate})
         or exists(select 1 from owners.legacy_customer_codes where referral_code=${candidate})
      limit 1
    `;
    if (exists) continue;
    reservedCodes?.add(candidate);
    return candidate;
  }
  throw new Error("تعذر إنشاء كود عميل فريد");
}
