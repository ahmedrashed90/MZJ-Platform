import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_db.js";
import { queueFirebaseSms } from "../_firebase-sms.js";
import { requireTrackingUser } from "../_tracking-auth.js";
import { ensureTrackingSchema } from "../_tracking-schema.js";
import { clean, normalizeSaudiPhone, publicTrackingUrl } from "../_tracking-utils.js";

function formatMoney(value: unknown) {
  const number = Number(value || 0);
  return number.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function requestOrigin(request: VercelRequest) {
  const protocol = String(request.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "mzj-platform.vercel.app").split(",")[0];
  return `${protocol}://${host}`;
}

function messageForStage(order: any, vehicle: any, stage: any, link: string) {
  const customer = clean(order.customer_name) || "عميلنا العزيز";
  if (Number(stage.sort_order) === 1) {
    return `عميلنا العزيز / ${customer}\nمرحباً بكم في مجموعة محمد ذعار العجمي للسيارات\nتم تسجيل طلب شرائكم بنجاح ✅\nعدد السيارات: ${Number(order.vehicles_count || 1)}\nالإجمالي قبل الضريبة: ${formatMoney(order.subtotal_before_tax)} ر.س\nقيمة الضريبة: ${formatMoney(order.tax_value)} ر.س\nالإجمالي شامل الضريبة: ${formatMoney(order.total_incl_vat)} ر.س\nيمكنكم متابعة حالة الطلب عبر الرابط التالي:\n${link}\nمع مجموعة محمد ذعار العجمي للسيارات أنت نجم الطريق ⭐\n📞 920014635\nرابط التواصل واتساب https://api.whatsapp.com/send?phone=966920014635`;
  }
  if (Number(stage.sort_order) === 9) {
    return `عميلنا العزيز / ${customer}\nيسعدنا إبلاغك بجاهزية سيارتك، الآن يمكنك الحضور للاستلام أو طلب خدمة الشحن.\nنشكرك على ثقتك، مع محمد ذعار العجمي للسيارات أنت نجم الطريق ⭐\n\nمواعيد العمل:\nالفترة الصباحية من الساعة 9 صباحاً إلى 11 صباحاً\nالفترة المسائية من الساعة 4 مساءً إلى 9 مساءً\nيوم الجمعة المساء فقط\n\nمتابعة الطلب: ${link}`;
  }
  if (Number(stage.sort_order) === 10) {
    return `عميلنا العزيز / ${customer}\nنبارك لكم إتمام عملية التسليم بنجاح.\nيشرفنا في مجموعة محمد ذعار العجمي للسيارات خدمتكم، ونتمنى لكم قيادة آمنة وتجربة ممتعة.\n#نجم_الطريق`;
  }
  return `عميلنا العزيز / ${customer}\nتم تحديث طلبكم رقم ${order.sales_order_no}: ${stage.name}\nمتابعة الطلب: ${link}`;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, error: "Method not allowed" });
  await ensureTrackingSchema();
  const user = await requireTrackingUser(request, response);
  if (!user) return;

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const orderId = clean(body.orderId);
  const vehicleId = clean(body.vehicleId);
  const stageId = clean(body.stageId);
  if (!orderId || !vehicleId || !stageId) return response.status(400).json({ ok: false, error: "الطلب والسيارة والمرحلة مطلوبة" });

  const sql = getSql();
  const [row] = await sql<any[]>`
    select o.*,o.id::text,
      (select count(*) from tracking.order_vehicles vx where vx.order_id=o.id)::int as vehicles_count,
      v.id::text as vehicle_id,v.vin,v.item_no,v.car_name,
      s.id::text as stage_id,s.name as stage_name,s.sort_order,s.sms_enabled
    from tracking.orders o
    join tracking.order_vehicles v on v.order_id=o.id and v.id=${vehicleId}::uuid
    join tracking.stages s on s.id=${stageId}::uuid
    where o.id=${orderId}::uuid and coalesce(o.is_deleted,false)=false
  `;
  if (!row) return response.status(404).json({ ok: false, error: "لم يتم العثور على بيانات الرسالة" });
  if (row.is_archived) return response.status(400).json({ ok: false, error: "الطلب مؤرشف ولا يمكن إرسال رسائل جديدة له" });
  if (!row.sms_enabled) return response.status(400).json({ ok: false, error: "إرسال SMS+ غير مفعّل لهذه المرحلة" });

  const phone = normalizeSaudiPhone(row.customer_mobile);
  if (!phone) return response.status(400).json({ ok: false, error: "رقم جوال العميل غير صالح أو غير موجود" });
  const link = publicTrackingUrl(requestOrigin(request), row.vin, row.sales_order_no);
  const message = clean(body.message) || messageForStage(row, row, { name: row.stage_name, sort_order: row.sort_order }, link);

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
    return response.status(200).json({ ok: true, status: "queued", documentId: queued.documentId, message: "تم إرسال الرسالة إلى SMS+ وجارٍ إرسالها من التطبيق" });
  } catch (error) {
    console.error("Firebase SMS queue failed", error);
    return response.status(500).json({ ok: false, error: error instanceof Error ? error.message : "تعذر إرسال الرسالة إلى SMS+" });
  }
}
