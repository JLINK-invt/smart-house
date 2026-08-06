export type SimulationProfileName =
  | 'normal'
  | 'duplicate-messages'
  | 'invalid-payloads'
  | 'unstable-network'
  | 'relay-failures'
  | 'burst';

export interface SimulationProfile {
  name: SimulationProfileName;
  description: string;
  temperature: {
    minimum: number;
    maximum: number;
  };
  duplicateRate: number;
  invalidPayloadRate: number;
  disconnectEveryMessages: number | null;
  reconnectAfterMs: number;
  relayCommandDelayMs: number;
  relayFailureRate: number;
  burstRate: number;
  burstSize: number;
}
