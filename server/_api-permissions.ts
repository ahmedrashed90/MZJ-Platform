import type { VercelRequest } from "@vercel/node";

export type ApiPermissionRequirement = { code: string; systemCode: string; pageCode?: string; action?: string };

function clean(value: unknown) { return String(value ?? "").trim(); }
function bool(value: unknown) { return value === true || value === 1 || String(value ?? "").toLowerCase() === "true"; }
function body(request: VercelRequest) {
  if (request.body && typeof request.body === "object") return request.body as Record<string, any>;
  if (typeof request.body === "string") { try { return JSON.parse(request.body || "{}"); } catch { return {}; } }
  return {};
}
function req(code: string, systemCode: string, pageCode?: string, action?: string): ApiPermissionRequirement { return { code, systemCode, pageCode, action }; }

function crmRequirement(route: string, request: VercelRequest): ApiPermissionRequirement {
  const method = request.method || "GET";
  const payload = body(request);
  if (route === "crm/dashboard") return req("crm.dashboard.view", "crm", "dashboard", "view");
  if (route === "crm/meta") return req("system.crm.access", "crm", "dashboard", "meta");
  if (route === "crm/leads") {
    if (method === "GET") return req("crm.database.view", "crm", "database", "list");
    if (method === "POST") return req("crm.customer.create", "crm", "manual_leads", "create");
    if (method === "DELETE") return req("crm.customer.delete", "crm", "database", "delete");
    const fields = payload.patch && typeof payload.patch === "object" ? Object.keys(payload.patch) : Object.keys(payload);
    if (fields.some((field) => ["assignedTo", "assigned_to", "responsibleId"].includes(field))) return req("crm.customer.owner.change", "crm", "database", "owner_change");
    if (fields.some((field) => ["callCenterAssignedTo", "call_center_assigned_to"].includes(field))) return req("crm.customer.call_center.change", "crm", "database", "call_center_change");
    if (fields.some((field) => ["status", "statusLabel", "status_label"].includes(field))) return req("crm.customer.status.update", "crm", "database", "status_update");
    return req("crm.customer.update", "crm", "database", "update");
  }
  if (route === "crm/history") return req("crm.finance_history.view", "crm", "finance_history", "view");
  if (route === "crm/contacts") return method === "DELETE" ? req("crm.contacts.purge", "crm", "contacts", "purge") : req("crm.contacts.view", "crm", "contacts", "view");
  if (route === "crm/manual-leads") {
    if (method === "GET") return req("crm.manual_leads.view", "crm", "manual_leads", "view");
    if (method === "POST") return req("crm.manual_lead.request", "crm", "manual_leads", "request");
    if (method === "DELETE") return req("crm.manual_lead.delete", "crm", "manual_leads", "delete");
    const action = clean(payload.action);
    if (action === "reject") return req("crm.manual_lead.reject", "crm", "manual_leads", "reject");
    if (action === "edit") return req("crm.customer.update", "crm", "manual_leads", "edit");
    return req("crm.manual_lead.duplicate.approve", "crm", "manual_leads", "approve");
  }
  if (route === "crm/conversations") {
    if (method === "GET") return req("crm.conversation.view", "crm", "inbox_agent", "view");
    const kind = clean(payload.messageType || payload.type || payload.kind);
    if (["image", "video", "file", "audio", "document"].includes(kind) || payload.attachmentUrl || payload.fileId) return req("crm.conversation.send_media", "crm", "inbox_agent", "send_media");
    if (payload.templateName || payload.templateCode || payload.template) return req("crm.conversation.send_template", "crm", "inbox_agent", "send_template");
    return req("crm.conversation.send_text", "crm", "inbox_agent", "send_text");
  }
  if (route === "crm/inbox") return method === "GET" ? req("crm.inbox.view", "crm", "inbox", "view") : req("crm.conversation.classify", "crm", "inbox", "classify");
  if (route === "crm/inbox-agent") {
    if (method === "GET") return req("crm.inbox_agent.view", "crm", "inbox_agent", "view");
    if (method === "DELETE") return req("crm.conversation.mark_read", "crm", "inbox_agent", "delete_local");
    return req("crm.conversation.send_text", "crm", "inbox_agent", "send");
  }
  if (route === "crm/unread") return clean(payload.action) === "mark_unread" ? req("crm.conversation.mark_unread", "crm", "inbox_agent", "mark_unread") : req("crm.conversation.mark_read", "crm", "inbox_agent", "mark_read");
  if (route === "crm/reports") return req("crm.reports.view", "crm", "reports", "view");
  if (route === "crm/data-review") return req(method === "POST" && clean(payload.action) === "execute" ? "crm.data_review.execute" : "crm.data_review.view", "crm", "reports", clean(payload.action) || "view");
  if (route === "crm/kpi") {
    if (method === "GET") return req("crm.kpi.view", "crm", "kpi", "view");
    return req(method === "POST" ? "crm.kpi.rating.create" : "crm.kpi.rating.update", "crm", "kpi", "rating");
  }
  if (route === "crm/transfer") return req("crm.customer.bulk_transfer", "crm", "database", "bulk_transfer");
  if (route === "crm/settings" || route === "crm/entry-routing" || route === "crm/automation-settings") {
    if (method === "GET") return req("settings.crm.view", "core", "settings", "crm_settings_view");
    return req("settings.crm.manage", "core", "settings", "crm_settings_manage");
  }
  if (route === "crm/media") return method === "GET" ? req("crm.conversation.download", "crm", "inbox_agent", "download") : req("crm.conversation.send_media", "crm", "inbox_agent", "upload");
  if (route === "crm/mersal-templates") return req(method === "GET" ? "settings.crm.view" : "settings.crm.manage", "core", "settings", "crm_templates");
  return req("system.crm.access", "crm", "dashboard", "access");
}

