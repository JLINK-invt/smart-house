import { FeaturePage } from "@/components/feature-page";

export default function SettingsPage() {
  return <FeaturePage eyebrow="Tenancy" title="Organizaciones y miembros" description="Administra la organización, sus miembros y los roles que podrán operar el hogar conectado." cards={[{ title: "Organizaciones", value: "0", detail: "Se crearán al completar autenticación y tenancy." }, { title: "Miembros", value: "0", detail: "Owner, Admin, Operator y Viewer serán roles explícitos." }, { title: "Sesiones", value: "Vista previa", detail: "OIDC y MFA reemplazarán la sesión local." }]} />;
}
