/**
 * ProviderSelector.tsx — model/provider picker dropdown.
 *
 * Thin shell: subscribes to the provider stores, renders the trigger button
 * and tab bar, and delegates each tab to its own panel component
 * (ModelList, ApiKeyManager, EditConfigPane).
 */

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { providerStore } from '../../store/providerStore';
import { providerConfigStore } from '../../store/providerConfigStore';
import type { ProviderEntry } from '../../store/providerConfigStore';
import { DropdownPanel } from '../DropdownPanel';
import { ApiKeyManager } from './ApiKeyManager';
import { EditConfigPane } from './EditConfigPane';
import { ModelList } from './ModelList';
import { providerIcon } from './providerConfig';
import styles from './ProviderSelector.module.scss';

type Tab = 'models' | 'keys' | 'edit-config';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'models', label: '模型' },
  { id: 'keys', label: '🔑 API Keys' },
  { id: 'edit-config', label: '⚙️ 编辑配置' },
];

export function ProviderSelector(): ReactElement {
  const [providerSel, setProviderSel] = useState(() => providerStore.getSelection());
  const [providers, setProviders] = useState<ProviderEntry[]>(() => providerConfigStore.getProviders());
  const [customNames, setCustomNames] = useState<readonly string[]>(() => providerConfigStore.getCustomProviders().map((p) => p.name));
  const [builtInCount, setBuiltInCount] = useState(() => providerConfigStore.getBuiltInProviders().length);
  const [loaded, setLoaded] = useState(() => providerConfigStore.isLoaded());
  const [tab, setTab] = useState<Tab>('models');

  useEffect(() => providerStore.subscribe(() => setProviderSel(providerStore.getSelection())), []);

  useEffect(() => {
    const sync = (): void => {
      setProviders([...providerConfigStore.getProviders()]);
      setCustomNames(providerConfigStore.getCustomProviders().map((p) => p.name));
      setBuiltInCount(providerConfigStore.getBuiltInProviders().length);
      setLoaded(providerConfigStore.isLoaded());
    };
    const unsubscribe = providerConfigStore.subscribe(sync);
    if (!providerConfigStore.isLoaded()) providerConfigStore.load().then(sync);
    return unsubscribe;
  }, []);

  const selectedModel = providers.flatMap((p) => p.models).find((m) => m.id === providerSel.modelId);

  return (
    <DropdownPanel
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className={styles.providerBtn}
          onClick={toggle}
          title={selectedModel?.id ?? '(no model selected)'}
        >
          <span aria-hidden="true">{providerIcon(providerSel.providerId)}</span>
          <span className={styles.providerLabel}>{selectedModel?.id ?? '选择模型'}</span>
          <span className={styles.providerChevron}>{open ? '▴' : '▾'}</span>
        </button>
      )}
      panelWidth={280}
    >
      {({ close }) => (
        <div className={styles.providerMenu}>
          <div className={styles.providerTabs} role="tablist">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`${styles.providerTab} ${tab === id ? styles.providerTabActive : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'models' && (
            <ModelList
              providers={providers}
              loaded={loaded}
              selectedProviderId={providerSel.providerId}
              selectedModelId={providerSel.modelId}
              onSelect={(providerId, modelId) => {
                providerStore.setSelection({ providerId, modelId });
                close();
              }}
            />
          )}
          {tab === 'keys' && <ApiKeyManager providerNames={providers.map((p) => p.name)} />}
          {tab === 'edit-config' && (
            <EditConfigPane builtInCount={builtInCount} customNames={customNames} />
          )}
        </div>
      )}
    </DropdownPanel>
  );
}
