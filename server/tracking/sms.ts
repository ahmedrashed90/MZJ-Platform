import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { queueFirebaseSms } from "../_firebase-sms.js";
import { requireTrackingUser } from "../_tracking-auth.js";
import { hasPermission } from "../_access-control.js";
import { trackingAccessScope } from "../_tracking-access.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { ensureCrmSchema } from "../_crm-schema.js";
import { queueOwnerWelcomeSms } from "../_owners-welcome.js";
import { ensureOwnerMemberByPhone } from "../_owners.js";
import { clean, normalizeSaudiPhone, publicTrackingUrl } from "../_tracking-utils.js";
import { effectiveTrackingSmsTemplate, renderTrackingSmsTemplate } from "../_tracking-message-templates.js";

function formatMoney(value: unknown) {
  const number = Number(value || 0);
  return number.toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function requestOrigin(request: VercelRequest) {
  const protocol = String(request.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "mzj-platform.vercel.app").split(",")[0];
  return `${protocol}://${host}`;
}

function messageForStage(order: any, vehicle: any, stage: any, link: string, club?: { personalCode?: unknown; portalUrl?: unknown }) {
  const customer = clean(order.customer_name) || "عميلنا العزيز";
  const template = effectiveTrackingSmsTemplate(stage.sort_order, stage.sms_message_template, stage.sms_message_template_legacy, stage.sms_message_mode);
  if (template) {
    return renderTrackingSmsTemplate(template, {
      customer_name: customer,
      tracking_link: link,
      order_no: clean(order.sales_order_no),
      stage_name: clean(stage.name),
      car_name: clean(vehicle.car_name),
      vin: clean(vehicle.vin).startsWith("PENDING-") ? "" : clean(vehicle.vin),
      vehicles_count: Number(order.vehicles_count || 1),
      subtotal_before_tax: formatMoney(order.subtotal_before_tax),
      tax_value: formatMoney(order.tax_value),
      total_incl_vat: formatMoney(order.total_incl_vat),
      personal_code: clean(club?.personalCode),
      portal_url: clean(club?.portalUrl),
    });
  }
  return `عميلنا العزيز / ${customer}\nتم تحديث طلبكم رقم ${order.sales_order_no}: ${stage.name}\nمتابعة الطلب: ${link}`;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  await Promise.all([ensureTrackingSchema(), ensureCrmSchema()]);
  const user = await requireTrackingUser(request, response);
  if (!user) return;

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const orderId = clean(body.orderId);
  const vehicleId = clean(body.vehicleId);
  const stageId = clean(body.stageId);
  if (!orderId || !vehicleId || !stageId) return response.status(400).json({ ok: false, error: "الطلب والسيارة والمرحلة مطلوبة" });

  const sql = getSql();
  const [row] = await sql<any[]>`
    select o.*,o.id::text,o.assigned_to::text,
      (select count(*) from tracking.order_vehicles vx where vx.order_id=o.id)::int as vehicles_count,
      v.id::text as vehicle_id,v.vin,v.item_no,v.car_name,
      s.id::text as stage_id,s.name as stage_name,s.sort_order,s.sms_enabled,s.sms_message_template,s.sms_message_template_legacy,s.sms_message_mode,o.tracking_token
    from tracking.orders o
    join tracking.order_vehicles v on v.order_id=o.id and v.id=${vehicleId}::uuid
    join tracking.stages s on s.id=${stageId}::uuid
    where o.id=${orderId}::uuid and coalesce(o.is_deleted,false)=false
  `;
  if (!row) return response.status(404).json({ ok: false, error: "لم يتم العثور على بيانات الرسالة" });
  if (row.is_cancelled) return response.status(400).json({ ok: false, error: "طلب البيع ملغي من NEXT ERP ولا يمكن إرسال SMS+ له" });
  const scope = trackingAccessScope(user);
  const workflowAssigned = scope.workflowAssignedOnly
    ? Boolean((await sql<any[]>`select 1 from tracking.stage_events where order_id=${row.id}::uuid and actor_id=${user.id}::uuid limit 1`)[0])
    : false;
  const inScope = scope.unrestricted
    || (scope.assignedOnly && clean(row.assigned_to) === user.id)
    || (scope.workflowAssignedOnly && workflowAssigned)
    || (scope.branchScoped && scope.branchCodes.includes(clean(row.branch)));
  if (!inScope) return response.status(403).json({ ok: false, error: "الطلب خارج نطاق بياناتك" });
  const stageNo = String(Number(row.sort_order || 0)).padStart(2, "0");
  const stagePermission = `tracking.stage.${stageNo}.sms`;
  if (!hasPermission(user, stagePermission)) return response.status(403).json({ ok: false, error: "لا توجد صلاحية لإرسال رسالة هذه المرحلة", permission: stagePermission });
  if (row.is_archived) return response.status(400).json({ ok: false, error: "الطلب مؤرشف ولا يمكن إرسال رسائل جديدة له" });
  if (!row.sms_enabled) return response.status(400).json({ ok: false, error: "إرسال SMS+ غير مفعّل لهذه المرحلة" });

  const phone = normalizeSaudiPhone(row.customer_mobile);
  if (!phone) return response.status(400).json({ ok: false, error: "رقم جوال العميل غير صالح أو غير موجود" });
  const origin = requestOrigin(request);
  const link = publicTrackingUrl(origin, row.tracking_token);
  const clubPortalUrl = `${origin}/club`;
  const stage10Member = Number(row.sort_order) === 10 ? await ensureOwnerMemberByPhone(row.customer_mobile) : null;
  const message = clean(body.message) || messageForStage(
    row,
    row,
    { name: row.stage_name, sort_order: row.sort_order, sms_message_template: row.sms_message_template, sms_message_template_legacy: row.sms_message_template_legacy, sms_message_mode: row.sms_message_mode },
    link,
    { personalCode: stage10Member?.referral_code, portalUrl: clubPortalUrl },
  );
  let automaticWelcomeEnabled = false;
  if (Number(row.sort_order) === 10) {
    const [settings] = await sql<any[]>`
      select tracking_final_delivery_welcome_enabled
      from crm.crm_runtime_settings
      where id='default'
      limit 1
    `;
    automaticWelcomeEnabled = settings?.tracking_final_delivery_welcome_enabled === true;
  }

  try {
    const queued = await queueFirebaseSms({
      byUid: user.id,
      createdAt: new Date(),
      message,
      meta: {
        orderId: row.sales_order_no,
        stageLabel: `${row.sort_order}) ${row.stage_name}`,
        stageNum: Number(row.sort_order),
        vin: row.vin.startsWith("PENDING-") ? "" : row.vin,
      },
      phone,
      source: "sales.html",
      status: "queued",
      to: phone,
    });

    await sql`
      insert into tracking.sms_messages(order_id,vehicle_id,stage_id,phone,message,firestore_document_id,status,queued_by,queued_by_name)
      values (${orderId}::uuid,${vehicleId}::uuid,${stageId}::uuid,${phone},${message},${queued.documentId},'queued',${user.id}::uuid,${user.fullName})
    `;
    await sql`
      insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
      values (${user.id}::uuid,'tracking','sms_queued','tracking_order',${row.sales_order_no},${sql.json({ vehicleId, stageId, phone, firestoreDocumentId: queued.documentId })})
    `;

    let welcome: { status: string; documentId?: string; error?: string } = {
      status: automaticWelcomeEnabled ? "pending" : "disabled",
    };
    if (automaticWelcomeEnabled) {
      try {
        const welcomeResult = await queueOwnerWelcomeSms({
          phone,
          byUid: user.id,
          portalUrl: clubPortalUrl,
        });
        welcome = { status: welcomeResult.status, documentId: welcomeResult.documentId };
        await sql`
          insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
          values (${user.id}::uuid,'tracking','owners_welcome_auto','tracking_order',${row.sales_order_no},${sql.json({ vehicleId, stageId, phone, status: welcomeResult.status, firestoreDocumentId: welcomeResult.documentId || null })})
        `;
      } catch (welcomeError) {
        const welcomeErrorMessage = welcomeError instanceof Error ? welcomeError.message : "تعذر إرسال رسالة الترحيب عبر SMS+";
        welcome = { status: "failed", error: welcomeErrorMessage };
        await sql`
          insert into audit.activity_log(user_id,system_code,action,entity_type,entity_id,after_data)
          values (${user.id}::uuid,'tracking','owners_welcome_auto_failed','tracking_order',${row.sales_order_no},${sql.json({ vehicleId, stageId, phone, error: welcomeErrorMessage })})
        `.catch(() => undefined);
      }
    }

    const responseMessage = welcome.status === "queued"
      ? "تم إرسال رسالة التتبع إلى SMS+ وإضافة رسالة الترحيب تلقائيًا"
      : welcome.status === "already_sent"
        ? "تم إرسال رسالة التتبع إلى SMS+؛ رسالة الترحيب سبق إرسالها لهذا العميل"
        : welcome.status === "failed"
          ? "تم إرسال رسالة التتبع إلى SMS+، لكن تعذر إضافة رسالة الترحيب تلقائيًا"
          : "تم إرسال الرسالة إلى SMS+ وجارٍ إرسالها من التطبيق";

    return response.status(200).json({
      ok: true,
      status: "queued",
      documentId: queued.documentId,
      message: responseMessage,
      welcome,
    });
  } catch (error) {
    console.error("Firebase SMS queue failed", error);
    return response.status(500).json({ ok: false, error: error instanceof Error ? error.message : "تعذر إرسال الرسالة إلى SMS+" });
  }
}
