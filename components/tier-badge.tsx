"use client";

import { cn } from "@/lib/cn";
import { normalizeAgentDomainTier } from "@/lib/agent-domain-tier";
import { Badge } from "@/components/ui";

export function TierBadge({
  tier,
  className,
}: {
  tier: string | null | undefined;
  className?: string;
}) {
  const normalized = normalizeAgentDomainTier(tier);
  return (
    <Badge
      tone={normalized === "private" ? "warning" : "neutral"}
      className={cn("shrink-0 px-1.5 py-px text-[0.65rem] font-semibold capitalize", className)}
      title={normalized === "private" ? "Private agent domain (api.instaweb.top)" : "Public agent domain (agent.broks.beauty)"}
    >
      {normalized}
    </Badge>
  );
}
