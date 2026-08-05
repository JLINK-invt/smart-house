"use client";

export default function DashboardError() {
  return (
    <main className="shell dashboard-shell">
      <p className="eyebrow">Panel no disponible</p>
      <p className="intro">
        No se pudo cargar el panel. Vuelve a intentarlo cuando la API esté
        disponible.
      </p>
    </main>
  );
}
