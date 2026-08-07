"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  mergeTelemetrySeries,
  parsePersistedTelemetryEvent,
  type HistoricalTelemetryPoint,
} from "@/lib/telemetry-realtime";

type Props = {
  apiOrigin: string;
  accessToken: string;
  organizationId: string;
  deviceId: string;
  metrics: string[];
  initialMetric: string;
  initialPoints: HistoricalTelemetryPoint[];
  initialResolution: "raw" | "5m" | "1h";
};

const ranges = [
  { value: "24", label: "24 horas" },
  { value: "168", label: "7 días" },
  { value: "720", label: "30 días" },
] as const;

function formatValue(point: HistoricalTelemetryPoint | undefined, metric: string) {
  if (!point) return "Sin muestras";
  if (metric === "relayState") return point.value === 1 ? "Encendido" : "Apagado";
  return `${point.value.toLocaleString("es-ES", { maximumFractionDigits: 2 })} ${point.unit}`;
}

function pathFor(points: HistoricalTelemetryPoint[], relay: boolean) {
  if (points.length === 1) return "M 50 50";
  const times = points.map((point) => Date.parse(point.occurredAt));
  const values = points.map((point) => point.value);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minValue = relay ? 0 : Math.min(...values);
  const maxValue = relay ? 1 : Math.max(...values);
  const x = (time: number) => 6 + ((time - minTime) / (maxTime - minTime || 1)) * 88;
  const y = (value: number) => 94 - ((value - minValue) / (maxValue - minValue || 1)) * 88;
  return points
    .map((point, index) => {
      const coordinate = `${x(times[index]).toFixed(2)} ${y(point.value).toFixed(2)}`;
      if (index === 0) return `M ${coordinate}`;
      return relay ? `H ${x(times[index]).toFixed(2)} V ${y(point.value).toFixed(2)}` : `L ${coordinate}`;
    })
    .join(" ");
}

export function DeviceTelemetryChart({
  apiOrigin,
  accessToken,
  organizationId,
  deviceId,
  metrics,
  initialMetric,
  initialPoints,
  initialResolution,
}: Props) {
  const [metric, setMetric] = useState(initialMetric);
  const [rangeHours, setRangeHours] = useState<(typeof ranges)[number]["value"]>("24");
  const [points, setPoints] = useState(initialPoints);
  const [resolution, setResolution] = useState(initialResolution);
  const [state, setState] = useState<"ready" | "loading" | "error">("ready");
  const latestPoints = useRef(initialPoints);

  const loadSnapshot = useEffectEvent(async (signal?: AbortSignal) => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(rangeHours) * 60 * 60 * 1_000);
    try {
      const params = new URLSearchParams({
        metric,
        from: from.toISOString(),
        to: to.toISOString(),
        resolution: "auto",
      });
      const response = await fetch(
        `${apiOrigin}/api/organizations/${organizationId}/devices/${deviceId}/telemetry?${params}`,
        { cache: "no-store", headers: { authorization: `Bearer ${accessToken}` }, signal },
      );
      if (!response.ok) throw new Error("Telemetry snapshot request failed");
      const snapshot = (await response.json()) as {
        resolution: "raw" | "5m" | "1h";
        points: HistoricalTelemetryPoint[];
      };
      if (signal?.aborted) return;
      latestPoints.current = mergeTelemetrySeries([], snapshot.points);
      setPoints(latestPoints.current);
      setResolution(snapshot.resolution);
      setState("ready");
    } catch {
      if (!signal?.aborted) setState("error");
    }
  });

  useEffect(() => {
    const controller = new AbortController();
    void loadSnapshot(controller.signal);
    return () => controller.abort();
  }, [metric, rangeHours]);

  useEffect(() => {
    let controller: AbortController | undefined;
    const socket = io(`${apiOrigin}/spike`, {
      auth: { accessToken },
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
    });
    const resynchronise = () => {
      controller?.abort();
      controller = new AbortController();
      void loadSnapshot(controller.signal);
    };
    socket.on("connect", () => {
      socket.emit("telemetry.subscribe", { organizationId, deviceId });
      resynchronise();
    });
    socket.io.on("reconnect", resynchronise);
    socket.on("telemetry.persisted", (payload: unknown) => {
      const event = parsePersistedTelemetryEvent(payload);
      if (!event || event.telemetry.deviceId !== deviceId) return;
      const reading = event.telemetry.readings.find((item) => item.metric === metric);
      if (!reading) return;
      const from = Date.now() - Number(rangeHours) * 60 * 60 * 1_000;
      if (Date.parse(event.telemetry.occurredAt) < from) return;
      latestPoints.current = mergeTelemetrySeries(latestPoints.current, [
        { ...reading, occurredAt: event.telemetry.occurredAt },
      ]);
      setPoints(latestPoints.current);
    });
    return () => {
      controller?.abort();
      socket.disconnect();
    };
  }, [accessToken, apiOrigin, deviceId, metric, organizationId, rangeHours]);

  const latest = points.at(-1);
  const relay = metric === "relayState";
  const path = pathFor(points, relay);
  const exportCsv = async () => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(rangeHours) * 60 * 60 * 1_000);
    const params = new URLSearchParams({
      metric,
      from: from.toISOString(),
      to: to.toISOString(),
      resolution: "auto",
    });
    try {
      const response = await fetch(
        `${apiOrigin}/api/organizations/${organizationId}/devices/${deviceId}/telemetry/export.csv?${params}`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) throw new Error("Telemetry export failed");
      const download = document.createElement("a");
      download.href = URL.createObjectURL(await response.blob());
      download.download = "telemetry.csv";
      download.click();
      URL.revokeObjectURL(download.href);
    } catch {
      setState("error");
    }
  };

  return (
    <section className="device-telemetry" aria-labelledby="device-telemetry-title">
      <div className="device-telemetry-head">
        <div>
          <p className="aero-kicker">Telemetría reciente</p>
          <h2 id="device-telemetry-title">{formatValue(latest, metric)}</h2>
          <p>{latest ? new Date(latest.occurredAt).toLocaleString("es-ES") : "No hay datos para este intervalo."}</p>
        </div>
        <span className="telemetry-resolution">Resolución: {resolution}</span>
      </div>
      <div className="telemetry-controls">
        <label>
          Métrica
          <select value={metric} onChange={(event) => { setState("loading"); setMetric(event.target.value); }}>
            {metrics.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          Rango
          <select value={rangeHours} onChange={(event) => { setState("loading"); setRangeHours(event.target.value as (typeof ranges)[number]["value"]); }}>
            {ranges.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
          </select>
        </label>
        <button type="button" className="text-button" onClick={exportCsv}>Exportar CSV</button>
      </div>
      {state === "loading" ? <p className="organization-note" role="status">Actualizando historial...</p> : null}
      {state === "error" ? <p className="telemetry-error" role="alert">No se pudo cargar la telemetría. Ajusta el rango o reintenta.</p> : null}
      {!points.length && state !== "loading" ? <p className="organization-note">Aún no hay muestras registradas para esta métrica.</p> : null}
      {points.length ? (
        <div className="telemetry-chart" role="img" aria-label={`${metric}: ${points.length} puntos desde ${new Date(points[0].occurredAt).toLocaleString("es-ES")} hasta ${new Date(latest!.occurredAt).toLocaleString("es-ES")}`}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className="telemetry-grid" d="M 6 6 V 94 H 94 M 6 50 H 94" />
            <path className="telemetry-line" d={path} />
          </svg>
        </div>
      ) : null}
    </section>
  );
}
