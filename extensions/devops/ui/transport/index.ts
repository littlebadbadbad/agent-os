/**
 * extensions/devops/ui/transport/index.ts — Transport layer barrel
 *
 * NOTE: DevOps no longer uses apiTransport directly.
 * All API calls now go through PluginApiClient.call().
 *
 * This file is kept for backward compatibility during the migration.
 */

export { apiTransport } from '../../../../agent-UI/transport/apiTransport';
export type { ApiTransport } from '../../../../agent-UI/transport/apiTransport';
