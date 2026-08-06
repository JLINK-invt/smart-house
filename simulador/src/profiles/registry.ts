import type { SimulationProfile, SimulationProfileName } from './profile';

const normal: SimulationProfile = {
  name: 'normal',
  description: 'Publicacion estable y comandos de relay exitosos.',
  temperature: { minimum: 18, maximum: 30 },
  duplicateRate: 0,
  invalidPayloadRate: 0,
  disconnectEveryMessages: null,
  reconnectAfterMs: 0,
  relayCommandDelayMs: 100,
  relayFailureRate: 0,
  burstRate: 0,
  burstSize: 1,
};

export const simulationProfiles: ReadonlyMap<
  SimulationProfileName,
  SimulationProfile
> = new Map([
  [normal.name, normal],
  [
    'duplicate-messages',
    {
      ...normal,
      name: 'duplicate-messages',
      description: 'Republica aproximadamente uno de cada cinco mensajes.',
      duplicateRate: 0.2,
    },
  ],
  [
    'invalid-payloads',
    {
      ...normal,
      name: 'invalid-payloads',
      description: 'Emite una proporcion controlada de payloads invalidos.',
      invalidPayloadRate: 0.15,
    },
  ],
  [
    'unstable-network',
    {
      ...normal,
      name: 'unstable-network',
      description: 'Programa desconexiones y reconexiones periodicas.',
      disconnectEveryMessages: 5,
      reconnectAfterMs: 3_000,
    },
  ],
  [
    'relay-failures',
    {
      ...normal,
      name: 'relay-failures',
      description: 'Introduce latencia y fallos controlados en el relay.',
      relayCommandDelayMs: 1_500,
      relayFailureRate: 0.2,
    },
  ],
  [
    'burst',
    {
      ...normal,
      name: 'burst',
      description:
        'Publica rafagas de telemetria validas para pruebas de carga.',
      burstRate: 1,
      burstSize: 20,
    },
  ],
]);
