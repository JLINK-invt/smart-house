export interface PublishOptions {
  qos: 1;
}

export interface MqttPublisher {
  publish(
    topic: string,
    payload: string,
    options: PublishOptions,
  ): Promise<void>;
}

export type MqttCommandHandler = (
  topic: string,
  payload: Buffer,
) => Promise<void>;
