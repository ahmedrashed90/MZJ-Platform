import { clean } from "./_tracking-utils.js";

export type ErpNextBranchUser = {
  email?: unknown;
  next_erp_user_id?: unknown;
  branch_code?: unknown;
  branch_name?: unknown;
} | null;

const AHMED_AYOUB_EMAIL = ["ahmedayob506", "gmail.com"].join("@");

function normalizedIdentity(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ـ]/g, "")
    .replace(/[\s_\-/]+/g, " ")
    .trim();
}

function canonicalBranchCode(value: unknown) {
  const identity = normalizedIdentity(value).replace(/^فرع\s+/, "");
  if (!identity) return "";
  if (["hall", "showroom", "الصاله"].includes(identity)) return "hall";
  if (["multaqa", "meetup", "الملتقى"].includes(identity)) return "multaqa";
  if (["qadisiyah", "qadisiya", "القادسيه"].includes(identity)) return "qadisiyah";
  if (["online", "الاونلاين", "الاون لاين"].includes(identity)) return "online";
  if (["customer service", "customer_service", "خدمه العملاء"].includes(identity)) return "customer_service";
  return "";
}

function isMainShafaBranch(value: unknown) {
  const identity = normalizedIdentity(value);
  return identity.includes("الفرع الرئيسي") && identity.includes("الشفا");
}

function isAhmedAyoub(erpUserId: unknown, platformUser: ErpNextBranchUser) {
  const identities = [erpUserId, platformUser?.email, platformUser?.next_erp_user_id]
    .map((value) => normalizedIdentity(value));
  return identities.includes(AHMED_AYOUB_EMAIL);
}

export function resolveErpNextTrackingBranchCode(input: {
  erpBranch: unknown;
  erpUserId: unknown;
  platformUser: ErpNextBranchUser;
}) {
  const rawBranch = clean(input.erpBranch);
  const erpBranchCode = canonicalBranchCode(rawBranch);

  if (erpBranchCode === "qadisiyah") return "qadisiyah";

  if (isMainShafaBranch(rawBranch)) {
    if (isAhmedAyoub(input.erpUserId, input.platformUser)) return "hall";
    const platformBranchCode = canonicalBranchCode(input.platformUser?.branch_code)
      || canonicalBranchCode(input.platformUser?.branch_name);
    if (platformBranchCode === "hall" || platformBranchCode === "multaqa") return platformBranchCode;
    return rawBranch;
  }

  return erpBranchCode || rawBranch;
}
