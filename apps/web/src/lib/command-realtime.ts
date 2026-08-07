import { commandStatusEventSchema, type CommandStatusEvent } from "@smart-house/contracts";
import type { DeviceCommand } from "./api";

export function parseCommandStatusEvent(value: unknown): CommandStatusEvent | null {
  const event = commandStatusEventSchema.safeParse(value);
  return event.success ? event.data : null;
}

export function mergeCommandStatus(
  current: readonly DeviceCommand[],
  event: CommandStatusEvent,
): DeviceCommand[] {
  const command = event.command;
  const next = [command, ...current.filter(({ id }) => id !== command.id)];
  return next
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 20);
}
