import { FeaturePage } from "@/components/feature-page";

export default function TelemetryPage() {
  return <FeaturePage eyebrow="Señales" title="Telemetría en vivo" description="Temperatura, humedad, batería y estados de relé aparecerán aquí con datos validados." cards={[{ title: "Muestras", value: "0", detail: "Sin payloads recibidos todavía." }, { title: "Frecuencia", value: "60 s", detail: "Objetivo de reporte de la flota inicial." }, { title: "Retención", value: "90 días", detail: "Detalle previsto para el MVP." }]} />;
}
