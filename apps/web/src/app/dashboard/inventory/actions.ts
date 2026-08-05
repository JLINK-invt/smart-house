"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { accessTokenCookie } from "@/lib/auth";
import {
  createDevice as createDeviceRequest,
  disableDevice as disableDeviceRequest,
  enableDevice as enableDeviceRequest,
  issueActivationToken as issueActivationTokenRequest,
  revokeDeviceCredential as revokeDeviceCredentialRequest,
  rotateDeviceCredentials as rotateDeviceCredentialsRequest,
  updateDevice as updateDeviceRequest,
} from "@/lib/api";

export type ActivationTokenState = {
  token?: string;
  expiresAt?: string;
  error?: string;
};

export type CredentialRotationState = ActivationTokenState & {
  revokedCredentialReferences?: string[];
};

async function accessToken() {
  const accessToken = (await cookies()).get(accessTokenCookie)?.value;
  if (!accessToken) throw new Error("Authentication is required.");
  return accessToken;
}

function deviceInput(formData: FormData) {
  const externalId = String(formData.get("externalId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();
  const capabilityVersion = String(
    formData.get("capabilityVersion") ?? "",
  ).trim();
  if (!externalId || !name || !type || !capabilityVersion)
    throw new Error(
      "External ID, name, type, and capability version are required.",
    );
  return { externalId, name, type, capabilityVersion };
}

export async function createDevice(organizationId: string, formData: FormData) {
  await createDeviceRequest(
    await accessToken(),
    organizationId,
    deviceInput(formData),
  );
  revalidatePath("/dashboard/inventory");
  redirect("/dashboard/inventory");
}

export async function updateDevice(
  organizationId: string,
  deviceId: string,
  formData: FormData,
) {
  await updateDeviceRequest(
    await accessToken(),
    organizationId,
    deviceId,
    deviceInput(formData),
  );
  revalidatePath("/dashboard/inventory");
  redirect("/dashboard/inventory");
}

export async function disableDevice(organizationId: string, deviceId: string) {
  await disableDeviceRequest(await accessToken(), organizationId, deviceId);
  revalidatePath("/dashboard/inventory");
  redirect("/dashboard/inventory");
}

export async function enableDevice(organizationId: string, deviceId: string) {
  await enableDeviceRequest(await accessToken(), organizationId, deviceId);
  revalidatePath("/dashboard/inventory");
  redirect("/dashboard/inventory");
}

export async function issueActivationToken(
  organizationId: string,
  deviceId: string,
  _previousState: ActivationTokenState,
): Promise<ActivationTokenState> {
  void _previousState;
  try {
    const result = await issueActivationTokenRequest(
      await accessToken(),
      organizationId,
      deviceId,
    );
    return { token: result.token, expiresAt: result.expiresAt };
  } catch {
    return { error: "No se pudo generar el token de activación." };
  }
}

export async function rotateDeviceCredentials(
  organizationId: string,
  deviceId: string,
  _previousState: CredentialRotationState,
): Promise<CredentialRotationState> {
  void _previousState;
  try {
    const result = await rotateDeviceCredentialsRequest(
      await accessToken(),
      organizationId,
      deviceId,
    );
    return {
      token: result.token,
      expiresAt: result.expiresAt,
      revokedCredentialReferences: result.revokedCredentialReferences,
    };
  } catch {
    return { error: "No se pudieron rotar las credenciales." };
  }
}

export async function revokeDeviceCredential(
  organizationId: string,
  deviceId: string,
  credentialReference: string,
) {
  await revokeDeviceCredentialRequest(
    await accessToken(),
    organizationId,
    deviceId,
    credentialReference,
  );
  revalidatePath("/dashboard/inventory");
  redirect("/dashboard/inventory");
}
