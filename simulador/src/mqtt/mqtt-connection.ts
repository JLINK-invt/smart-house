import {
  connect as connectMqtt,
  type IClientOptions,
  type MqttClient,
} from 'mqtt';
import { readFileSync } from 'node:fs';
import type { SimulatorConfig } from '../config';
import { log } from '../logger';
import type {
  MqttCommandHandler,
  MqttPublisher,
  PublishOptions,
} from './transport';

export class MqttConnection implements MqttPublisher {
  private client?: MqttClient;
  private commandHandler?: MqttCommandHandler;

  constructor(
    private readonly config: SimulatorConfig,
    private readonly identity: {
      clientId: string;
      certFile: string;
      keyFile: string;
      commandTopic?: string;
    },
  ) {}

  setCommandHandler(handler: MqttCommandHandler): void {
    this.commandHandler = handler;
  }

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    const options: IClientOptions = {
      clientId: this.identity.clientId,
      ca: readFileSync(this.config.MQTT_CA_FILE),
      cert: readFileSync(this.identity.certFile),
      key: readFileSync(this.identity.keyFile),
      rejectUnauthorized: true,
      protocolVersion: 5,
      clean: false,
      properties: {
        sessionExpiryInterval: this.config.MQTT_SESSION_EXPIRY_SECONDS,
      },
      reconnectPeriod: this.config.MQTT_RECONNECT_PERIOD_MS,
      connectTimeout: 10_000,
      resubscribe: false,
    };
    const client = connectMqtt(this.config.MQTT_URL, options);
    this.client = client;

    client.on('reconnect', () => {
      log('warn', 'mqtt.reconnecting', { url: this.config.MQTT_URL });
    });
    client.on('offline', () => {
      log('warn', 'mqtt.offline');
    });
    client.on('error', (error) => {
      log('error', 'mqtt.error', { message: error.message });
    });
    client.on('message', (topic, payload) => {
      if (!this.commandHandler) {
        return;
      }

      void this.commandHandler(topic, payload).catch((error: unknown) => {
        log('error', 'mqtt.command_handler_failed', {
          message: error instanceof Error ? error.message : 'Unknown error',
          topic,
        });
      });
    });

    await new Promise<void>((resolve, reject) => {
      let initialConnection = true;

      client.on('connect', () => {
        const commandTopic = this.identity.commandTopic;
        if (!commandTopic) {
          if (initialConnection) {
            initialConnection = false;
            resolve();
          }
          return;
        }
        // Re-subscribing is idempotent and recovers a broker-restarted session.
        client.subscribe(commandTopic, { qos: 1 }, (error) => {
          if (error) {
            log('error', 'mqtt.subscription_failed', {
              message: error.message,
              topic: commandTopic,
            });
            if (initialConnection) {
              initialConnection = false;
              reject(error);
            }
            return;
          }

          log('info', 'mqtt.connected', {
            clientId: this.identity.clientId,
            commandTopic,
          });
          if (initialConnection) {
            initialConnection = false;
            resolve();
          }
        });
      });
    });
  }

  async publish(
    topic: string,
    payload: string,
    options: PublishOptions,
  ): Promise<void> {
    const client = this.client;
    if (!client) {
      throw new Error('MQTT client is not connected');
    }

    await new Promise<void>((resolve, reject) => {
      client.publish(topic, payload, options, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    const client = this.client;
    this.client = undefined;
    await new Promise<void>((resolve, reject) =>
      client.end(false, {}, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }),
    );
    log('info', 'mqtt.disconnected');
  }

  async reconnectAfter(delayMs: number): Promise<void> {
    await this.disconnect();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await this.connect();
    log('info', 'mqtt.reconnected_after_profile_disconnect', { delayMs });
  }
}
