/**
 * agent-UI/api/providerConfigApi.ts — Provider config API adapter
 *
 * CRUD operations for the two-layer model config system.
 *
 * Legacy file — prefer importing directly from app/core/ for new code.
 * Kept for backward compat convenience re-exports.
 */

export {
  fetchMergedModelConfig,
  fetchBuiltInModelConfig,
  fetchCustomModelConfig,
  saveCustomModelConfig,
  addCustomModelProvider,
  removeCustomModelProvider,
  updateCustomModelProvider,
} from '../app/core/model-config';
