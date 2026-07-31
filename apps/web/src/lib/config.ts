const defaultApiUrl = "http://localhost:4000";

export function getApiUrl(): string {
  const value = process.env.API_URL ?? defaultApiUrl;

  try {
    return new URL(value).origin;
  } catch {
    throw new Error("API_URL must be an absolute URL.");
  }
}
