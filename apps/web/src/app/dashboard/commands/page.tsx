import Link from "next/link";

export default function CommandsPage() {
  return (
    <section className="feature-page">
      <header className="feature-hero">
        <p className="aero-kicker">Control</p>
        <h1>Comandos</h1>
        <p>Los comandos se emiten desde el detalle de cada dispositivo para mostrar únicamente las acciones compatibles, solicitar confirmación y seguir su ACK.</p>
      </header>
      <article className="feature-card">
        <h2>Control seguro por dispositivo</h2>
        <p>Los cambios de estado del relé requieren una confirmación explícita. Tras enviarlo, el botón queda bloqueado y el historial indica si fue enviado, confirmado, rechazado o expiró.</p>
        <Link className="text-button" href="/dashboard/inventory">Abrir inventario</Link>
      </article>
    </section>
  );
}
