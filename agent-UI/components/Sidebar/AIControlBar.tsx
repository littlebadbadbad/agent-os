import type { ReactElement } from 'react';
import { SkillButton } from '../Skill/SkillButton';
import { ProxyButton } from '../ProxyManager/ProxyButton';
import { McpButton } from '../MCP/McpButton';
import { ProviderSelector } from '../ProviderSelector/ProviderSelector';
import styles from './AIControlBar.module.scss';

/**
 * Toolbar bar that sits below the sidebar header, providing quick-access
 * buttons for AI-related controls: provider/model selection, proxy settings,
 * skills, and MCP servers. (API key management is integrated into the
 * ProviderSelector.)
 */
export function AIControlBar(): ReactElement {
  return (
    <div className={styles['bar']}>
      <ProviderSelector />
      <SkillButton />
      <ProxyButton />
      <McpButton />
    </div>
  );
}
