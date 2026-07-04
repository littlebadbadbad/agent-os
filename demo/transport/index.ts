/**
 * demo/transport/index.ts — Transport layer barrel
 *
 * Re-exports from agent-UI which has the environment-aware transport.
 */

export {
  apiTransport,
} from '../../agent-UI/transport/apiTransport';
export type {
  ApiTransport,
  AdoProxyParams,
  AdoProxyUploadParams,
} from '../../agent-UI/transport/apiTransport';
