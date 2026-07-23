import type { VercelRequest, VercelResponse } from "@vercel/node";

import dashboardHandler from "../server/dashboard.js";
import metaHandler from "../server/meta.js";
import usersHandler from "../server/users.js";
import loginHandler from "../server/auth/login.js";
import logoutHandler from "../server/auth/logout.js";
import meHandler from "../server/auth/me.js";
import setupStatusHandler from "../server/setup/status.js";
import setupInitializeHandler from "../server/setup/initialize.js";
import integrationHandler from "../server/integrations/[source].js";
import integrationMediaHandler from "../server/integrations/media.js";
import crmMetaHandler from "../server/crm/meta.js";
import crmDashboardHandler from "../server/crm/dashboard.js";
import crmLeadsHandler from "../server/crm/leads.js";
import crmHistoryHandler from "../server/crm/history.js";
import crmConversationsHandler from "../server/crm/conversations.js";
import crmManualLeadsHandler from "../server/crm/manual-leads.js";
import crmReportsHandler from "../server/crm/reports.js";
import crmDataReviewHandler from "../server/crm/data-review.js";
import crmKpiHandler from "../server/crm/kpi.js";
import crmTransferHandler from "../server/crm/transfer.js";
import crmSettingsHandler from "../server/crm/settings.js";
import crmInboxAgentHandler from "../server/crm/inbox-agent.js";
import crmUnreadHandler from "../server/crm/unread.js";
import crmMersalTemplatesHandler from "../server/crm/mersal-templates.js";
import crmEntryRoutingHandler from "../server/crm/entry-routing.js";
import crmAutomationSettingsHandler from "../server/crm/automation-settings.js";
import crmInboxHandler from "../server/crm/inbox.js";
import crmMediaHandler from "../server/crm/media.js";
import crmContactsHandler from "../server/crm/contacts.js";
import internalAutomationJobHandler from "../server/internal/automation-job.js";
import trackingOrdersHandler from "../server/tracking/orders.js";
import trackingPublicHandler from "../server/tracking/public.js";
import trackingSmsHandler from "../server/tracking/sms.js";
import trackingDeleteHandler from "../server/tracking/delete.js";
import trackingSettingsHandler from "../server/tracking/settings.js";
import trackingIntegrationHandler from "../server/integrations/tracking-orders.js";
import erpNextSalesOrderIntegrationHandler from "../server/integrations/erpnext-sales-order.js";
import operationsHandler from "../server/operations/index.js";
import marketingHandler from "../server/marketing/index.js";

type ApiHandler = (request: VercelRequest, response: VercelResponse) => unknown | Promise<unknown>;

const routes = new Map<string, ApiHandler>([
  ["dashboard", dashboardHandler],
  ["meta", metaHandler],
  ["users", usersHandler],
  ["auth/login", loginHandler],
  ["auth/logout", logoutHandler],
  ["auth/me", meHandler],
  ["setup/status", setupStatusHandler],
  ["setup/initialize", setupInitializeHandler],
  ["crm/meta", crmMetaHandler],
  ["crm/dashboard", crmDashboardHandler],
  ["crm/leads", crmLeadsHandler],
  ["crm/history", crmHistoryHandler],
  ["crm/conversations", crmConversationsHandler],
  ["crm/manual-leads", crmManualLeadsHandler],
  ["crm/reports", crmReportsHandler],
  ["crm/data-review", crmDataReviewHandler],
  ["crm/kpi", crmKpiHandler],
  ["crm/transfer", crmTransferHandler],
  ["crm/settings", crmSettingsHandler],
  ["crm/inbox-agent", crmInboxAgentHandler],
  ["crm/unread", crmUnreadHandler],
  ["crm/mersal-templates", crmMersalTemplatesHandler],
  ["crm/entry-routing", crmEntryRoutingHandler],
  ["crm/automation-settings", crmAutomationSettingsHandler],
  ["crm/inbox", crmInboxHandler],
  ["crm/media", crmMediaHandler],
  ["crm/contacts", crmContactsHandler],
  ["integrations/media", integrationMediaHandler],
  ["internal/automation-job", internalAutomationJobHandler],
  ["tracking/orders", trackingOrdersHandler],
  ["tracking/public", trackingPublicHandler],
  ["tracking/sms", trackingSmsHandler],
  ["tracking/delete", trackingDeleteHandler],
  ["tracking/settings", trackingSettingsHandler],
  ["integrations/tracking/orders", trackingIntegrationHandler],
  ["integrations/erpnext/sales-order", erpNextSalesOrderIntegrationHandler],
  ["operations", operationsHandler],
  ["marketing", marketingHandler],
]);

function valueAsPath(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.join("/");
  return String(value || "");
}

function resolveRoute(request: VercelRequest) {
  const rewrittenPath = valueAsPath(request.query.path);
  if (rewrittenPath) return rewrittenPath.replace(/^\/+|\/+$/g, "");

  const pathname = new URL(request.url || "/", "https://mzj.local").pathname;
  return pathname.replace(/^\/api\/?/, "").replace(/^\/+|\/+$/g, "");
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const route = resolveRoute(request);

  if (!route || route === "index") {
    return response.status(200).json({ ok: true, service: "mzj-platform-api", version: "1.19.0" });
  }

  if (route === "integrations/media") {
    return integrationMediaHandler(request, response);
  }

  if (route === "integrations/tracking/orders") {
    return trackingIntegrationHandler(request, response);
  }

  if (route === "integrations/erpnext/sales-order") {
    return erpNextSalesOrderIntegrationHandler(request, response);
  }

  if (route.startsWith("integrations/")) {
    const source = route.slice("integrations/".length).split("/")[0];
    request.query.source = source;
    return integrationHandler(request, response);
  }

  const routeHandler = routes.get(route);
  if (!routeHandler) {
    return response.status(404).json({ ok: false, error: "API route not found", route });
  }

  try {
    return await routeHandler(request, response);
  } catch (error) {
    console.error("Unhandled API route error", { route, error });
    if (response.headersSent) return;
    return response.status(500).json({ ok: false, error: "حدث خطأ غير متوقع في الخادم" });
  }
}
