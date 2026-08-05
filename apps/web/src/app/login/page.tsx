import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="login-page">
      <Link className="marketing-brand login-brand" href="/"><span className="aero-orb">SH</span><span>Smart House</span></Link>
      <section className="login-card">
        <p className="aero-kicker">Acceso al panel</p>
        <h1>Bienvenido de vuelta.</h1>
        <p>Accede con la cuenta administrada por la organización.</p>
        <Link className="aero-button login-submit" href="/auth/login">Continuar con Keycloak <span>→</span></Link>
        <small>Registro, recuperación de contraseña y MFA se administran desde Keycloak.</small>
      </section>
    </main>
  );
}
