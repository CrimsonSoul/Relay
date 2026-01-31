/**
 * Feature Flag System
 * 
 * Provides a flexible system for controlling feature rollouts and A/B testing.
 * Features can be enabled/disabled based on:
 * - Environment variables
 * - User configuration
 * - Runtime conditions
 * - Gradual rollout percentages
 */

// Safe access to process.env
const getEnv = (key: string): string | undefined => {
  try {
    // eslint-disable-next-line no-undef
    return typeof process !== 'undefined' ? process.env[key] : undefined;
  } catch {
    return undefined;
  }
};

const isDevelopment = getEnv('NODE_ENV') === 'development';

export type FeatureFlagConfig = {
  enabled: boolean;
  description: string;
  rolloutPercentage?: number; // 0-100, for gradual rollouts
  enabledForDevMode?: boolean; // Override for development
  requiresRestart?: boolean; // Whether enabling/disabling requires app restart
};

export type FeatureFlags = {
  // Testing & Development
  enableDebugMode: FeatureFlagConfig;
  enablePerformanceMetrics: FeatureFlagConfig;
  enableVerboseLogging: FeatureFlagConfig;
  
  // Feature Rollouts
  enableSQLiteMigration: FeatureFlagConfig;
  enableAdvancedStateManagement: FeatureFlagConfig;
  enableAIChat: FeatureFlagConfig;
  enableWeatherAlerts: FeatureFlagConfig;
  enableExperimentalFeatures: FeatureFlagConfig;
  
  // Security & Performance
  enableStrictCSP: FeatureFlagConfig;
  enableWebviewSandbox: FeatureFlagConfig;
  enableAutomaticBackups: FeatureFlagConfig;
  enableRateLimiting: FeatureFlagConfig;
  
  // UI Features
  enableDarkMode: FeatureFlagConfig;
  enableAnimations: FeatureFlagConfig;
  enableTooltips: FeatureFlagConfig;
};

/**
 * Default feature flag configuration
 */
const DEFAULT_FLAGS: FeatureFlags = {
  // Testing & Development
  enableDebugMode: {
    enabled: isDevelopment,
    description: 'Enable debug mode with additional logging and diagnostics',
    enabledForDevMode: true,
  },
  enablePerformanceMetrics: {
    enabled: false,
    description: 'Track and display performance metrics',
    enabledForDevMode: true,
  },
  enableVerboseLogging: {
    enabled: getEnv('VERBOSE_LOGGING') === 'true',
    description: 'Enable verbose logging for all modules',
    enabledForDevMode: true,
  },
  
  // Feature Rollouts
  enableSQLiteMigration: {
    enabled: false,
    description: 'Enable SQLite database migration (experimental)',
    requiresRestart: true,
    rolloutPercentage: 0, // Not yet rolled out
  },
  enableAdvancedStateManagement: {
    enabled: false,
    description: 'Use Zustand/Jotai for state management instead of React Context',
    requiresRestart: true,
    rolloutPercentage: 0,
  },
  enableAIChat: {
    enabled: true,
    description: 'Enable AI Chat integration (Gemini, ChatGPT)',
    requiresRestart: false,
  },
  enableWeatherAlerts: {
    enabled: true,
    description: 'Enable severe weather alerts in Weather tab',
    requiresRestart: false,
  },
  enableExperimentalFeatures: {
    enabled: getEnv('EXPERIMENTAL') === 'true',
    description: 'Enable all experimental features',
    enabledForDevMode: true,
  },
  
  // Security & Performance
  enableStrictCSP: {
    enabled: !isDevelopment,
    description: 'Enforce strict Content Security Policy',
    requiresRestart: true,
  },
  enableWebviewSandbox: {
    enabled: true,
    description: 'Enable webview sandboxing for AI Chat',
    requiresRestart: true,
  },
  enableAutomaticBackups: {
    enabled: true,
    description: 'Automatically backup data before critical operations',
    requiresRestart: false,
  },
  enableRateLimiting: {
    enabled: true,
    description: 'Enable rate limiting on IPC operations',
    requiresRestart: false,
  },
  
  // UI Features
  enableDarkMode: {
    enabled: true,
    description: 'Enable dark mode theme',
    requiresRestart: false,
  },
  enableAnimations: {
    enabled: true,
    description: 'Enable UI animations and transitions',
    requiresRestart: false,
  },
  enableTooltips: {
    enabled: true,
    description: 'Show tooltips on UI elements',
    requiresRestart: false,
  },
};

