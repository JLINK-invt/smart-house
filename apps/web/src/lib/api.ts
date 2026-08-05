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

export async function getLatestTelemetry(): Promise<LatestTelemetryResponse> {
  try {
    const response = await fetch(`${getApiUrl()}/api/spike/telemetry/latest`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return [];

    const result = latestTelemetrySchema.safeParse(await response.json());
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}
