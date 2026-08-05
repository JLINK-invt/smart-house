import { FeaturePage } from "@/components/feature-page";

export default function CommandsPage() {
  return <FeaturePage eyebrow="Control" title="Comandos" description="Envía acciones autorizadas y confirma cada resultado mediante ACK del dispositivo." cards={[{ title: "Pendientes", value: "0", detail: "No hay comandos esperando publicación." }, { title: "Confirmados", value: "0", detail: "Los comandos exitosos requerirán ACK." }, { title: "Expirados", value: "0", detail: "Los comandos sin confirmación no se consideran exitosos." }]} />;
}
