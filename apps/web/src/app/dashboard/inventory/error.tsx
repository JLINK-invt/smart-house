"use client";

export default function InventoryError({ reset }: { reset: () => void }) {
  return (
    <section className="feature-page organization-page">
      <p className="aero-kicker">Dispositivos</p>
      <h1>No se pudo cargar el inventario</h1>
      <button className="aero-button" onClick={reset} type="button">
        Reintentar
      </button>
    </section>
  );
}
