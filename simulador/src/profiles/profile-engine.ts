import type { SimulationProfile, SimulationProfileName } from './profile';
import { simulationProfiles } from './registry';

export interface TelemetryProfileDecision {
  minimum: number;
  maximum: number;
  duplicate: boolean;
  invalidPayload: boolean;
  messageCount: number;
  reconnectAfterMs: number | null;
}

export interface RelayProfileDecision {
  delayMs: number;
  fail: boolean;
}

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const character of seed) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export class ProfileEngine {
  constructor(
    private readonly enabled: boolean,
    private readonly profileName: SimulationProfileName,
    seed = 'smart-house',
    private readonly random: () => number = seededRandom(seed),
  ) {}

  selectedProfile(): SimulationProfile {
    const profile = simulationProfiles.get(this.profileName);
    if (!profile) {
      throw new Error(`Unknown simulation profile: ${this.profileName}`);
    }
    return profile;
  }

  activeProfile(): SimulationProfile | null {
    return this.enabled ? this.selectedProfile() : null;
  }

  nextTelemetryDecision(): TelemetryProfileDecision | null {
    const profile = this.activeProfile();
    if (!profile) {
      return null;
    }

    return {
      minimum: profile.temperature.minimum,
      maximum: profile.temperature.maximum,
      duplicate: this.random() < profile.duplicateRate,
      invalidPayload: this.random() < profile.invalidPayloadRate,
      messageCount: this.random() < profile.burstRate ? profile.burstSize : 1,
      reconnectAfterMs:
        profile.disconnectEveryMessages !== null &&
        this.randomMessageCount(profile.disconnectEveryMessages)
          ? profile.reconnectAfterMs
          : null,
    };
  }

  nextTemperature(minimum: number, maximum: number): number {
    return Number((minimum + this.random() * (maximum - minimum)).toFixed(1));
  }

  nextRelayDecision(defaultDelayMs: number): RelayProfileDecision {
    const profile = this.activeProfile();
    if (!profile) {
      return { delayMs: defaultDelayMs, fail: false };
    }

    return {
      delayMs: profile.relayCommandDelayMs,
      fail: this.random() < profile.relayFailureRate,
    };
  }

  private publishedMessages = 0;

  private randomMessageCount(disconnectEveryMessages: number): boolean {
    this.publishedMessages += 1;
    return this.publishedMessages % disconnectEveryMessages === 0;
  }
}
