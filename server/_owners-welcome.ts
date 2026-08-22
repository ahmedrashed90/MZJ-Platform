import { getSql } from "./_db.js";
import { queueFirebaseSms } from "./_firebase-sms.js";
import { clean } from "./_crm-utils.js";
import { normalizePhone } from "./_phone-utils.js";
import { ensureOwnerMemberByPhone } from "./_owners.js";
import { ensureOwnersSchema } from "./_owners-schema.js";

export type OwnerWelcomeQueueResult = {
  status: "queued" | "already_sent" | "member_not_found" | "invalid_phone";
  memberId?: string;
  documentId?: string;
};

export async function queueOwnerWelcomeSms(input: {
  memberId?: unknown;
  phone?: unknown;
  byUid?: string | null;
  portalUrl: string;
}): Promise<OwnerWelcomeQueueResult> {
  await ensureOwnersSchema();
  const sql = getSql();
  const memberId = clean(input.memberId);
  let member: any = null;

  if (memberId) {
    [member] = await sql<any[]>`
      select *,id::text
      from owners.members
      where id=${memberId}::uuid and status='active'
      limit 1
    `;
  } else {
    member = await ensureOwnerMemberByPhone(input.phone);
  }

  if (!member) return { status: "member_not_found" };
  if (member.welcome_sent_at) return { status: "already_sent", memberId: member.id };

  const phone = normalizePhone(member.phone_normalized || input.phone);
  if (!phone) return { status: "invalid_phone", memberId: member.id };

  const customerName = clean(member.customer_name) || "عميل مجموعة محمد بن ذعار العجمي";
  const portalUrl = clean(input.portalUrl);
  const message = `مرحباً ${customerName}\nأهلاً بك في MZJ Owners Community.\nيمكنك الدخول إلى حسابك ومتابعة نقاطك ومكافآتك من هنا:\n${portalUrl}\n\nتاريخ تثق به`;

  const queued = await queueFirebaseSms({
    ...(input.byUid ? { byUid: input.byUid } : {}),
    createdAt: new Date(),
    message,
    meta: { type: "owners_welcome", purpose: "welcome", memberId: member.id },
    phone,
    source: "mzj_owners_community",
    status: "queued",
    to: phone,
  });

  await sql`
    update owners.members
    set welcome_sent_at=coalesce(welcome_sent_at,now()),updated_at=now()
    where id=${member.id}::uuid
  `;

  return { status: "queued", memberId: member.id, documentId: queued.documentId };
}
