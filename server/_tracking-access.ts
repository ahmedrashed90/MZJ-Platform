import type { SessionUser } from "./_auth.js";
import { getSystemAccess } from "./_access-control.js";

export type TrackingAccessScope = {
  unrestricted: boolean;
  assignedOnly: boolean;
  workflowAssignedOnly: boolean;
  branchScoped: boolean;
  branchCodes: string[];
};

/**
 * Resolves the tracking data scope once so every tracking endpoint applies the
 * same visibility rules. In particular, "assigned" never falls back to branch
 * visibility: the order must be linked to the current platform user.
 */
export function trackingAccessScope(user: SessionUser): TrackingAccessScope {
  const access = getSystemAccess(user, "tracking");
  const unrestricted = access.dataScope === "all";
  const assignedOnly = ["self", "assigned", "created_by_me"].includes(access.dataScope);
  const workflowAssignedOnly = access.dataScope === "workflow_assigned";

  return {
    unrestricted,
    assignedOnly,
    workflowAssignedOnly,
    branchScoped: !unrestricted && !assignedOnly && !workflowAssignedOnly,
    branchCodes: access.branchCodes.length ? access.branchCodes : ["__none__"],
  };
}
