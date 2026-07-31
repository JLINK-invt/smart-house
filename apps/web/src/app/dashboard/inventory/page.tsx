import { FeaturePage } from "@/components/feature-page";

export default function InventoryPage() {
  return <FeaturePage eyebrow="Dispositivos" title="Gestión de dispositivos" description="Registra, consulta, edita y desactiva los dispositivos de tu organización." cards={[{ title: "Registrados", value: "0", detail: "Aún no hay dispositivos vinculados." }, { title: "En línea", value: "0", detail: "Se actualizará con la primera conexión MQTT." }, { title: "Tipos", value: "Tuya", detail: "Sensores, relays y focos previstos." }]} />;
}
