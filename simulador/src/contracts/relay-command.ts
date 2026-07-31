import { z } from 'zod';
import { deviceIdSchema, isoDateSchema, tenantIdSchema } from './common';

export const relayCommandSchema = z
  .object({
    commandId: z.string().min(1).max(128),
    nonce: z.string().min(1).max(128),
    tenantId: tenantIdSchema,
    deviceId: deviceIdSchema,
    commandType: z.literal('relay.set'),
    issuedAt: isoDateSchema,
    expiresAt: isoDateSchema,
    payload: z.object({
      state: z.enum(['on', 'off']),
    }),
  })
  .strict()
  .refine(
    (command) =>
      new Date(command.expiresAt).getTime() >
      new Date(command.issuedAt).getTime(),
    { message: 'expiresAt must be after issuedAt', path: ['expiresAt'] },
  );

export type RelayCommand = z.infer<typeof relayCommandSchema>;
