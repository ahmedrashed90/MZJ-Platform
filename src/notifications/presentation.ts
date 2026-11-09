import type { PlatformNotification } from "./types";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function metadataName(item: PlatformNotification) {
  const metadata = item.metadata || {};
  return text(metadata.responsibleName)
    || text(metadata.actorName)
    || text(metadata.createdByName)
    || text(metadata.updatedByName)
    || text(metadata.sourceName);
}

function customerFromInboundTitle(title: string) {
  const prefix = "رسالة واردة من ";
  return title.startsWith(prefix) ? title.slice(prefix.length).trim() : "";
}

export function notificationResponsibleName(item: PlatformNotification) {
  const direct = text(item.actor_name);
  if (direct) return direct;

  const fromMetadata = metadataName(item);
  if (fromMetadata) return fromMetadata;

  if (item.event_type === "customer_message_received") {
    return customerFromInboundTitle(item.title) || "العميل";
  }

  if (item.event_type === "lead_created_from_channel") return "تكامل القناة";
  if (item.event_type === "order_created") return "NEXT ERP";
  return "النظام";
}