function operationsRequirement(request: VercelRequest): ApiPermissionRequirement {
  const method = request.method || "GET";
  const resource = clean(request.query.resource) || "meta";
  const payload = body(request);
  if (method === "GET") {
    const map: Record<string, string> = {
      meta: "system.operations.access", vehicles: "operations.inventory.view", vehicle: "operations.vehicle.view",
      movements: "operations.movements.view", transfers: "operations.transfers.view", approvals: "operations.approvals.view",
      dashboard_vehicles: "operations.inventory.view", dashboard_requests: "operations.transfers.view", dashboard_shortages: "operations.inventory.view",
    };
    return req(map[resource] || "system.operations.access", "operations", resource, "view");
  }
  const action = clean(payload.action);
  const map: Record<string, string> = {
    create_vehicle: "operations.vehicle.create", update_vehicle: "operations.vehicle.edit", delete_vehicle: "operations.vehicle.delete",
    archive_vehicle: "operations.vehicle.archive", import_vehicles: "operations.vehicle.import", move_vehicles: "operations.movement.create",
    create_transfer: "operations.transfer.create", transfer_action: "operations.request.receive_order", approval_action: "operations.approval.financial",
    save_setting: "settings.operations.manage",
  };
  if (action === "approval_action" && clean(payload.type) === "administrative") return req("operations.approval.administrative", "operations", "approvals", action);
  if (action === "move_vehicles" && clean(payload.newStatus) === "delivered") return req("operations.movement.delivered", "operations", "movement", action);
  if (action === "transfer_action") {
    const workflow = clean(payload.workflowAction || payload.transferAction || payload.status || payload.nextStatus);
    const workflowMap: Record<string, string> = {
      receive_order: "operations.request.receive_order", received: "operations.request.receive_order",
      send_car: "operations.request.send_car", sent: "operations.request.send_car",
      receive_car: "operations.request.receive_car", car_received: "operations.request.receive_car",
      finish_order: "operations.request.finish_order", completed: "operations.request.finish_order",
      delete: "operations.transfer.delete", cancel: "operations.transfer.cancel", reopen: "operations.transfer.reopen", rollback: "operations.request.rollback", skip: "operations.request.skip",
    };
    return req(workflowMap[workflow] || "operations.request.receive_order", "operations", "transfers", workflow || action);
  }
  return req(map[action] || "system.operations.access", "operations", resource, action || "write");
}

