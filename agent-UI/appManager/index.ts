/**
 * agent-UI/appManager/index.ts — App Manager barrel export
 *
 * Exports the app manager API, native React component, and sub-components.
 * Consumers import from this module, never from individual files.
 *
 * The API layer is a re-export of the super built-in "app-manager"
 * core app client (agent-UI/app/core/app-manager.ts).
 *
 * Usage:
 *   import { appManagerApi, AppManagerPanel } from '../appManager';
 */

export { appManagerApi } from '../app/core/app-manager';
export type { AppInfo } from '../app/appTypes';

export { AppManagerPanel } from './AppManagerPanel';
export type { AppManagerPanelProps } from './AppManagerPanel';

export { AppRow } from './AppRow';
export { InstallDropdown } from './InstallDropdown';
export { SearchBar } from './SearchBar';
export { MarketplacePlaceholder } from './MarketplacePlaceholder';
