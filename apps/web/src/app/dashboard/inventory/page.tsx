import { cookies } from "next/headers";
import {
  createDevice,
  disableDevice,
  enableDevice,
  revokeDeviceCredential,
  updateDevice,
} from "./actions";
import { ActivationTokenForm } from "./activation-token-form";
import { CredentialRotationForm } from "./credential-rotation-form";
import { accessTokenCookie } from "@/lib/auth";
import {
  getCapabilityCatalog,
  getDeviceCredentials,
  getDevices,
  getOrganizations,
  UnauthorizedApiError,
  type DeviceListQuery,
  type Organization,
} from "@/lib/api";
import { redirectExpiredSession } from "@/lib/session";

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function listQuery(searchParams: SearchParams): DeviceListQuery {
  const limit = firstValue(searchParams.limit);
  return {
    q: firstValue(searchParams.q),
    status: firstValue(searchParams.status),
    type: firstValue(searchParams.type),
    limit: limit ? Number(limit) : undefined,
  };
}

function paginationUrl(
  searchParams: SearchParams,
  organizationId: string,
  currentCursor: string | undefined,
  history: string[],
  nextCursor: string | null,
  direction: "next" | "previous",
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  const cursorKey = `cursor.${organizationId}`;
  const historyKey = `history.${organizationId}`;
  const nextHistory =
    direction === "next"
      ? [...history, currentCursor ?? "root"]
      : history.slice(0, -1);
  const cursor =
    direction === "next"
      ? nextCursor
      : history.at(-1) === "root"
        ? undefined
        : history.at(-1);

  if (cursor) params.set(cursorKey, cursor);
  else params.delete(cursorKey);
  if (nextHistory.length) params.set(historyKey, nextHistory.join("."));
  else params.delete(historyKey);
  return `/dashboard/inventory?${params.toString()}`;
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const accessToken = (await cookies()).get(accessTokenCookie)?.value ?? "";
  let organizations: Organization[];
  try {
    organizations = await getOrganizations(accessToken);
  } catch (error) {
    redirectExpiredSession(error);
  }
  const filters = listQuery(resolvedSearchParams);
  const devicesByOrganization = await Promise.all(
    organizations.map(async (organization) => {
      const canManage =
        organization.role === "owner" || organization.role === "admin";
      const cursor = firstValue(
        resolvedSearchParams[`cursor.${organization.id}`],
      );
      const history = (
        firstValue(resolvedSearchParams[`history.${organization.id}`]) ?? ""
      )
        .split(".")
        .filter(Boolean);
      try {
        const [devicePage, catalog] = await Promise.all([
          getDevices(accessToken, organization.id, { ...filters, cursor }),
          getCapabilityCatalog(accessToken, organization.id),
        ]);
        const devices = await Promise.all(
          devicePage.items.map(async (device) => ({
            ...device,
            credentials: canManage
              ? await getDeviceCredentials(
                  accessToken,
                  organization.id,
                  device.id,
                )
              : [],
          })),
        );
        return {
          organization,
          canManage,
          catalog,
          cursor,
          history,
          devicePage: { ...devicePage, items: devices },
          error: null,
        };
      } catch (error) {
        if (error instanceof UnauthorizedApiError) {
          redirectExpiredSession(error);
        }
        return {
          organization,
          canManage,
          catalog: [],
          cursor,
          history,
          devicePage: { items: [], nextCursor: null },
          error: "No se pudo cargar el inventario de esta organización.",
        };
      }
    }),
  );

  return (
    <section className="feature-page organization-page">
      <header className="feature-hero">
        <p className="aero-kicker">Dispositivos</p>
        <h1>Gestión de dispositivos</h1>
        <p>
          Busca y filtra el inventario de cada organización disponible. Los
          filtros quedan reflejados en la URL para compartirlos.
        </p>
      </header>
      <form className="inventory-filters" method="get">
        <label>
          Buscar
          <input
            name="q"
            defaultValue={filters.q}
            placeholder="Nombre o ID externo"
          />
        </label>
        <label>
          Estado
          <select name="status" defaultValue={filters.status ?? ""}>
            <option value="">Todos</option>
            <option value="inactive">Inactivo</option>
            <option value="offline">Sin conexión</option>
            <option value="online">En línea</option>
            <option value="disabled">Desactivado</option>
          </select>
        </label>
        <label>
          Tipo
          <input name="type" defaultValue={filters.type} placeholder="relay" />
        </label>
        <label>
          Por página
          <select name="limit" defaultValue={String(filters.limit ?? 25)}>
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>
        <button className="aero-button" type="submit">
          Aplicar filtros
        </button>
      </form>
      <section
        className="organization-list"
        aria-label="Dispositivos por organización"
      >
        {!devicesByOrganization.length ? (
          <p className="organization-note">
            No perteneces a ninguna organización.
          </p>
        ) : null}
        {devicesByOrganization.map(
          ({
            organization,
            canManage,
            catalog,
            cursor,
            history,
            devicePage,
            error,
          }) => (
            <article
              className="organization-card device-card"
              key={organization.id}
            >
              <header>
                <div>
                  <span className="aero-kicker">{organization.role}</span>
                  <h2>{organization.name}</h2>
                </div>
                <strong>{devicePage.items.length} dispositivos visibles</strong>
              </header>
              {error ? <p className="organization-note">{error}</p> : null}
              {!error && devicePage.items.length ? (
                <div className="device-list">
                  {devicePage.items.map((device) => (
                    <div className="device-row" key={device.id}>
                      <form
                        action={updateDevice.bind(
                          null,
                          organization.id,
                          device.id,
                        )}
                        className="device-form"
                      >
                         <div className="device-state">
                           <strong>Estado: {device.status}</strong>
                           <a
                             className="device-detail-link"
                             href={`/dashboard/inventory/${organization.id}/${device.id}`}
                           >
                             Ver detalle y gráficas
                           </a>
                           <span>
                            {device.externalId} · {device.capabilityVersion}
                          </span>
                          <span>
                            Última señal:{" "}
                            {device.lastSeenAt
                              ? new Date(device.lastSeenAt).toLocaleString()
                              : "sin telemetría"}
                          </span>
                        </div>
                        <label>
                          Nombre
                          <input
                            name="name"
                            required
                            defaultValue={device.name}
                            disabled={!canManage}
                          />
                        </label>
                        <label>
                          Tipo
                          <select
                            name="type"
                            defaultValue={device.type}
                            disabled={!canManage}
                          >
                            {catalog.map((profile) => (
                              <option
                                key={`${profile.type}:${profile.version}`}
                                value={profile.type}
                              >
                                {profile.type}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          ID externo
                          <input
                            name="externalId"
                            required
                            defaultValue={device.externalId}
                            disabled={!canManage}
                          />
                        </label>
                        <label>
                          Versión
                          <select
                            name="capabilityVersion"
                            defaultValue={device.capabilityVersion}
                            disabled={!canManage}
                          >
                            {catalog
                              .filter((profile) => profile.type === device.type)
                              .map((profile) => (
                                <option
                                  key={profile.version}
                                  value={profile.version}
                                >
                                  {profile.version}
                                </option>
                              ))}
                          </select>
                        </label>
                        <p className="organization-note">
                          {catalog
                            .find(
                              (profile) =>
                                profile.type === device.type &&
                                profile.version === device.capabilityVersion,
                            )
                            ?.metrics.join(", ") || "Sin métricas"}{" "}
                          ·{" "}
                          {catalog
                            .find(
                              (profile) =>
                                profile.type === device.type &&
                                profile.version === device.capabilityVersion,
                            )
                            ?.commands.join(", ") || "Sin comandos"}
                        </p>
                        {canManage ? (
                          <div className="device-actions">
                            <button className="aero-button" type="submit">
                              Guardar
                            </button>
                            {device.status === "disabled" ? (
                              <button
                                className="text-button"
                                formAction={enableDevice.bind(
                                  null,
                                  organization.id,
                                  device.id,
                                )}
                              >
                                Habilitar
                              </button>
                            ) : (
                              <button
                                className="text-button"
                                formAction={disableDevice.bind(
                                  null,
                                  organization.id,
                                  device.id,
                                )}
                              >
                                Desactivar
                              </button>
                            )}
                          </div>
                        ) : null}
                      </form>
                      {canManage ? (
                        <section
                          className="credential-panel"
                          aria-label={`Credenciales de ${device.name}`}
                        >
                          <div className="credential-panel-head">
                            <strong>Credenciales</strong>
                            <span>{device.credentials.length} registradas</span>
                          </div>
                          {device.credentials.length ? (
                            <ul className="credential-list">
                              {device.credentials.map((credential) => (
                                <li key={credential.credentialReference}>
                                  <span>
                                    <b>{credential.status}</b> · Emitida:{" "}
                                    {new Date(
                                      credential.issuedAt,
                                    ).toLocaleString()}
                                    {credential.revokedAt
                                      ? ` · Revocada: ${new Date(credential.revokedAt).toLocaleString()}`
                                      : ""}
                                  </span>
                                  {credential.status === "active" ? (
                                    <form
                                      action={revokeDeviceCredential.bind(
                                        null,
                                        organization.id,
                                        device.id,
                                        credential.credentialReference,
                                      )}
                                    >
                                      <button
                                        className="text-button credential-revoke"
                                        type="submit"
                                      >
                                        Revocar
                                      </button>
                                    </form>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="organization-note">
                              No hay credenciales provisionadas.
                            </p>
                          )}
                          <div className="credential-actions">
                            <ActivationTokenForm
                              organizationId={organization.id}
                              deviceId={device.id}
                              disabled={device.status === "disabled"}
                            />
                            <CredentialRotationForm
                              organizationId={organization.id}
                              deviceId={device.id}
                              disabled={device.status === "disabled"}
                            />
                          </div>
                        </section>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : !error ? (
                <p className="organization-note">
                  No hay dispositivos que coincidan con los filtros.
                </p>
              ) : null}
              {!error ? (
                <nav
                  className="inventory-pagination"
                  aria-label={`Paginación de ${organization.name}`}
                >
                  {history.length ? (
                    <a
                      className="text-button"
                      href={paginationUrl(
                        resolvedSearchParams,
                        organization.id,
                        cursor,
                        history,
                        null,
                        "previous",
                      )}
                    >
                      Anterior
                    </a>
                  ) : (
                    <span />
                  )}
                  {devicePage.nextCursor ? (
                    <a
                      className="text-button"
                      href={paginationUrl(
                        resolvedSearchParams,
                        organization.id,
                        cursor,
                        history,
                        devicePage.nextCursor,
                        "next",
                      )}
                    >
                      Siguiente
                    </a>
                  ) : (
                    <span />
                  )}
                </nav>
              ) : null}
              {canManage ? (
                <form
                  action={createDevice.bind(null, organization.id)}
                  className="member-form device-create"
                >
                  <label>Nuevo dispositivo</label>
                  <input name="name" required placeholder="Luz de cocina" />
                  <select name="type" required defaultValue="">
                    <option value="" disabled>
                      Tipo
                    </option>
                    {[...new Set(catalog.map((profile) => profile.type))].map(
                      (type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ),
                    )}
                  </select>
                  <select name="capabilityVersion" required defaultValue="">
                    <option value="" disabled>
                      Versión
                    </option>
                    {[
                      ...new Set(catalog.map((profile) => profile.version)),
                    ].map((version) => (
                      <option key={version} value={version}>
                        {version}
                      </option>
                    ))}
                  </select>
                  <input
                    name="externalId"
                    required
                    placeholder="tuya-kitchen-01"
                  />
                  <button className="aero-button" type="submit">
                    Registrar dispositivo
                  </button>
                </form>
              ) : (
                <p className="organization-note">
                  Tu rol permite consultar dispositivos, no administrarlos.
                </p>
              )}
            </article>
          ),
        )}
      </section>
    </section>
  );
}
