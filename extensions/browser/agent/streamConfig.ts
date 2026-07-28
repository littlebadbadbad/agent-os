/**
 * extensions/browser/agent/streamConfig.ts
 *
 * Live stream configuration for browser preview.
 * Stream-time-only parameters that affect the live preview **without**
 * requiring a browser restart.  Distinct from `BrowserLaunchConfig` which
 * controls the initial browser/context launch.
 */

export interface StreamConfig {
  /** Target frames per second (1–60). @default 24 */
  fps: number;
  /** JPEG quality for live preview frames (10–100). @default 80 */
  quality: number;
}
