import type { SessionUser } from "../../_auth.js";
import { hasMarketingPermission } from "../auth.js";

const transitions: Record<string, string[]> = {
  pending_template: ["template_submitted", "cancelled"],
  template_submitted: ["changes_requested", "template_approved", "rejected"],
  changes_requested: ["template_submitted", "in_progress", "cancelled"],
  template_approved: ["content_done"],
  content_done: [],
  blocked_by_template: ["ready", "cancelled"],
  ready: ["received", "cancelled"],
  received: ["in_progress", "cancelled"],
  in_progress: ["under_review", "changes_requested", "cancelled"],
  under_review: ["completed", "changes_requested"],
  completed: [],
  cancelled: [],
};

export function assertTaskTransition(user: SessionUser, current: string, next: string, assignedTo: string | null) {
  if (!(transitions[current] || []).includes(next)) throw new Error("TASK_TRANSITION_NOT_ALLOWED");
  const adminAction = ["template_approved", "changes_requested", "completed", "cancelled", "ready"].includes(next);
  if (adminAction && !hasMarketingPermission(user, "marketing.tasks.review") && !hasMarketingPermission(user, "marketing.tasks.admin_actions")) {
    throw new Error("TASK_REVIEW_PERMISSION_REQUIRED");
  }
  if (!adminAction && assignedTo && assignedTo !== user.id && !hasMarketingPermission(user, "marketing.tasks.admin_actions")) {
    throw new Error("TASK_NOT_ASSIGNED_TO_USER");
  }
}
