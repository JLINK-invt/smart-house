"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { accessTokenCookie } from "@/lib/auth";
import { getApiUrl } from "@/lib/config";

async function mutate(path: string, body: unknown) {
  const accessToken = (await cookies()).get(accessTokenCookie)?.value;
  if (!accessToken) throw new Error("Authentication is required.");
  const response = await fetch(`${getApiUrl()}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("The requested organization change was rejected.");
}

export async function createOrganization(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Organization name is required.");
  await mutate("/api/organizations", { name });
  revalidatePath("/dashboard/settings");
}

export async function addMember(organizationId: string, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "viewer");
  if (!email) throw new Error("Member email is required.");
  await mutate(`/api/organizations/${organizationId}/members`, { email, role });
  revalidatePath("/dashboard/settings");
}
