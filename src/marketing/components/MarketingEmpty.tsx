import { Megaphone } from "@phosphor-icons/react";

export function MarketingEmpty({ title, description }: { title: string; description?: string }) {
  return <div className="marketing-empty"><Megaphone size={38} weight="duotone" /><strong>{title}</strong>{description ? <span>{description}</span> : null}</div>;
}
