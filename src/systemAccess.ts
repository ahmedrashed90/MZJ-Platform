import type { AuthUser } from "./auth/AuthContext";
import {
  canAccessSystem as sharedCanAccessSystem,
  isPlatformAdmin as sharedIsPlatformAdmin,
  type PlatformSystem,
} from "../shared/system-access";

export type { PlatformSystem };

export function isPlatformAdmin(user: AuthUser | null | undefined) {
  return sharedIsPlatformAdmin(user);
}

export function canAccessCrm(user: AuthUser | null | undefined) {
  return sharedCanAccessSystem(user, "crm");
}

export function canAccessMarketing(user: AuthUser | null | undefined) {
  return sharedCanAccessSystem(user, "marketing");
}

export function canAccessOperations(user: AuthUser | null | undefined) {
  return sharedCanAccessSystem(user, "operations");
}

export function canAccessTracking(user: AuthUser | null | undefined) {
  return sharedCanAccessSystem(user, "tracking");
}

export function canAccessSystem(user: AuthUser | null | undefined, system: PlatformSystem) {
  return sharedCanAccessSystem(user, system);
}

export function defaultSystemPath(user: AuthUser | null | undefined) {
  if (!user || isPlatformAdmin(user)) return "/";
  if (canAccessCrm(user)) return "/crm";
  if (canAccessMarketing(user)) return "/marketing";
  if (canAccessOperations(user)) return "/operations";
  if (canAccessTracking(user)) return "/tracking";
  return "/help";
}
