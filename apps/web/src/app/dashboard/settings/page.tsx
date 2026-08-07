import { cookies } from "next/headers";
import { addMember, createOrganization } from "./actions";
import { accessTokenCookie } from "@/lib/auth";
import {
  getOrganizationMembers,
  getOrganizations,
  type Organization,
  type OrganizationMember,
} from "@/lib/api";
import { redirectExpiredSession } from "@/lib/session";

export default async function SettingsPage() {
  const accessToken = (await cookies()).get(accessTokenCookie)?.value ?? "";
  let membersByOrganization: {
    organization: Organization;
    members: OrganizationMember[];
  }[];
  try {
    const organizations = await getOrganizations(accessToken);
    membersByOrganization = await Promise.all(
      organizations.map(async (organization) => ({
        organization,
        members: await getOrganizationMembers(accessToken, organization.id),
      })),
    );
  } catch (error) {
    redirectExpiredSession(error);
  }

  return (
    <section className="feature-page organization-page">
      <header className="feature-hero">
        <p className="aero-kicker">Tenancy</p>
        <h1>Organizaciones y miembros</h1>
        <p>Gestiona los espacios de trabajo y limita los permisos de cada persona antes de operar una flota.</p>
      </header>

      <section className="organization-create" aria-labelledby="create-organization-title">
        <div>
          <span className="aero-kicker">Nueva organización</span>
          <h2 id="create-organization-title">Crea un espacio aislado</h2>
        </div>
        <form action={createOrganization}>
          <label htmlFor="organization-name">Nombre</label>
          <input id="organization-name" name="name" required placeholder="Casa del lago" />
          <button className="aero-button" type="submit">Crear organización</button>
        </form>
      </section>

      <section className="organization-list" aria-label="Organizaciones disponibles">
        {membersByOrganization.map(({ organization, members }) => {
          const canManage = organization.role === "owner" || organization.role === "admin";
          return (
            <article className="organization-card" key={organization.id}>
              <header>
                <div>
                  <span className="aero-kicker">{organization.role}</span>
                  <h2>{organization.name}</h2>
                </div>
                <strong>{members.length} miembros</strong>
              </header>
              <ul>
                {members.map((member) => <li key={member.email}><span>{member.email}</span><b>{member.role}</b></li>)}
              </ul>
              {canManage ? (
                <form action={addMember.bind(null, organization.id)} className="member-form">
                  <label htmlFor={`email-${organization.id}`}>Añadir miembro registrado</label>
                  <input id={`email-${organization.id}`} name="email" type="email" required placeholder="persona@hogar.com" />
                  <select name="role" defaultValue="viewer"><option value="admin">Admin</option><option value="operator">Operator</option><option value="viewer">Viewer</option></select>
                  <button className="aero-button" type="submit">Añadir miembro</button>
                </form>
              ) : <p className="organization-note">Tu rol permite consultar miembros, no administrarlos.</p>}
            </article>
          );
        })}
      </section>
    </section>
  );
}
