"use client";

import { useActionState } from "react";
import { issueActivationToken, type ActivationTokenState } from "./actions";

const initialState: ActivationTokenState = {};

export function ActivationTokenForm({ organizationId, deviceId, disabled }: { organizationId: string; deviceId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(
    issueActivationToken.bind(null, organizationId, deviceId),
    initialState,
  );

  return (
    <div className="activation-token">
      <form action={action}>
        <button className="text-button" type="submit" disabled={disabled || pending}>
          {pending ? "Generando..." : "Generar token de activación"}
        </button>
      </form>
      {state.token ? <p className="activation-token-value" role="status">Cópialo ahora; no se volverá a mostrar: <code>{state.token}</code><br />Vence: {new Date(state.expiresAt!).toLocaleString()}</p> : null}
      {state.error ? <p className="activation-token-error" role="alert">{state.error}</p> : null}
    </div>
  );
}
