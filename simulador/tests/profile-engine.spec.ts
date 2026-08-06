import { ProfileEngine } from '../src/profiles/profile-engine';
import { simulationProfiles } from '../src/profiles/registry';

describe('simulation profiles', () => {
  it('registers planned simulation scenarios', () => {
    expect([...simulationProfiles.keys()]).toEqual([
      'normal',
      'duplicate-messages',
      'invalid-payloads',
      'unstable-network',
      'relay-failures',
      'burst',
    ]);
  });

  it('keeps the selected profile inactive by default', () => {
    const engine = new ProfileEngine(false, 'unstable-network');

    expect(engine.selectedProfile().disconnectEveryMessages).toBe(5);
    expect(engine.activeProfile()).toBeNull();
  });

  it('makes profile decisions reproducible from the profile and seed', () => {
    const first = new ProfileEngine(true, 'duplicate-messages', 'load-seed');
    const second = new ProfileEngine(true, 'duplicate-messages', 'load-seed');

    expect(
      Array.from({ length: 8 }, () => first.nextTelemetryDecision()),
    ).toEqual(Array.from({ length: 8 }, () => second.nextTelemetryDecision()));
  });
});
