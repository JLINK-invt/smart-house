import Link from "next/link";
import { getApiStatus } from "@/lib/api";

const capabilities = [
  { code: "01", title: "Organizaciones y miembros", text: "Aísla dispositivos, datos y permisos por organización." },
  { code: "02", title: "Dispositivos", text: "Registra y administra sensores, relays y focos Tuya." },
  { code: "03", title: "Telemetría", text: "Consulta temperatura, humedad, batería y estados en tiempo real." },
  { code: "04", title: "Comandos", text: "Ejecuta acciones autorizadas y confirma cada resultado." },
  { code: "05", title: "Alertas", text: "Detecta umbrales y dispositivos offline antes de que escalen." },
];

export default async function Home() {
  const api = await getApiStatus();

  return (
    <main className="marketing-page">
      <nav className="marketing-nav" aria-label="Navegación principal">
        <Link className="marketing-brand" href="/">
          <span className="aero-orb">SH</span>
          <span>Smart House</span>
        </Link>
        <div className="marketing-links">
          <a href="#funciones">Funciones</a>
          <a href="#actividad">Actividad</a>
          <Link className="nav-login" href="/login">Iniciar sesión</Link>
        </div>
      </nav>

      <section className="product-hero">
        <div>
          <p className="aero-kicker">Tu hogar, en un vistazo</p>
          <h1>Todo lo que importa. <em>Siempre a la vista.</em></h1>
          <p className="product-intro">
            Smart House conecta sensores, relays y focos para que monitorees,
            controles y respondas desde un solo panel.
          </p>
          <div className="hero-actions">
            <Link className="aero-button" href="/login">Entrar al panel <span>→</span></Link>
            <a className="text-button" href="#funciones">Explorar funciones</a>
          </div>
          <p className="api-note">
            <span className={`live-dot ${api.state === "online" ? "" : "offline-dot"}`} />
            Plataforma {api.state === "online" ? "operativa" : "en preparación"}
          </p>
        </div>
        <div className="hero-window" aria-label="Vista previa del panel Smart House">
          <div className="window-bar"><span /><span /><span /><strong>Mi dashboard</strong></div>
          <div className="window-content">
            <div className="window-greeting"><span>Buenos días</span><strong>Tu casa está en calma</strong></div>
            <div className="home-status-grid">
              <div><small>Dispositivos</small><b>0</b><span>Listos para registrar</span></div>
              <div><small>Alertas</small><b>0</b><span>Sin alertas abiertas</span></div>
            </div>
            <div className="activity-preview"><span>Actividad reciente</span><p>Conecta tu primer dispositivo para comenzar.</p></div>
          </div>
        </div>
      </section>

      <section className="capabilities" id="funciones">
        <div className="section-head"><p className="aero-kicker">Módulos del MVP</p><h2>Todo lo necesario para operar una flota conectada.</h2></div>
        <div className="capability-grid">
          {capabilities.map((capability) => <article key={capability.code}><span>{capability.code}</span><h3>{capability.title}</h3><p>{capability.text}</p></article>)}
        </div>
      </section>

      <section className="activity-section" id="actividad">
        <div><p className="aero-kicker">Actividad</p><h2>Tu espacio operativo, listo para crecer.</h2></div>
        <div className="activity-card"><span className="empty-orb" /><div><strong>No hay actividad todavía</strong><p>Cuando conectes dispositivos, aquí verás telemetría, comandos y alertas en tiempo real.</p></div><Link href="/login">Abrir dashboard →</Link></div>
      </section>
    </main>
  );
}