/**
 * Feature flag manager class
 */
class FeatureFlagManager {
  private flags: FeatureFlags;
  private userId?: string; // For user-specific rollouts
  private overrides: Partial<FeatureFlags> = {};

  constructor() {
    this.flags = { ...DEFAULT_FLAGS };
    this.loadOverrides();
  }

  /**
   * Load feature flag overrides from environment or config
   */
  private loadOverrides() {
    // Environment variable overrides (FEATURE_FLAG_<NAME>=true/false)
    Object.keys(this.flags).forEach((key) => {
      const envKey = `FEATURE_FLAG_${this.toSnakeCase(key).toUpperCase()}`;
      const envValue = getEnv(envKey);
      if (envValue !== undefined) {
        this.overrides[key as keyof FeatureFlags] = {
          ...this.flags[key as keyof FeatureFlags],
          enabled: envValue === 'true',
        };
      }
    });

    // Apply overrides
    this.flags = { ...this.flags, ...this.overrides };
  }

  /**
   * Check if a feature is enabled
   */
  isEnabled(flagName: keyof FeatureFlags): boolean {
    const flag = this.flags[flagName];
    if (!flag) return false;

    // Check dev mode override
    if (isDevelopment && flag.enabledForDevMode) {
      return true;
    }

    // Check gradual rollout
    if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage > 0) {
      return this.isInRollout(flagName, flag.rolloutPercentage);
    }

    return flag.enabled;
  }

  /**
   * Determine if user is in rollout based on percentage
   */
  private isInRollout(flagName: string, percentage: number): boolean {
    if (percentage === 100) return true;
    if (percentage === 0) return false;

    // Use a hash of userId + flagName to consistently determine rollout
    const userId = this.userId || 'default';
    const hash = this.simpleHash(`${userId}-${flagName}`);
    return (hash % 100) < percentage;
  }

  /**
   * Simple hash function for consistent rollout
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Convert camelCase to snake_case
   */
  private toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  /**
   * Get all feature flags with their current state
   */
  getAllFlags(): FeatureFlags {
    return { ...this.flags };
  }

  /**
   * Get a specific flag configuration
   */
  getFlag(flagName: keyof FeatureFlags): FeatureFlagConfig | undefined {
    return this.flags[flagName];
  }

  /**
   * Enable a feature flag at runtime (if supported)
   */
  enableFlag(flagName: keyof FeatureFlags) {
    if (this.flags[flagName]) {
      this.flags[flagName].enabled = true;
    }
  }

  /**
   * Disable a feature flag at runtime (if supported)
   */
  disableFlag(flagName: keyof FeatureFlags) {
    if (this.flags[flagName]) {
      this.flags[flagName].enabled = false;
    }
  }

  /**
   * Set user ID for rollout calculations
   */
  setUserId(userId: string) {
    this.userId = userId;
  }

  /**
   * Get flags that require restart
   */
  getFlagsRequiringRestart(): Array<keyof FeatureFlags> {
    return Object.keys(this.flags).filter(
      (key) => this.flags[key as keyof FeatureFlags].requiresRestart
    ) as Array<keyof FeatureFlags>;
  }
}

// Singleton instance
export const featureFlags = new FeatureFlagManager();

/**
 * Convenience function to check if a feature is enabled
 */
export function isFeatureEnabled(flagName: keyof FeatureFlags): boolean {
  return featureFlags.isEnabled(flagName);
}

/**
 * HOC for React components that depend on feature flags
 * NOTE: This requires React to be available. Import React in your component file.
 * 
 * @example
 * ```tsx
 * import React from 'react';
 * import { withFeatureFlag } from '@shared/featureFlags';
 * 
 * const MyFeature = withFeatureFlag(MyComponent, 'enableNewFeature', <div>Coming soon!</div>);
 * ```
 */
export function withFeatureFlag<P extends object>(
  Component: (props: P) => React.ReactElement | null,
  flagName: keyof FeatureFlags,
  fallback?: React.ReactNode
): (props: P) => React.ReactElement | null {
  return function FeatureFlagWrapper(props: P): React.ReactElement | null {
    if (isFeatureEnabled(flagName)) {
      return Component(props);
    }
    return fallback as React.ReactElement | null || null;
  };
}

// Type alias for React types (will be resolved at usage site where React is imported)
declare namespace React {
  type ReactElement = unknown;
  type ReactNode = unknown;
}
