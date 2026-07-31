import { randomUUID } from 'node:crypto';

export class MessageIdGenerator {
  private sequence = 0;

  constructor(
    private readonly prefix: string,
    private readonly instanceId = randomUUID().slice(0, 8),
  ) {}

  next(): string {
    this.sequence += 1;
    return `${this.prefix}-${this.instanceId}-${String(this.sequence).padStart(6, '0')}`;
  }
}
