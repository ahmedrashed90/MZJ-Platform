import type { VercelRequest } from "@vercel/node";
import type { SessionUser } from "../_auth.js";
import { getSql } from "../_db.js";
import { MarketingError, arrayValue, boolValue, clean, hasPermission, numberValue, pageValues } from "./common.js";

export async function listPackages(request: VercelRequest) {
  const sql = getSql();
  const { page, pageSize, offset } = pageValues(request);
  const search = clean(request.query.search);
  const category = clean(request.query.category);
  const pattern = `%${search}%`;
  const where = sql`p.is_archived=false and (${search}='' or p.name ilike ${pattern} or p.category ilike ${pattern}) and (${category}='' or p.category=${category})`;
  const [count] = await sql<{total:number}[]>`select count(*)::int total from marketing.packages p where ${where}`;
  const rows = await sql<any[]>`select p.*,p.id::text from marketing.packages p where ${where} order by p.category,p.price,p.name limit ${pageSize} offset ${offset}`;
  const categories = await sql<any[]>`select category,count(*)::int count from marketing.packages where is_archived=false group by category order by category`;
  return { ok: true, rows, total: Number(count?.total || 0), page, pageSize, categories };
}

export async function packageAction(user: SessionUser, body: Record<string, any>) {
  if (!hasPermission(user, "marketing.packages.manage")) throw new MarketingError(403, "إدارة الباقات متاحة للأدمن فقط", "FORBIDDEN");
  const sql = getSql();
  const action = clean(body.action);
  if (action === "save_package") {
    const id = clean(body.id);
    const name = clean(body.name);
    const category = clean(body.category);
    if (!name || !category) throw new MarketingError(400, "اسم الباقة والتصنيف مطلوبان", "VALIDATION_ERROR");
    const values = {
      price: Math.max(0, numberValue(body.price, 0)),
      discount: Math.max(0, Math.min(100, numberValue(body.cashDiscountPercent, 0))),
      registration: boolValue(body.includesRegistration),
      insurance: boolValue(body.includesInsurance),
      issuance: boolValue(body.includesIssuance),
      care: arrayValue(body.careFeatures).map(clean).filter(Boolean),
      delivery: ["home", "region"].includes(clean(body.deliveryType)) ? clean(body.deliveryType) : "home",
    };
    const [row] = id ? await sql<any[]>`
      update marketing.packages set name=${name},category=${category},price=${values.price},cash_discount_percent=${values.discount},includes_registration=${values.registration},includes_insurance=${values.insurance},includes_issuance=${values.issuance},care_features=${values.care},delivery_type=${values.delivery},updated_by=${user.id}::uuid,updated_at=now()
      where id=${id}::uuid and is_archived=false returning *,id::text
    ` : await sql<any[]>`
      insert into marketing.packages(name,category,price,cash_discount_percent,includes_registration,includes_insurance,includes_issuance,care_features,delivery_type,created_by,updated_by)
      values (${name},${category},${values.price},${values.discount},${values.registration},${values.insurance},${values.issuance},${values.care},${values.delivery},${user.id}::uuid,${user.id}::uuid) returning *,id::text
    `;
    if (!row) throw new MarketingError(404, "الباقة غير موجودة", "PACKAGE_NOT_FOUND");
    return { ok: true, row, message: id ? "تم تعديل الباقة" : "تم إنشاء الباقة" };
  }
  if (action === "archive_package") {
    const id = clean(body.id);
    const [row] = await sql<any[]>`update marketing.packages set is_archived=true,updated_by=${user.id}::uuid,updated_at=now() where id=${id}::uuid and is_archived=false returning id::text`;
    if (!row) throw new MarketingError(404, "الباقة غير موجودة", "PACKAGE_NOT_FOUND");
    return { ok: true, message: "تم حذف الباقة من العرض" };
  }
  throw new MarketingError(400, "إجراء الباقة غير مدعوم", "INVALID_ACTION");
}
