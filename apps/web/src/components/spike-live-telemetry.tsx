"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";

type Props = { apiOrigin: string; accessToken: string };

export function SpikeLiveTelemetry({ apiOrigin, accessToken }: Props) {
  const [correlationId, setCorrelationId] = useState<string | null>(null);

  useEffect(() => {
    const socket = io(`${apiOrigin}/spike`, { auth: { accessToken } });
    socket.on("telemetry.persisted", (event: { correlationId?: string }) => {
      setCorrelationId(event.correlationId ?? null);
    });
    return () => {
      socket.disconnect();
    };
  }, [accessToken, apiOrigin]);

  return (
    <p className="live-telemetry" role="status">
      {correlationId ? `Actualización en vivo: ${correlationId}` : "Escuchando actualizaciones en vivo..."}
    </p>
  );
}
