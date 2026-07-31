import type { MqttPublisher, PublishOptions } from '../src/mqtt/transport';

export interface PublishedMessage {
  topic: string;
  payload: string;
  options: PublishOptions;
}

export class FakePublisher implements MqttPublisher {
  readonly messages: PublishedMessage[] = [];

  publish(
    topic: string,
    payload: string,
    options: PublishOptions,
  ): Promise<void> {
    this.messages.push({ topic, payload, options });
    return Promise.resolve();
  }
}
