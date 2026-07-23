import type { VercelRequest, VercelResponse } from "@vercel/node";
import { MarketingError, clean, parseBody, requireMarketingUser } from "./common.js";
import { createAgenda, createCampaign, campaignAction, campaignDetail, listCampaigns } from "./campaigns.js";
import { dashboard, calendar, reports, receiptCalendar } from "./dashboard.js";
import { attendanceAction, attendanceData } from "./attendance.js";
import { listPackages, packageAction } from "./packages.js";
import { platformConnections, listPublishPrep, platformAction, platformOAuthCallback, publishPrepAction } from "./publishing.js";
import { listPhotographyRequests, photographyAction, listStock } from "./stock.js";
import { listTasks, taskAction } from "./tasks.js";
import { marketingMeta, marketingSettingsAction, marketingSettingsData } from "./settings.js";

function queryText(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : clean(value);
}

function sendError(response: VercelResponse, error: unknown) {
  if (error instanceof MarketingError) {
    return response.status(error.status).json({ ok: false, error: error.message, code: error.code });
  }
  console.error("Marketing API error", error);
  return response.status(500).json({ ok: false, error: "تعذر تنفيذ طلب التسويق" });
}

export default async function marketingHandler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  const resource = queryText(request.query.resource) || "dashboard";
  const permissionByResource: Record<string, string> = {
    dashboard: "marketing.dashboard.view",
    campaigns: "marketing.campaigns.view",
    campaign: "marketing.campaigns.view",
    tasks: "marketing.tasks.view",
    publish_prep: "marketing.publish_prep.view",
    calendar: "marketing.campaigns.view",
    receipt_calendar: "marketing.tasks.view",
    reports: "marketing.reports.view",
    stock: "marketing.stock.view",
    photography_requests: "marketing.stock.view",
    packages: "marketing.packages.manage",
    attendance: "marketing.attendance.self",
    platforms: "marketing.platforms.manage",
    meta: "marketing.view",
    settings: "marketing.settings.manage",
    oauth_callback: "marketing.platforms.manage",
  };

  try {
    const user = await requireMarketingUser(request, response, permissionByResource[resource]);
    if (!user) return;

    if (request.method === "GET") {
      if (resource === "oauth_callback") return platformOAuthCallback(request, response, user);
      let result: unknown;
      switch (resource) {
        case "meta": result = await marketingMeta(user); break;
        case "dashboard": result = await dashboard(user); break;
        case "campaigns": result = await listCampaigns(request, user); break;
        case "campaign": result = await campaignDetail(queryText(request.query.id), user); break;
        case "tasks": result = await listTasks(request, user); break;
        case "publish_prep": result = await listPublishPrep(request, user); break;
        case "calendar": result = await calendar(request, user); break;
        case "receipt_calendar": result = await receiptCalendar(request, user); break;
        case "reports": result = await reports(request, user); break;
        case "stock": result = await listStock(request); break;
        case "photography_requests": result = await listPhotographyRequests(request); break;
        case "packages": result = await listPackages(request); break;
        case "attendance": result = await attendanceData(request, user); break;
        case "platforms": result = await platformConnections(user); break;
        case "settings": result = await marketingSettingsData(request, user); break;
        default: throw new MarketingError(404, "مورد التسويق غير موجود", "RESOURCE_NOT_FOUND");
      }
      return response.status(200).json(result);
    }

    if (request.method !== "POST") return response.status(405).json({ ok: false, error: "طريقة الطلب غير مدعومة" });
    const body = parseBody(request.body);
    const action = clean(body.action);
    let result: unknown;

    if (action === "create_campaign") result = await createCampaign(user, body);
    else if (action === "create_agenda") result = await createAgenda(user, body);
    else if (["update_campaign", "archive_campaign", "release_campaign", "delete_campaign"].includes(action)) result = await campaignAction(user, body);
    else if (["prepare_task_upload", "download_task_file", "receive_task", "start_task", "complete_task_action", "undo_task_action", "finalize_task_upload", "review_template", "mark_content_done", "review_final_file"].includes(action)) result = await taskAction(user, body);
    else if (["save_publish_prep", "execute_publish_target"].includes(action)) result = await publishPrepAction(user, body);
    else if (["disconnect_platform", "begin_platform_oauth", "list_platform_accounts", "select_platform_account"].includes(action)) result = await platformAction(request, user, body);
    else if (action === "create_photography_request") result = await photographyAction(user, body);
    else if (action.startsWith("photography_")) result = await photographyAction(user, body);
    else if (["save_package", "archive_package"].includes(action)) result = await packageAction(user, body);
    else if (action.startsWith("attendance_")) result = await attendanceAction(user, body, String(request.headers["user-agent"] || ""));
    else if (["save_marketing_setting", "save_attendance_settings", "save_catalog_item", "archive_catalog_item", "save_department", "save_workflow", "save_platform_catalog", "import_whatsapp_contacts", "clear_whatsapp_contacts"].includes(action)) result = await marketingSettingsAction(user, body);
    else throw new MarketingError(400, "إجراء التسويق غير مدعوم", "INVALID_ACTION");

    return response.status(200).json(result);
  } catch (error) {
    return sendError(response, error);
  }
}
