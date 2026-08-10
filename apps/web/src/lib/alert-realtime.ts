import { alertStatusEventSchema, type AlertStatusEvent } from "@smart-house/contracts";
import type { Alert } from "./api";

export function parseAlertStatusEvent(value: unknown): AlertStatusEvent | null {
  const event = alertStatusEventSchema.safeParse(value);
  return event.success ? event.data : null;
}

export function mergeAlertStatus(current: readonly Alert[], event: AlertStatusEvent): Alert[] {
  return [event.alert, ...current.filter(({ id }) => id !== event.alert.id)].sort(
    (left, right) => Date.parse(right.openedAt) - Date.parse(left.openedAt),
  );
}
