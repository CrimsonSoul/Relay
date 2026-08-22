import { EventSource as MainProcessEventSource } from 'eventsource';

export function installMainProcessEventSource(): void {
  if ((globalThis.EventSource as typeof globalThis.EventSource | undefined) === undefined) {
    globalThis.EventSource = MainProcessEventSource as unknown as typeof globalThis.EventSource;
  }
}
