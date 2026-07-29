import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ToolStateEntry } from '../agent/types';
import styles from './styles.module.scss';

type ToolGroup = { name: string; tools: ToolStateEntry[] };

const UNGROUPED_LABEL = '未分组工具';

function groupTools(tools: ToolStateEntry[]): ToolGroup[] {
  const map = new Map<string, ToolStateEntry[]>();
  for (const tool of tools) {
    const key = tool.group ?? UNGROUPED_LABEL;
    const group = map.get(key);
    if (group) group.push(tool);
    else map.set(key, [tool]);
  }
  const groups = [...map.entries()].map(([name, tools]) => ({ name, tools }));
  // Ungrouped tools first, named groups after
  const ungrouped = groups.filter((g) => g.name === UNGROUPED_LABEL);
  const named = groups.filter((g) => g.name !== UNGROUPED_LABEL);
  return [...ungrouped, ...named];
}

function ToolItem({ tool, onToggle }: { tool: ToolStateEntry; onToggle: (name: string) => void }): ReactElement {
  return (
    <div className={`${styles['tool-item']}${!tool.enabled ? ` ${styles['tool-item--disabled']}` : ''}`}>
      <div className={styles['tool-item-info']}>
        <div className={styles['tool-item-name']}>{tool.name}</div>
        {tool.description && <div className={styles['tool-item-desc']}>{tool.description}</div>}
      </div>
      <button
        type="button" role="switch" aria-checked={tool.enabled}
        className={`${styles['toggle']}${tool.enabled ? ` ${styles['toggle--on']}` : ''}`}
        onClick={() => onToggle(tool.name)}
        title={tool.enabled ? 'Disable tool' : 'Enable tool'}
      >
        <span className={styles['toggle-thumb']} />
      </button>
    </div>
  );
}

export function ToolsPanel({
  toolStates,
  onToggle,
}: {
  toolStates: ToolStateEntry[];
  onToggle: (name: string) => void;
}): ReactElement {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (toolStates.length === 0) {
    return <div className={styles['tools-empty']}>No tools registered yet.</div>;
  }

  const groups = groupTools(toolStates);

  return (
    <div className={styles['tools-panel']}>
      {groups.map(({ name, tools }) => {
        const isCollapsed = collapsed[name] ?? true;
        const enabledCount = tools.filter((t) => t.enabled).length;
        const allEnabled = enabledCount === tools.length;
        return [
          <div key={name} className={styles['tool-group']}>
            <div className={styles['tool-group-header']}>
              <button type="button" className={styles['tool-group-collapse-btn']}
                onClick={() => setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }))}
                aria-expanded={!isCollapsed}>
                <span className={`${styles['tool-group-arrow']}${isCollapsed ? ` ${styles['tool-group-arrow--collapsed']}` : ''}`}>▾</span>
                <span className={styles['tool-group-name']}>{name}</span>
                <span className={styles['tool-group-count']}>{enabledCount}/{tools.length}</span>
              </button>
              <button type="button" role="switch" aria-checked={allEnabled}
                className={`${styles['toggle']}${allEnabled ? ` ${styles['toggle--on']}` : ''}`}
                onClick={() => {
                  const targets = allEnabled ? tools : tools.filter((t) => !t.enabled);
                  targets.forEach((t) => onToggle(t.name));
                }}
                title={allEnabled ? 'Disable all tools in this group' : 'Enable all tools in this group'}>
                <span className={styles['toggle-thumb']} />
              </button>
            </div>
            {!isCollapsed && (
              <div className={styles['tool-group-items']}>
                {tools.map((tool) => <ToolItem key={tool.name} tool={tool} onToggle={onToggle} />)}
              </div>
            )}
          </div>,
        ];
      })}
    </div>
  );
}