function marketingRequirement(request: VercelRequest): ApiPermissionRequirement {
  const method = request.method || "GET";
  const resource = clean(request.query.resource) || "dashboard";
  if (method === "GET") {
    const map: Record<string, string> = {
      meta: "system.marketing.access", dashboard: "marketing.dashboard.view", database: "marketing.database.view", entity: "marketing.database.view",
      task: "marketing.task.view_assigned", packages: "marketing.packages.view", publish_prep: "marketing.publish_prep.view", monitoring: "marketing.monitoring.view",
      calendar: "marketing.calendar.view", receipt_calendar: "marketing.receipt_calendar.view", attendance: "marketing.attendance.view", stock: "marketing.stock.view",
      user_colors: "settings.marketing.view", platform_connections: "marketing.platforms.view", file: "marketing.file.download", campaign_code: "marketing.campaign.create",
    };
    return req(map[resource] || "system.marketing.access", "marketing", resource, "view");
  }
  const payload = body(request); const action = clean(payload.action);
  const map: Record<string, string> = {
    create_campaign: "marketing.campaign.create", create_agenda: "marketing.agenda.create", receive_task: "marketing.task.receive",
    upload_template: "system.marketing.access", review_template: "marketing.task_template.approve", toggle_task_action: "system.marketing.access",
    attach_final_file: "marketing.task.final_file.upload", prepare_upload: "marketing.file.upload", mark_file_ready: "marketing.file.upload",
    save_publish_prep: "marketing.publish_prep.manage", publish_now: "marketing.publish.now", save_result_file: "marketing.file.upload",
    archive_entity: "marketing.campaign.archive", delete_entity: "marketing.campaign.delete", attendance: "marketing.attendance.view",
    create_photo_request: "marketing.photo_request.create", complete_photo_request: "marketing.photo_request.complete", save_connection: "marketing.connections.manage",
    disconnect_connection: "marketing.connections.manage", migrate_connection_env: "marketing.connections.manage", create_raw_folders: "marketing.campaign.create",
    save_department: "settings.marketing.manage", save_assignment_action: "settings.marketing.manage", save_creative_type: "settings.marketing.manage",
    save_campaign_type: "settings.marketing.manage", save_platform: "settings.marketing.manage", delete_setting: "settings.marketing.manage", save_package: "settings.marketing.manage",
    save_user_colors: "settings.marketing.manage",
  };
  if (action === "review_template") {
    const review = clean(payload.reviewAction);
    return req(review === "approve" ? "marketing.task_template.approve" : "marketing.task_template.reject", "marketing", "dashboard", review);
  }
  if (action === "delete_entity") {
    return req(clean(payload.sourceType) === "agenda" ? "marketing.agenda.delete" : "marketing.campaign.delete", "marketing", "database", action);
  }
  if (action === "save_links") {
    return req(clean(payload.sourceType) === "agenda" ? "marketing.agenda.edit" : "marketing.campaign.edit", "marketing", "database", action);
  }
  if (action === "attendance") {
    const attendanceAction = clean(payload.attendanceAction);
    if (["save_settings", "edit"].includes(attendanceAction)) return req("marketing.attendance.manage", "marketing", "attendance", "manage");
    if (attendanceAction === "ping") return req("system.marketing.access", "marketing", "attendance", "presence_ping");
  }
  return req(map[action] || "system.marketing.access", "marketing", resource, action || "write");
}

function trackingRequirement(route: string, request: VercelRequest): ApiPermissionRequirement | null {
  if (route === "tracking/public") return null;
  const method = request.method || "GET"; const payload = body(request);
  if (route === "tracking/orders") {
    if (method === "GET") return req(clean(request.query.archived) === "true" ? "tracking.archive.view" : "tracking.orders.view", "tracking", "orders", "view");
    const action = clean(payload.action);
    if (action === "archive_order") return req(bool(payload.archived) ? "tracking.order.archive" : "tracking.order.restore", "tracking", "orders", action);
    return req("tracking.order.open", "tracking", "orders", action || "write");
  }
  if (route === "tracking/sms") return req("tracking.sms.send", "tracking", "orders", "sms");
  if (route === "tracking/delete") return req(method === "GET" ? "tracking.delete.view" : clean(payload.action) === "delete_deleted_record" ? "tracking.order.deleted.restore" : "tracking.order.delete", "tracking", "delete", "delete");
  if (route === "tracking/settings") return req(method === "GET" ? "settings.tracking.view" : "settings.tracking.manage", "core", "settings", method === "GET" ? "tracking_view" : "tracking_manage");
  return req("system.tracking.access", "tracking", "orders", "access");
}

export function resolveApiPermission(route: string, request: VercelRequest): ApiPermissionRequirement | null {
  if (["auth/login", "auth/logout", "auth/me", "setup/status", "setup/initialize", "tracking/public"].includes(route)) return null;
  if (route === "access-control" || route === "users" || route === "meta") return null;
  if (route === "dashboard") return req("platform.dashboard.view", "core", "dashboard", "view");
  if (route.startsWith("crm/")) return crmRequirement(route, request);
  if (route === "operations") return operationsRequirement(request);
  if (route === "marketing") return marketingRequirement(request);
  if (route.startsWith("tracking/")) return trackingRequirement(route, request);
  return null;
}
