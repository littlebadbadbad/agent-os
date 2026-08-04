/**
 * agent-UI/pluginManager/MarketplacePlaceholder.tsx — Placeholder for future plugin marketplace
 */

import { type ReactElement } from "react";
import styles from "./PluginManagerPanel.module.scss";

export function MarketplacePlaceholder(): ReactElement {
  return (
    <div className={styles.marketplace}>
      <div className={styles.marketplaceHeader}>
        <span className={styles.marketplaceTitle}>Marketplace</span>
        <span className={styles.marketplaceBadge}>Coming Soon</span>
      </div>
      <div className={styles.marketplaceBody}>
        <div className={styles.marketplaceIcon}>🛒</div>
        <p className={styles.marketplaceText}>
          Browse and install community plugins from the marketplace.
        </p>
      </div>
    </div>
  );
}
