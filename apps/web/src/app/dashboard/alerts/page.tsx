import { FeaturePage } from "@/components/feature-page";

export default function AlertsPage() {
  return <FeaturePage eyebrow="Atención" title="Centro de alertas" description="Las alertas de umbral y desconexión se concentrarán en una vista accionable y auditable." cards={[{ title: "Abiertas", value: "0", detail: "No hay condiciones activas." }, { title: "Reglas", value: "0", detail: "Se habilitarán con telemetría real." }, { title: "Canales", value: "Panel", detail: "Correo se añadirá al módulo de notificaciones." }]} />;
}
