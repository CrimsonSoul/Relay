import 'react';

/**
 * Type extension for Electron-specific CSS properties
 * This allows using WebkitAppRegion without `as any` casts
 */
declare module 'react' {
  interface CSSProperties {
    /**
     * Controls whether an element can be dragged to move the window.
     * Used in Electron apps for custom title bars.
     */
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
