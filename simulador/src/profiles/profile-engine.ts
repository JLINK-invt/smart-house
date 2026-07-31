import type { SimulationProfile, SimulationProfileName } from './profile';
import { simulationProfiles } from './registry';

export class ProfileEngine {
  constructor(
    private readonly enabled: boolean,
    private readonly profileName: SimulationProfileName,
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
}
