import React from 'react';
import { PointerSensor } from '@dnd-kit/core';

/**
 * Custom PointerSensor that ignores drag events initiated on resize handles.
 * This prevents column resizing from triggering a header drag.
 */
export class CustomPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: React.PointerEvent) => {
        // Ignore if clicking on a resize handle
        if ((event.target as HTMLElement).closest('[data-resize-handle]')) {
          return false;
        }
        return true;
      },
    },
  ];
}
