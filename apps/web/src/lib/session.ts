import { redirect } from "next/navigation";
import { UnauthorizedApiError } from "./api";

export function redirectExpiredSession(error: unknown): never {
  if (error instanceof UnauthorizedApiError) {
    redirect("/auth/logout?error=session-expired");
  }
  throw error;
}
