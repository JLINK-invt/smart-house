type FeaturePageProps = {
  eyebrow: string;
  title: string;
  description: string;
  cards: Array<{ title: string; value: string; detail: string }>;
};

export function FeaturePage({ eyebrow, title, description, cards }: FeaturePageProps) {
  return (
    <section className="feature-page">
      <header className="feature-hero">
        <p className="aero-kicker">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <div className="feature-grid">
        {cards.map((card) => (
          <article className="feature-card" key={card.title}>
            <span>{card.title}</span>
            <strong>{card.value}</strong>
            <p>{card.detail}</p>
          </article>
        ))}
      </div>
      <div className="empty-state">
        <div className="empty-orb" aria-hidden="true" />
        <div>
          <h2>Listo para recibir datos reales</h2>
          <p>La interfaz y los límites de seguridad están preparados. El contenido aparecerá al conectar la flota Tuya.</p>
        </div>
      </div>
    </section>
  );
}
