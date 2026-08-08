import type { AuthUser } from "./auth/AuthContext";
import {
  canAccessSystem as sharedCanAccessSystem,
  canOpenSettings as sharedCanOpenSettings,
  firstAllowedPage,
  hasPermission as sharedHasPermission,
  isPlatformAdmin as sharedIsPlatformAdmin,
  type PlatformSystem,
} from "../shared/access-control";

export type { PlatformSystem };

export function hasPermission(user: AuthUser | null | undefined, permission: string) {
  return sharedHasPermission(user, permission);
}

export function isPlatformAdmin(user: AuthUser | null | undefined) {
  return sharedIsPlatformAdmin(user);
}

export function canAccessCrm(user: AuthUser | null | undefined) { return sharedCanAccessSystem(user, "crm"); }
export function canAccessMarketing(user: AuthUser | null | undefined) { return sharedCanAccessSystem(user, "marketing"); }
export function canAccessOperations(user: AuthUser | null | undefined) { return sharedCanAccessSystem(user, "operations"); }
export function canAccessTracking(user: AuthUser | null | undefined) { return sharedCanAccessSystem(user, "tracking"); }
export function canAccessSystem(user: AuthUser | null | undefined, system: PlatformSystem) { return sharedCanAccessSystem(user, system); }
export function canOpenSettings(user: AuthUser | null | undefined) { return sharedCanOpenSettings(user); }

export function defaultSystemPath(user: AuthUser | null | undefined) {
  if (!user) return "/help";
  if (hasPermission(user, "platform.dashboard.view")) return "/";
  for (const system of ["crm", "marketing", "operations", "tracking"] as PlatformSystem[]) {
    if (sharedCanAccessSystem(user, system)) return firstAllowedPage(user, system);
  }
  if (canOpenSettings(user)) return "/settings";
  return "/help";
}
