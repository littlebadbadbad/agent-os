/**
 * agent-UI/pluginManager/SearchBar.tsx — Plugin search/filter input
 */

import { type ReactElement } from "react";
import styles from "./PluginManagerPanel.module.scss";

interface SearchBarProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
}

export function SearchBar({
  value,
  onChange,
  placeholder = "Search plugins...",
}: SearchBarProps): ReactElement {
  return (
    <div className={styles.searchBar}>
      <span className={styles.searchIcon}>🔍</span>
      <input
        className={styles.searchInput}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button
          className={styles.searchClear}
          onClick={() => onChange("")}
          title="Clear search"
        >
          ✕
        </button>
      )}
    </div>
  );
}
