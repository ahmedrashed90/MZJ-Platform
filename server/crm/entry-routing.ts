import type { VercelRequest, VercelResponse } from "@vercel/node";
import { audit, clean, parseBody, requireCrmPermission, requireCrmUser } from "../_crm-utils.js";
import { getSql } from "../_db.js";

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = await requireCrmUser(request, response);
  if (!user) return;
  const sql = getSql();

  if (request.method === "GET") {
    if (!(await requireCrmPermission(user, response, "crm.settings.view"))) return;
    const [settings] = await sql<any[]>`select * from crm.automation_settings where id='default'`;
    return response.status(200).json({ ok: true, settings });
  }

  if (!["PUT", "PATCH", "POST"].includes(request.method || "")) {
    return response.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!(await requireCrmPermission(user, response, "crm.settings.manage"))) return;

  const body = parseBody(request);
  const section = clean(body.section);
  if (section && section !== "entry_routing" && section !== "settings") {
    return response.status(400).json({ ok: false, error: "هذا القسم مخصص فقط لإعدادات دخول وتوزيع العملاء" });
  }

  const serviceOptions = array(body.serviceOptions)
    .map((item: any) => ({
      key: clean(item.key),
      label: clean(item.label),
      aliases: array(item.aliases).map(clean).filter(Boolean),
    }))
    .filter((item: any) => item.key && item.label);

  if (!serviceOptions.length) return response.status(400).json({ ok: false, error: "أضف خدمة واحدة على الأقل" });

  const [row] = await sql<any[]>`
    update crm.automation_settings set
      service_selection_enabled=${body.serviceSelectionEnabled !== false},
      service_selection_message=${clean(body.serviceSelectionMessage)},
      service_options=${sql.json(serviceOptions)},
      ask_for_branch=false,
      no_match_behavior=${clean(body.noMatchBehavior) || "wait"},
      unclassified_label=${clean(body.unclassifiedLabel) || "بانتظار اختيار الخدمة"},
      updated_by=${user.id}::uuid,
      updated_at=now()
    where id='default'
    returning *
  `;

  await audit(user, "entry_routing_settings_updated", "automation_settings", "default", row);
  return response.status(200).json({ ok: true, row });
}
