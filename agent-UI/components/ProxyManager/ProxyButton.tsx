import { useState, useEffect } from 'react';
import { ProxyManagerPanel } from './ProxyManagerPanel';
import { DropdownPanel } from '../DropdownPanel';
import { getProxyConfig } from '../../api/backend';
import styles from './ProxyButton.module.scss';

export function ProxyButton() {
  const [proxyEnabled, setProxyEnabled] = useState<boolean | null>(null);

  async function refreshStatus() {
    try {
      const data = await getProxyConfig();
      setProxyEnabled((data.config as { enabled: boolean })?.enabled ?? false);
    } catch { /* ignore */ }
  }

  useEffect(() => { refreshStatus(); }, []);

  return (
    <DropdownPanel
      trigger={
        <button
          className={`${styles.proxyPill} ${
            proxyEnabled === true ? styles.proxyPillOn : styles.proxyPillOff
          }`}
          title="代理设置"
        >
          <span className={styles.proxyDot} />
          代理
        </button>
      }
    >
      {({ close }) => (
        <ProxyManagerPanel
          onClose={() => {
            close();
            refreshStatus();
          }}
        />
      )}
    </DropdownPanel>
  );
}
