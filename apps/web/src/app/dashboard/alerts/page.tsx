import { cookies } from "next/headers";
import { AlertsClient } from "./alerts-client";
import { accessTokenCookie } from "@/lib/auth";
import { getAlerts, getNotificationInbox, getOrganizations } from "@/lib/api";
import { getApiUrl } from "@/lib/config";
import { redirectExpiredSession } from "@/lib/session";

async function loadAlerts(accessToken: string) {
  try {
    const organizations = await getOrganizations(accessToken);
    return await Promise.all(
      organizations.map(async (organization) => {
        const [alerts, inbox] = await Promise.all([
          getAlerts(accessToken, organization.id),
          getNotificationInbox(accessToken, organization.id),
        ]);
        return { organization, alerts, inbox };
      }),
    );
  } catch (error) {
    redirectExpiredSession(error);
  }
}

export default async function AlertsPage() {
  const accessToken = (await cookies()).get(accessTokenCookie)?.value ?? "";
  const initial = await loadAlerts(accessToken);

  return (
    <section className="feature-page organization-page">
      <header className="feature-hero">
        <p className="aero-kicker">Atención</p>
        <h1>Centro de alertas</h1>
        <p>
          Consulta, reconoce, resuelve o silencia incidentes. Cada cambio queda
          auditado y se actualiza en tiempo real.
        </p>
      </header>
      <AlertsClient
        apiOrigin={getApiUrl()}
        accessToken={accessToken}
        initial={initial}
      />
    </section>
  );
}
