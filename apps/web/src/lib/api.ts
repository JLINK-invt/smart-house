import {
  healthResponseSchema,
  latestTelemetrySchema,
  type components,
  type HealthResponse,
} from "@smart-house/contracts";
import { getApiUrl } from "./config";

type ApiStatus =
  | { state: "online"; data: HealthResponse }
  | { state: "offline"; data: null };

export async function getApiStatus(): Promise<ApiStatus> {
  try {
    const response = await fetch(`${getApiUrl()}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });

    if (!response.ok) {
      return { state: "offline", data: null };
    }

    const result = healthResponseSchema.safeParse(await response.json());

    return result.success
      ? { state: "online", data: result.data }
      : { state: "offline", data: null };
  } catch {
    return { state: "offline", data: null };
  }
}

type LatestTelemetryResponse = components["schemas"]["LatestTelemetry"][];

export type Organization = { id: string; name: string; role: string };
export type OrganizationMember = { email: string; role: string; status: string };

async function authorizedFetch(path: string, accessToken: string, init?: RequestInit) {
  return fetch(`${getApiUrl()}${path}`, {
    ...init,
    cache: "no-store",
    headers: { authorization: `Bearer ${accessToken}`, ...init?.headers },
  });
}

export async function getOrganizations(accessToken: string): Promise<Organization[]> {
  const response = await authorizedFetch("/api/organizations", accessToken);
  return response.ok ? (await response.json()) as Organization[] : [];
}

export async function getOrganizationMembers(accessToken: string, organizationId: string): Promise<OrganizationMember[]> {
  const response = await authorizedFetch(`/api/organizations/${organizationId}/members`, accessToken);
  return response.ok ? (await response.json()) as OrganizationMember[] : [];
}

export async function getLatestTelemetry(accessToken: string): Promise<LatestTelemetryResponse> {
  try {
    const response = await fetch(`${getApiUrl()}/api/spike/telemetry/latest`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return [];

    const result = latestTelemetrySchema.safeParse(await response.json());
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}
