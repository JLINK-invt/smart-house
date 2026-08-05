"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";

type Props = { apiOrigin: string };

export function SpikeLiveTelemetry({ apiOrigin }: Props) {
  const [correlationId, setCorrelationId] = useState<string | null>(null);

  useEffect(() => {
    const socket = io(`${apiOrigin}/spike`);
    socket.on("telemetry.persisted", (event: { correlationId?: string }) => {
      setCorrelationId(event.correlationId ?? null);
    });
    return () => {
      socket.disconnect();
    };
  }, [apiOrigin]);

  return (
    <p className="live-telemetry" role="status">
      {correlationId ? `Actualización en vivo: ${correlationId}` : "Escuchando actualizaciones en vivo..."}
    </p>
  );
}
