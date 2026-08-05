"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function startPreviewSession() {
  if (process.env.NODE_ENV === "production") {
    redirect("/login?error=preview-unavailable");
  }

  const cookieStore = await cookies();
  cookieStore.set("smart-house-session", "local-preview", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 60 * 60 * 8,
    path: "/",
  });

  redirect("/dashboard");
}
