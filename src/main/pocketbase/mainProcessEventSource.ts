import { EventSource as MainProcessEventSource } from 'eventsource';

export function installMainProcessEventSource(): void {
  if (typeof globalThis.EventSource === 'undefined') {
    globalThis.EventSource = MainProcessEventSource as unknown as typeof globalThis.EventSource;
  }
}
