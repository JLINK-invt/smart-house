import Link from "next/link";
import { startPreviewSession } from "./actions";

export default function LoginPage() {
  return (
    <main className="login-page">
      <Link className="marketing-brand login-brand" href="/"><span className="aero-orb">SH</span><span>Smart House</span></Link>
      <section className="login-card">
        <p className="aero-kicker">Acceso al panel</p>
        <h1>Bienvenido de vuelta.</h1>
        <p>Explora el panel con una sesión local de vista previa mientras conectamos el proveedor de identidad.</p>
        <form action={startPreviewSession}>
          <label htmlFor="email">Correo electrónico</label>
          <input id="email" name="email" type="email" placeholder="tu@hogar.com" required />
          <label htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" placeholder="password" required />
          <button className="aero-button login-submit" type="submit">Acceder en modo vista previa <span>→</span></button>
        </form>
        <small>El acceso OIDC con sesiones reales se habilitará antes del piloto.</small>
      </section>
    </main>
  );
}
