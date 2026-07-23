import { getApiStatus } from "@/lib/api";

export default async function Home() {
  const api = await getApiStatus();
  const isOnline = api.state === "online";
  const checkedAt = isOnline
    ? new Intl.DateTimeFormat("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "UTC",
      }).format(new Date(api.data.timestamp))
    : "sin respuesta";

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Smart House, inicio">
          <span className="brand-mark">SH</span>
          <span>Smart House</span>
        </a>
        <span className="edition">Sistema 01 / Base</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Infraestructura domestica</p>
          <h1>Una base clara para una casa conectada.</h1>
          <p className="intro">
            Interfaz, reglas de negocio y contratos separados desde el primer
            dia. Sin complejidad distribuida antes de necesitarla.
          </p>
        </div>

        <aside className="status-card" aria-label="Estado del sistema">
          <div className="status-heading">
            <span className={`status-dot ${isOnline ? "online" : "offline"}`} />
            <span>API {isOnline ? "operativa" : "desconectada"}</span>
          </div>
          <dl>
            <div>
              <dt>Ruta</dt>
              <dd>/api/health</dd>
            </div>
            <div>
              <dt>Revision UTC</dt>
              <dd>{checkedAt}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="architecture" aria-labelledby="architecture-title">
        <div className="section-label">
          <span>01</span>
          <h2 id="architecture-title">Arquitectura inicial</h2>
        </div>

        <div className="layers">
          <article>
            <span className="layer-index">A</span>
            <div>
              <h3>Web</h3>
              <p>Next.js entrega la interfaz y gestiona el estado visual.</p>
            </div>
            <code>apps/web</code>
          </article>
          <article>
            <span className="layer-index">B</span>
            <div>
              <h3>API</h3>
              <p>NestJS concentra negocio, seguridad y persistencia futura.</p>
            </div>
            <code>apps/api</code>
          </article>
          <article>
            <span className="layer-index">C</span>
            <div>
              <h3>Contratos</h3>
              <p>Zod valida el transporte sin filtrar detalles de framework.</p>
            </div>
            <code>packages/contracts</code>
          </article>
        </div>
      </section>

      <footer>
        <span>Monolito modular / pnpm workspace</span>
        <code>pnpm dev</code>
      </footer>
    </main>
  );
}
