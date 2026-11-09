export type NotificationSystem = "crm" | "marketing" | "operations" | "tracking";
export type PlatformNotification = {
  id: string;
  system_code: NotificationSystem;
  event_type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  action_url: string | null;
  severity: "info" | "success" | "warning" | "danger";
  actor_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
};
export type NotificationsResponse = {
  ok: boolean;
  rows: PlatformNotification[];
  total: number;
  unread: number;
  system: NotificationSystem | "all";
  canViewAll: boolean;
};

export type NotificationPreferences = {
  soundEnabled: boolean;
  toastEnabled: boolean;
  toastDurationSeconds: 3 | 5 | 8 | 10;
  systemAlerts: Record<NotificationSystem, boolean>;
};
