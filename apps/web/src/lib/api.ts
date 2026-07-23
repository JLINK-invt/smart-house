import {
  healthResponseSchema,
  type HealthResponse,
} from "@smart-house/contracts";

type ApiStatus =
  | { state: "online"; data: HealthResponse }
  | { state: "offline"; data: null };

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

export async function getApiStatus(): Promise<ApiStatus> {
  try {
    const response = await fetch(`${apiUrl}/api/health`, {
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
