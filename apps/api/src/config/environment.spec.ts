import { readEnvironment } from './environment';

describe('readEnvironment', () => {
  it('uses safe development defaults', () => {
    expect(readEnvironment({})).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
    });
  });

  it('rejects invalid ports before the server starts', () => {
    expect(() => readEnvironment({ PORT: '70000' })).toThrow();
  });
});
