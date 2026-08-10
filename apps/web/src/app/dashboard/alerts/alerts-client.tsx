"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { mergeAlertStatus, parseAlertStatusEvent } from "@/lib/alert-realtime";
import { getAlerts, getNotificationInbox, markNotificationRead, transitionAlert, type Alert, type NotificationInbox, type Organization } from "@/lib/api";

type OrganizationAlerts = { organization: Organization; alerts: Alert[]; inbox: NotificationInbox };

export function AlertsClient({
  apiOrigin,
  accessToken,
  initial,
}: {
  apiOrigin: string;
  accessToken: string;
  initial: OrganizationAlerts[];
}) {
  const [groups, setGroups] = useState(initial);
  const [state, setState] = useState("");
  const [severity, setSeverity] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    const socket = io(`${apiOrigin}/spike`, { auth: { accessToken } });
    socket.on("alert.status", (payload: unknown) => {
      const event = parseAlertStatusEvent(payload);
      if (!event) return;
      setGroups((current) => current.map((group) =>
        group.organization.id === event.organizationId
          ? { ...group, alerts: mergeAlertStatus(group.alerts, event) }
          : group,
      ));
    });
    socket.on("notification.inbox", (payload: { organizationId?: unknown }) => {
      if (typeof payload?.organizationId !== "string") return;
      void Promise.all([getNotificationInbox(accessToken, payload.organizationId), getAlerts(accessToken, payload.organizationId)]).then(([inbox, alerts]) => {
        setGroups((current) => current.map((group) => group.organization.id === payload.organizationId ? { ...group, inbox, alerts } : group));
      });
    });
    return () => {
      socket.disconnect();
    };
  }, [accessToken, apiOrigin]);

  async function act(organizationId: string, alertId: string, action: "acknowledge" | "resolve" | "silence") {
    setPending(`${alertId}:${action}`);
    try {
      const alert = await transitionAlert(accessToken, organizationId, alertId, action);
      setGroups((current) => current.map((group) =>
        group.organization.id === organizationId
          ? { ...group, alerts: [alert, ...group.alerts.filter(({ id }) => id !== alert.id)] }
          : group,
      ));
    } finally {
      setPending(null);
    }
  }

  async function read(organizationId: string, notificationId: string) {
    const notification = await markNotificationRead(accessToken, organizationId, notificationId);
    setGroups((current) => current.map((group) => group.organization.id !== organizationId ? group : {
      ...group,
      inbox: {
        unreadCount: Math.max(0, group.inbox.unreadCount - (group.inbox.items.find((item) => item.id === notificationId)?.readAt ? 0 : 1)),
        items: group.inbox.items.map((item) => item.id === notificationId ? notification : item),
      },
    }));
  }

  return <>
    <div className="inventory-filters">
      <label>Estado<select value={state} onChange={(event) => setState(event.target.value)}><option value="">Todos</option><option value="open">Abierta</option><option value="acknowledged">Reconocida</option><option value="resolved">Resuelta</option><option value="silenced">Silenciada</option></select></label>
      <label>Severidad<select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="">Todas</option><option value="critical">Crítica</option><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option></select></label>
    </div>
    <section className="organization-list" aria-label="Alertas por organización">
      {groups.map(({ organization, alerts, inbox }) => {
        const canAct = ["owner", "admin", "operator"].includes(organization.role);
        const visible = alerts.filter((alert) => (!state || alert.state === state) && (!severity || alert.severity === severity));
        return <article className="organization-card device-card" key={organization.id}>
          <header><div><span className="aero-kicker">{organization.role}</span><h2>{organization.name}</h2></div><strong>{visible.length} alertas · {inbox.unreadCount} sin leer</strong></header>
          {inbox.items.filter((item) => !item.readAt).slice(0, 3).map((notification) => <div className="device-row" key={notification.id}>
            <div className="device-state"><strong>{notification.title}</strong><span>{notification.body}</span></div>
            <button className="text-button" onClick={() => void read(organization.id, notification.id)}>Marcar leída</button>
          </div>)}
          {visible.length ? <div className="device-list">{visible.map((alert) => <div className="device-row" key={alert.id}>
            <div className="device-state"><strong>{alert.severity} · {alert.state}</strong><span>{alert.message}</span><span>{alert.metric}: {alert.observedValue} · {new Date(alert.openedAt).toLocaleString("es-ES")}</span></div>
            {canAct ? <div className="device-actions">
              {alert.state === "open" ? <button className="text-button" disabled={pending === `${alert.id}:acknowledge`} onClick={() => void act(organization.id, alert.id, "acknowledge")}>Reconocer</button> : null}
              {["open", "acknowledged"].includes(alert.state) ? <button className="text-button" disabled={pending === `${alert.id}:silence`} onClick={() => void act(organization.id, alert.id, "silence")}>Silenciar</button> : null}
              {alert.state !== "resolved" ? <button className="aero-button" disabled={pending === `${alert.id}:resolve`} onClick={() => void act(organization.id, alert.id, "resolve")}>Resolver</button> : null}
            </div> : <span className="organization-note">Solo lectura</span>}
          </div>)}</div> : <p className="organization-note">No hay alertas con estos filtros.</p>}
        </article>;
      })}
    </section>
  </>;
}
