import { getApiStatus, getLatestTelemetry } from "@/lib/api";
import { getApiUrl } from "@/lib/config";
import { SpikeLiveTelemetry } from "@/components/spike-live-telemetry";
import { cookies } from "next/headers";
import { accessTokenCookie } from "@/lib/auth";
import { redirectExpiredSession } from "@/lib/session";
const milestones = [
  { name: "Organizaciones y miembros", state: "Pendiente", detail: "Autenticación, tenancy y roles del MVP." },
  { name: "Dispositivos", state: "Pendiente", detail: "Registro, activación y estado de la flota." },
  { name: "Telemetría", state: "Pendiente", detail: "Ingesta, histórico y actualización en tiempo real." },
  { name: "Comandos y alertas", state: "Pendiente", detail: "Control confirmado y condiciones accionables." },
];

export default async function DashboardPage() {
  const accessToken = (await cookies()).get(accessTokenCookie)?.value ?? "";
  let api: Awaited<ReturnType<typeof getApiStatus>>;
  let telemetry: Awaited<ReturnType<typeof getLatestTelemetry>>;
  try {
    [api, telemetry] = await Promise.all([getApiStatus(), getLatestTelemetry(accessToken)]);
  } catch (error) {
    redirectExpiredSession(error);
  }
  const relay = telemetry.find((reading) => reading.metric === "relay_state");

  return (
    <section className="feature-page overview-page">
      <section className="dashboard-intro">
        <p className="aero-kicker">Resumen en vivo</p>
        <h1>La plataforma ya tiene pulso.</h1>
        <p>Una vista clara de la base operativa antes de conectar la primera flota Tuya.</p>
      </section>

      <section className="dashboard-grid" aria-label="Estado de la plataforma">
        <article className="signal-card signal-card-primary">
          <span className="aero-kicker">Conectividad</span>
          <strong>{api.state === "online" ? "API operativa" : "API sin conexión"}</strong>
          <p>El panel verifica el contrato público de salud en cada carga.</p>
          <span className="dashboard-status" role="status">
            /api/health
          </span>
        </article>
          <article className="signal-card">
            <span className="aero-kicker">Dispositivos</span>
            <strong>{telemetry.length > 0 ? "2 dispositivos" : "0 dispositivos"}</strong>
            <p>{telemetry.length > 0 ? "Muestras recibidas desde el simulador MQTT." : "La flota aparecerá aquí al registrar el primer dispositivo."}</p>
          </article>
          <article className="signal-card">
            <span className="aero-kicker">Comandos</span>
            <strong>{relay ? (relay.value === 1 ? "Relay encendido" : "Relay apagado") : "0 pendientes"}</strong>
            <p>{relay ? `Muestra al cargar: ${relay.correlationId}` : "Los comandos se confirmarán con ACK de cada dispositivo."}</p>
          </article>
        </section>

      <section className="spike-readings" aria-labelledby="spike-readings-title">
        <div className="section-label"><span>01</span><h2 id="spike-readings-title">Telemetría del spike</h2></div>
        <SpikeLiveTelemetry apiOrigin={getApiUrl()} accessToken={accessToken} initialTelemetry={telemetry} />
      </section>

      <section className="milestones" aria-labelledby="milestones-title">
        <div className="section-label">
          <span>02</span>
          <h2 id="milestones-title">Módulos del MVP</h2>
        </div>
        <div className="milestone-list">
          {milestones.map((milestone, index) => (
            <article key={milestone.name}>
              <span className="layer-index">0{index + 1}</span>
              <div>
                <h3>{milestone.name}</h3>
                <p>{milestone.detail}</p>
              </div>
              <span className={`milestone-state ${milestone.state === "Lista" ? "ready" : "waiting"}`}>
                {milestone.state}
              </span>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
