"use client";

import { latestTelemetrySchema, type LatestTelemetry } from "@smart-house/contracts";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  applyPersistedTelemetry,
  mergeTelemetrySnapshot,
  parsePersistedTelemetryEvent,
  type TelemetryReading,
} from "@/lib/telemetry-realtime";

type Props = {
  apiOrigin: string;
  accessToken: string;
  initialTelemetry: LatestTelemetry;
};

type ConnectionState = "live" | "reconnecting" | "offline" | "synchronizing";

const stateLabel: Record<ConnectionState, string> = {
  live: "En vivo",
  reconnecting: "Reconectando",
  offline: "Sin conexión",
  synchronizing: "Sincronizando",
};

function displayTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value))
    : "pendiente";
}

function readingFor(readings: TelemetryReading[], ...metrics: string[]) {
  return readings.find((reading) => metrics.includes(reading.metric));
}

export function SpikeLiveTelemetry({ apiOrigin, accessToken, initialTelemetry }: Props) {
  const [readings, setReadings] = useState<TelemetryReading[]>(initialTelemetry);
  const [connectionState, setConnectionState] = useState<ConnectionState>("synchronizing");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const latestReadings = useRef<TelemetryReading[]>(initialTelemetry);
  const seenEventIds = useRef<string[]>([]);
  const socketConnected = useRef(false);
  const synchronise = useEffectEvent(async (signal: AbortSignal) => {
    setConnectionState("synchronizing");

    try {
      const response = await fetch(`${apiOrigin}/api/spike/telemetry/latest`, {
        cache: "no-store",
        headers: { authorization: `Bearer ${accessToken}` },
        signal,
      });
      if (!response.ok) throw new Error("Telemetry snapshot request failed");
      const snapshot = latestTelemetrySchema.safeParse(await response.json());
      if (!snapshot.success) throw new Error("Invalid telemetry snapshot response");
      if (signal.aborted || !socketConnected.current) return;

      const updatedReadings = mergeTelemetrySnapshot(latestReadings.current, snapshot.data);
      latestReadings.current = updatedReadings;
      setReadings(updatedReadings);
      setLastSyncedAt(new Date().toISOString());
      setConnectionState("live");
    } catch {
      if (!signal.aborted) setConnectionState("offline");
    }
  });

  useEffect(() => {
    let synchronisation: AbortController | undefined;
    const resynchronise = () => {
      synchronisation?.abort();
      synchronisation = new AbortController();
      void synchronise(synchronisation.signal);
    };
    const socket = io(`${apiOrigin}/spike`, {
      auth: { accessToken },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
      randomizationFactor: 0.5,
    });

    socket.on("connect", () => {
      socketConnected.current = true;
      resynchronise();
    });
    socket.io.on("reconnect", () => {
      socketConnected.current = true;
      resynchronise();
    });
    socket.io.on("reconnect_attempt", () => setConnectionState("reconnecting"));
    socket.io.on("reconnect_failed", () => setConnectionState("offline"));
    socket.on("disconnect", (reason) => {
      socketConnected.current = false;
      synchronisation?.abort();
      setConnectionState(reason === "io server disconnect" ? "offline" : "reconnecting");
    });
    socket.on("connect_error", () => setConnectionState("reconnecting"));
    socket.on("telemetry.persisted", (payload: unknown) => {
      const event = parsePersistedTelemetryEvent(payload);
      if (!event) return;
      const next = applyPersistedTelemetry(
        latestReadings.current,
        seenEventIds.current,
        event,
      );
      seenEventIds.current = next.seenEventIds;
      latestReadings.current = next.readings;
      setReadings(next.readings);
    });

    return () => {
      synchronisation?.abort();
      socketConnected.current = false;
      socket.disconnect();
    };
  }, [accessToken, apiOrigin]);

  const temperature = readingFor(readings, "temperature");
  const relay = readingFor(readings, "relayState", "relay_state");
  const isStale = connectionState !== "live";

  return (
    <>
      <div className="feature-grid" aria-live="polite" aria-busy={connectionState === "synchronizing"}>
        <article className="feature-card"><span>Temperatura</span><strong>{temperature ? `${temperature.value} °C` : "-- °C"}</strong><p>{temperature ? `${temperature.deviceId} · ${temperature.correlationId}` : "Esperando una muestra MQTT persistida."}</p></article>
        <article className="feature-card"><span>Relay</span><strong>{relay ? (relay.value === 1 ? "ON" : "OFF") : "--"}</strong><p>{relay ? `${relay.deviceId} · ${relay.correlationId}` : "Esperando estado del relay."}</p></article>
        <article className="feature-card"><span>Ruta</span><strong>{readings.length > 0 ? "Activa" : "En espera"}</strong><p>MQTT → Worker → PostgreSQL → Redis → API.</p></article>
      </div>
      <p className={`live-telemetry ${isStale ? "is-stale" : ""}`} role="status">
        {stateLabel[connectionState]}. {lastSyncedAt ? `Última sincronización: ${displayTime(lastSyncedAt)}.` : "Datos de carga inicial; requieren sincronización."}
      </p>
    </>
  );
}
