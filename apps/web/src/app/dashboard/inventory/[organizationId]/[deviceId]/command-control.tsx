"use client";

import { useActionState, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { issueRelayCommand, type CommandState } from "../../actions";
import type { DeviceCommands } from "@/lib/api";
import { mergeCommandStatus, parseCommandStatusEvent } from "@/lib/command-realtime";

const initialState: CommandState = {};

export function CommandControl({
  apiOrigin,
  accessToken,
  organizationId,
  deviceId,
  commands,
}: {
  apiOrigin: string;
  accessToken: string;
  organizationId: string;
  deviceId: string;
  commands: DeviceCommands;
}) {
  const [state, action, pending] = useActionState(
    issueRelayCommand.bind(null, organizationId, deviceId),
    initialState,
  );
  const [items, setItems] = useState(commands.items);
  const supportsRelaySet = commands.supportedCommands.includes("relay.set");
  const currentCommand = state.command
    ? items.find(({ id }) => id === state.command?.id) ?? state.command
    : undefined;
  const commandInFlight = ["pending", "sent"].includes(currentCommand?.status ?? "");

  useEffect(() => {
    const socket = io(`${apiOrigin}/spike`, { auth: { accessToken } });
    socket.on("command.status", (payload: unknown) => {
      const event = parseCommandStatusEvent(payload);
      if (!event || event.organizationId !== organizationId || event.deviceId !== deviceId) return;
      setItems((current) => mergeCommandStatus(current, event));
    });
    return () => {
      socket.disconnect();
    };
  }, [accessToken, apiOrigin, deviceId, organizationId]);

  return (
    <section className="command-control" aria-label="Control del dispositivo">
      <header>
        <p className="aero-kicker">Control</p>
        <h2>Comandos disponibles</h2>
        <p>{commands.supportedCommands.join(", ") || "Este dispositivo no admite comandos."}</p>
      </header>
      {supportsRelaySet ? (
        <form action={action}>
          <label>
            Estado del relé
            <select name="state" defaultValue="">
              <option value="" disabled>Selecciona una acción</option>
              <option value="on">Encender</option>
              <option value="off">Apagar</option>
            </select>
          </label>
          <label className="command-confirmation">
            <input name="confirmed" type="checkbox" disabled={pending || commandInFlight} />
            Confirmo el cambio de estado del relé.
          </label>
          <button type="submit" disabled={pending || commandInFlight}>
            {pending ? "Enviando..." : commandInFlight ? "Comando enviado" : "Enviar comando"}
          </button>
        </form>
      ) : null}
      {currentCommand ? <p role="status">Comando {currentCommand.id} en estado {currentCommand.status}. Vence: {new Date(currentCommand.expiresAt).toLocaleString("es-ES")}.</p> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
      <div className="command-history">
        <h3>Últimos comandos</h3>
        {items.length ? <ul>{items.map((command) => (
          <li key={command.id}>
            <strong>{command.type}</strong> {command.status} · vence {new Date(command.expiresAt).toLocaleString("es-ES")}
            {command.error ? <span role="alert"> {command.error.code}: {command.error.message}</span> : null}
          </li>
        ))}</ul> : <p>No hay comandos registrados.</p>}
      </div>
    </section>
  );
}
