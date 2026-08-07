import {
  healthResponseSchema,
  latestTelemetrySchema,
  type components,
  type HealthResponse,
} from "@smart-house/contracts";
import { getApiUrl } from "./config.ts";

type ApiStatus =
  { state: "online"; data: HealthResponse } | { state: "offline"; data: null };

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
export type OrganizationMember = {
  email: string;
  role: string;
  status: string;
};
export type Device = {
  id: string;
  externalId: string;
  name: string;
  type: string;
  capabilityVersion: string;
  status: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type DeviceInput = Pick<
  Device,
  "externalId" | "name" | "type" | "capabilityVersion"
>;
export type DeviceListQuery = {
  q?: string;
  status?: string;
  type?: string;
  limit?: number;
  cursor?: string;
};
export type DeviceList = { items: Device[]; nextCursor: string | null };
export type TelemetryPoint = {
  occurredAt: string;
  value: number;
  unit: string;
};
export type DeviceTelemetry = {
  metric: string;
  resolution: "raw" | "5m" | "1h";
  points: TelemetryPoint[];
};
export type CapabilityCatalog = {
  type: string;
  version: string;
  metrics: string[];
  commands: string[];
};
export type ActivationToken = {
  token: string;
  expiresAt: string;
  deviceId: string;
};
export type CredentialMetadata = {
  credentialReference: string;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked" | "expired";
};
export type CredentialRotation = ActivationToken & {
  revokedCredentialReferences: string[];
};

export class UnauthorizedApiError extends Error {
  constructor() {
    super("The API session has expired.");
    this.name = "UnauthorizedApiError";
  }
}

function throwIfUnauthorized(response: Response): void {
  if (response.status === 401) throw new UnauthorizedApiError();
}

async function authorizedFetch(
  path: string,
  accessToken: string,
  init?: RequestInit,
) {
  return fetch(`${getApiUrl()}${path}`, {
    ...init,
    cache: "no-store",
    headers: { authorization: `Bearer ${accessToken}`, ...init?.headers },
  });
}

export async function getOrganizations(
  accessToken: string,
): Promise<Organization[]> {
  const response = await authorizedFetch("/api/organizations", accessToken);
  throwIfUnauthorized(response);
  return response.ok ? ((await response.json()) as Organization[]) : [];
}

export async function getOrganizationMembers(
  accessToken: string,
  organizationId: string,
): Promise<OrganizationMember[]> {
  const response = await authorizedFetch(
    `/api/organizations/${organizationId}/members`,
    accessToken,
  );
  throwIfUnauthorized(response);
  return response.ok ? ((await response.json()) as OrganizationMember[]) : [];
}

export async function getDevices(
  accessToken: string,
  organizationId: string,
  query: DeviceListQuery = {},
): Promise<DeviceList> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const response = await authorizedFetch(
    `/api/organizations/${organizationId}/devices${params.size ? `?${params}` : ""}`,
    accessToken,
  );
  throwIfUnauthorized(response);
  if (!response.ok) {
    throw new Error(
      `Device inventory request failed (${response.status}): ${(await response.text()) || response.statusText}`,
    );
  }
  return (await response.json()) as DeviceList;
}

export async function getDevice(
  accessToken: string,
  organizationId: string,
  deviceId: string,
): Promise<Device> {
  const response = await authorizedFetch(
    `/api/organizations/${organizationId}/devices/${deviceId}`,
    accessToken,
  );
  throwIfUnauthorized(response);
  if (!response.ok) {
    throw new Error(
      `Device detail request failed (${response.status}): ${(await response.text()) || response.statusText}`,
    );
  }
  return (await response.json()) as Device;
}

export async function getDeviceTelemetry(
  accessToken: string,
  organizationId: string,
  deviceId: string,
  query: {
    metric: string;
    from: string;
    to: string;
    resolution?: "auto" | "raw" | "5m" | "1h";
  },
): Promise<DeviceTelemetry> {
  const params = new URLSearchParams({
    ...query,
    resolution: query.resolution ?? "auto",
  });
  const response = await authorizedFetch(
    `/api/organizations/${organizationId}/devices/${deviceId}/telemetry?${params}`,
    accessToken,
  );
  throwIfUnauthorized(response);
  if (!response.ok) {
    throw new Error(
      `Device telemetry request failed (${response.status}): ${(await response.text()) || response.statusText}`,
    );
  }
  return (await response.json()) as DeviceTelemetry;
}

