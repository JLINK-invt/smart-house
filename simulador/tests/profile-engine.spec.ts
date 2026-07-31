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
    ]);
  });

  it('keeps the selected profile inactive by default', () => {
    const engine = new ProfileEngine(false, 'unstable-network');

    expect(engine.selectedProfile().disconnectEveryMessages).toBe(5);
    expect(engine.activeProfile()).toBeNull();
  });
});
