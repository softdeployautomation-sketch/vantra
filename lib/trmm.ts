import "server-only";

const BASE = process.env.TRMM_API_BASE_URL!;
const KEY = process.env.TRMM_API_KEY!;

async function trmm<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "X-API-KEY": KEY,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!r.ok)
    throw new Error(`TRMM ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
  return r.json();
}

// Python strptime("%Y-%m-%dT%H:%M:%S%z") compatible — NOT date.toISOString()
function formatExpiry(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+0000`
  );
}

// Creates client + site together — confirmed real response is just a string message
export async function createClientWithSite(
  clientName: string,
  siteName: string,
): Promise<void> {
  await trmm<string>("/clients/", {
    method: "POST",
    body: JSON.stringify({
      client: { name: clientName },
      site: { name: siteName },
    }),
  });
}

// Client/Site have no create-response body with IDs — fetch the list and find by name
export const listClients = () =>
  trmm<
    Array<{ id: number; name: string; sites: Array<{ id: number; name: string }> }>
  >("/clients/");

export async function createDeployment(opts: {
  site: number;
  expiresAt: Date;
  agentType: "server" | "workstation";
  goarch: string;
}): Promise<string> {
  await trmm<string>("/clients/deployments/", {
    method: "POST",
    body: JSON.stringify({
      site: opts.site,
      expires: formatExpiry(opts.expiresAt),
      agenttype: opts.agentType,
      goarch: opts.goarch,
      power: true,
      ping: true,
      rdp: true,
    }),
  });
  // POST response has no uid — fetch it via list, most recent for this site
  const deps = await trmm<
    Array<{ uid: string; site_id: number; created: string }>
  >("/clients/deployments/");
  const match = deps
    .filter((d) => d.site_id === opts.site)
    .sort((a, b) => b.created.localeCompare(a.created))[0];
  if (!match)
    throw new Error("Deployment created but not found in list — race condition or filter mismatch");
  return match.uid;
}

// AllowAny — confirmed safe to link directly, returns exe
export const deployUrl = (uid: string) => `${BASE}/clients/${uid}/deploy/`;

export const listAgents = (clientId: number) =>
  trmm<
    Array<{
      agent_id: string;
      hostname: string;
      status: "online" | "offline" | "overdue";
      last_seen: string;
    }>
  >(`/agents/?client=${clientId}`);