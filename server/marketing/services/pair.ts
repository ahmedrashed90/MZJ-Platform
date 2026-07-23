import { createHash } from "node:crypto";

export function createPairKey(creativeId: string, departmentCode: string, executionUserId: string, contentUserId: string) {
  return createHash("sha256")
    .update([creativeId, departmentCode, executionUserId, contentUserId].join(":"))
    .digest("hex")
    .slice(0, 32);
}
