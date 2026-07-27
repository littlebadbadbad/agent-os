import styles from './ProxyButton.module.scss';

interface ProxyButtonTriggerProps {
  readonly onClick?: () => void;
}

/**
 * Trigger button for the proxy settings dropdown.
 * Renders a pill button with a dot indicator.
 */
export function ProxyButtonTrigger({ onClick }: ProxyButtonTriggerProps) {
  return (
    <button className={styles.proxyPill} title="代理设置" onClick={onClick}>
      <span className={styles.proxyDot} />
      代理
    </button>
  );
}
