"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { accessTokenCookie } from "@/lib/auth";
import {
  createDevice as createDeviceRequest,
  createDeviceCommand as createDeviceCommandRequest,
  disableDevice as disableDeviceRequest,
  enableDevice as enableDeviceRequest,
  issueActivationToken as issueActivationTokenRequest,
  revokeDeviceCredential as revokeDeviceCredentialRequest,
  rotateDeviceCredentials as rotateDeviceCredentialsRequest,
  updateDevice as updateDeviceRequest,
} from "@/lib/api";

export type CommandState = {
  command?: { id: string; status: string; expiresAt: string };
  error?: string;
};

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

export async function issueRelayCommand(
  organizationId: string,
  deviceId: string,
  _previousState: CommandState,
  formData: FormData,
): Promise<CommandState> {
  void _previousState;
  const state = String(formData.get("state") ?? "");
  const confirmed = formData.get("confirmed") === "on";
  if (state !== "on" && state !== "off") {
    return { error: "Selecciona el estado del relé." };
  }
  if (!confirmed) {
    return { error: "Confirma explícitamente el cambio de estado." };
  }
  try {
    const command = await createDeviceCommandRequest(
      await accessToken(),
      organizationId,
      deviceId,
      { type: "relay.set", payload: { state }, confirmed },
    );
    revalidatePath(`/dashboard/inventory/${organizationId}/${deviceId}`);
    return { command };
  } catch {
    return { error: "No se pudo enviar el comando. Revisa tu permiso o inténtalo más tarde." };
  }
}
