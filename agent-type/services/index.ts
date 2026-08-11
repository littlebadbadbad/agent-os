/**
 * agent-type/services/index.ts — Barrel export for all service type contracts
 *
 * App developers import service types from here:
 *   import type { TerminalService } from '@agent-type/services';
 */

export type {
  TerminalService,
  TerminalSessionInfo,
  AvailableShellInfo,
  CreateTerminalParams,
  SpawnCommandParams,
  SendInputParams as TerminalSendInputParams,
  ReadOutputParams as TerminalReadOutputParams,
  ReadOutputResult as TerminalReadOutputResult,
  ResizeParams as TerminalResizeParams,
  WaitParams as TerminalWaitParams,
  WaitResult as TerminalWaitResult,
  SleepResult,
  RunCommandParams,
  RunCommandResult,
  SubscribeOutputParams,
} from './terminal';

export type {
  BrowserService,
  BrowserSessionInfo,
  BrowserLaunchConfig,
  CreateBrowserParams,
  NavigateParams,
  NavigateResult,
  EvaluateParams,
  ReadOutputParams as BrowserReadOutputParams,
  ReadOutputResult as BrowserReadOutputResult,
  SnapshotParams,
  SnapshotResult,
  WaitParams as BrowserWaitParams,
  WaitResult as BrowserWaitResult,
  ScreenshotParams,
  ScreenshotResult,
  SetLaunchConfigParams,
  SetProxyParams,
  SwitchTabParams,
  SetViewportParams,
  NetworkQueryOptions,
  NetworkRequestEntry,
  NetworkQueryResult,
} from './browser';
