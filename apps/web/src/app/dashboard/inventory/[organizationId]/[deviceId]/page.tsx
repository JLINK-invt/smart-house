import { cookies } from "next/headers";
import Link from "next/link";
import { DeviceTelemetryChart } from "@/components/device-telemetry-chart";
import { accessTokenCookie } from "@/lib/auth";
import {
  getCapabilityCatalog,
  getDevice,
  getDeviceTelemetry,
  type CapabilityCatalog,
  type Device,
  type DeviceTelemetry,
} from "@/lib/api";
import { getApiUrl } from "@/lib/config";
import { redirectExpiredSession } from "@/lib/session";

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string; deviceId: string }>;
}) {
  const { organizationId, deviceId } = await params;
  const accessToken = (await cookies()).get(accessTokenCookie)?.value ?? "";
  let device: Device;
  let catalog: CapabilityCatalog[];
  let recentTelemetry: DeviceTelemetry[];
  try {
    [device, catalog] = await Promise.all([
      getDevice(accessToken, organizationId, deviceId),
      getCapabilityCatalog(accessToken, organizationId),
    ]);
    const capability = catalog.find(
      (profile) => profile.type === device.type && profile.version === device.capabilityVersion,
    );
    const metrics = capability?.metrics ?? [];
    const now = new Date();
    recentTelemetry = await Promise.all(
      metrics.map((metric) =>
        getDeviceTelemetry(accessToken, organizationId, deviceId, {
          metric,
          from: new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
          to: now.toISOString(),
        }),
      ),
    );
  } catch (error) {
    redirectExpiredSession(error);
  }
  const capability = catalog.find(
    (profile) => profile.type === device.type && profile.version === device.capabilityVersion,
  );
  const metrics = capability?.metrics ?? [];
  const initialMetric = metrics[0];
  const initialTelemetry = recentTelemetry[0] ?? {
    resolution: "raw" as const,
    points: [],
  };

  return (
    <section className="feature-page organization-page device-detail-page">
      <Link className="text-button" href="/dashboard/inventory">Volver al inventario</Link>
      <header className="feature-hero">
        <p className="aero-kicker">{device.type} · {device.status}</p>
        <h1>{device.name}</h1>
        <p>Detalle de estado, metadatos y telemetría del dispositivo.</p>
      </header>
      <dl className="device-metadata">
        <div><dt>ID externo</dt><dd>{device.externalId}</dd></div>
        <div><dt>Versión</dt><dd>{device.capabilityVersion}</dd></div>
        <div><dt>Última señal</dt><dd>{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString("es-ES") : "Sin telemetría"}</dd></div>
        <div><dt>Registrado</dt><dd>{new Date(device.createdAt).toLocaleString("es-ES")}</dd></div>
      </dl>
      {recentTelemetry.length ? (
        <section className="recent-metrics" aria-label="Métricas recientes">
          {recentTelemetry.map((series) => {
            const latest = series.points.at(-1);
            return (
              <article key={series.metric}>
                <span>{series.metric}</span>
                <strong>
                  {latest
                    ? series.metric === "relayState"
                      ? latest.value === 1
                        ? "Encendido"
                        : "Apagado"
                      : `${latest.value} ${latest.unit}`
                    : "Sin muestras"}
                </strong>
                <small>
                  {latest
                    ? new Date(latest.occurredAt).toLocaleString("es-ES")
                    : ""}
                </small>
              </article>
            );
          })}
        </section>
      ) : null}
      {initialMetric ? (
        <DeviceTelemetryChart
          apiOrigin={getApiUrl()}
          accessToken={accessToken}
          organizationId={organizationId}
          deviceId={deviceId}
          metrics={metrics}
          initialMetric={initialMetric}
          initialPoints={initialTelemetry.points}
          initialResolution={initialTelemetry.resolution}
        />
      ) : <p className="organization-note">Este tipo de dispositivo no declara métricas disponibles.</p>}
    </section>
  );
}
