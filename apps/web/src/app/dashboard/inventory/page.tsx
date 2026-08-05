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
} from "@/lib/api";

export default async function InventoryPage() {
  const accessToken = (await cookies()).get(accessTokenCookie)?.value ?? "";
  const organizations = await getOrganizations(accessToken);
  const devicesByOrganization = await Promise.all(
    organizations.map(async (organization) => {
      const [devices, catalog] = await Promise.all([
        getDevices(accessToken, organization.id),
        getCapabilityCatalog(accessToken, organization.id),
      ]);
      return {
        organization,
        catalog,
        devices: await Promise.all(
          devices.map(async (device) => ({
            ...device,
            credentials: await getDeviceCredentials(
              accessToken,
              organization.id,
              device.id,
            ),
          })),
        ),
      };
    }),
  );

  return (
    <section className="feature-page organization-page">
      <header className="feature-hero">
        <p className="aero-kicker">Dispositivos</p>
        <h1>Gestión de dispositivos</h1>
        <p>
          Registra, consulta, edita y desactiva los dispositivos de cada
          organización disponible.
        </p>
      </header>
      <section
        className="organization-list"
        aria-label="Dispositivos por organización"
      >
        {devicesByOrganization.map(({ organization, devices, catalog }) => {
          const canManage =
            organization.role === "owner" || organization.role === "admin";
          return (
            <article
              className="organization-card device-card"
              key={organization.id}
            >
              <header>
                <div>
                  <span className="aero-kicker">{organization.role}</span>
                  <h2>{organization.name}</h2>
                </div>
                <strong>{devices.length} dispositivos</strong>
              </header>
              {devices.length ? (
                <div className="device-list">
                  {devices.map((device) => (
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
                          <span>
                            {device.externalId} · {device.capabilityVersion}
                          </span>
                          <span>
                            Última señal: {device.lastSeenAt
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
                        {canManage && (
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
                        )}
                      </form>
                      {canManage && (
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
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="organization-note">
                  Aún no hay dispositivos vinculados.
                </p>
              )}
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
          );
        })}
      </section>
    </section>
  );
}