export async function getCapabilityCatalog(
  accessToken: string,
  organizationId: string,
): Promise<CapabilityCatalog[]> {
  const response = await authorizedFetch(
    `/api/organizations/${organizationId}/devices/capability-catalog`,
    accessToken,
  );
  throwIfUnauthorized(response);
  return response.ok ? ((await response.json()) as CapabilityCatalog[]) : [];
}

export async function getDeviceCredentials(
  accessToken: string,
  organizationId: string,
  deviceId: string,
): Promise<CredentialMetadata[]> {
  const response = await authorizedFetch(
    `/api/organizations/${organizationId}/devices/${deviceId}/credentials`,
    accessToken,
  );
  throwIfUnauthorized(response);
  return response.ok ? ((await response.json()) as CredentialMetadata[]) : [];
}

async function mutateDevice(
  accessToken: string,
  path: string,
  method: "PATCH" | "POST",
  body?: DeviceInput,
) {
  const response = await authorizedFetch(path, accessToken, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  throwIfUnauthorized(response);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Device API request failed (${response.status}): ${detail || response.statusText}`,
    );
  }
}

async function deviceRequest<T>(
  accessToken: string,
  path: string,
  method: "POST",
): Promise<T> {
  const response = await authorizedFetch(path, accessToken, { method });
  throwIfUnauthorized(response);
  if (!response.ok) {
    throw new Error(
      `Device API request failed (${response.status}): ${(await response.text()) || response.statusText}`,
    );
  }
  return response.json() as Promise<T>;
}

export function createDevice(
  accessToken: string,
  organizationId: string,
  input: DeviceInput,
) {
  return mutateDevice(
    accessToken,
    `/api/organizations/${organizationId}/devices`,
    "POST",
    input,
  );
}

export function updateDevice(
  accessToken: string,
  organizationId: string,
  deviceId: string,
  input: DeviceInput,
) {
  return mutateDevice(
    accessToken,
    `/api/organizations/${organizationId}/devices/${deviceId}`,
    "PATCH",
    input,
  );
}

export function disableDevice(
  accessToken: string,
  organizationId: string,
  deviceId: string,
) {
  return mutateDevice(
    accessToken,
    `/api/organizations/${organizationId}/devices/${deviceId}/disable`,
    "POST",
  );
}

export function enableDevice(
  accessToken: string,
  organizationId: string,
  deviceId: string,
) {
  return mutateDevice(
    accessToken,
    `/api/organizations/${organizationId}/devices/${deviceId}/enable`,
    "POST",
  );
}

export function issueActivationToken(
  accessToken: string,
  organizationId: string,
  deviceId: string,
) {
  return deviceRequest<ActivationToken>(
    accessToken,
    `/api/organizations/${organizationId}/devices/${deviceId}/activation-tokens`,
    "POST",
  );
}

export function rotateDeviceCredentials(
  accessToken: string,
  organizationId: string,
  deviceId: string,
) {
  return deviceRequest<CredentialRotation>(
    accessToken,
    `/api/organizations/${organizationId}/devices/${deviceId}/credentials/rotate`,
    "POST",
  );
}

export function revokeDeviceCredential(
  accessToken: string,
  organizationId: string,
  deviceId: string,
  credentialReference: string,
) {
  return deviceRequest<CredentialMetadata>(
    accessToken,
    `/api/organizations/${organizationId}/devices/${deviceId}/credentials/${credentialReference}/revoke`,
    "POST",
  );
}

export async function getLatestTelemetry(
  accessToken: string,
): Promise<LatestTelemetryResponse> {
  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}/api/spike/telemetry/latest`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return [];
  }
  throwIfUnauthorized(response);
  if (!response.ok) return [];

  const result = latestTelemetrySchema.safeParse(await response.json());
  return result.success ? result.data : [];
}
