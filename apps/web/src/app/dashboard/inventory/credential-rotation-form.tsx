"use client";

import { useActionState } from "react";
import {
  rotateDeviceCredentials,
  type CredentialRotationState,
} from "./actions";

const initialState: CredentialRotationState = {};

export function CredentialRotationForm({
  organizationId,
  deviceId,
  disabled,
}: {
  organizationId: string;
  deviceId: string;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(
    rotateDeviceCredentials.bind(null, organizationId, deviceId),
    initialState,
  );

  return (
    <div className="credential-rotation">
      <form action={action}>
        <button
          className="text-button"
          type="submit"
          disabled={disabled || pending}
        >
          {pending ? "Rotando..." : "Rotar credenciales"}
        </button>
      </form>
      {state.token ? (
        <p className="activation-token-value" role="status">
          Las credenciales activas se revocaron. Copia el token nuevo ahora; no
          se volverá a mostrar: <code>{state.token}</code>
          <br />
          Vence: {new Date(state.expiresAt!).toLocaleString()}
        </p>
      ) : null}
      {state.error ? (
        <p className="activation-token-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
