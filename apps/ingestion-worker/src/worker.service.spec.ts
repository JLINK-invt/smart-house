import { WorkerService } from './worker.service';

describe('WorkerService', () => {
  it('is constructible before an MQTT adapter is configured', () => {
    expect(new WorkerService()).toBeInstanceOf(WorkerService);
  });
});
