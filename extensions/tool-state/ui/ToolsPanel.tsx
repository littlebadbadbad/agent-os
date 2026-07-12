import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ToolStateEntry } from '../agent/types';
import styles from './styles.module.scss';

type ToolState = ToolStateEntry;
type ToolGroup = { name: string; tools: ToolState[] };

const UNGROUPED_LABEL = '未分组工具';

function groupByGroup(toolStates: ToolState[]): ToolGroup[] {
  const map = new Map<string, ToolState[]>();
  for (const tool of toolStates) {
    const key = tool.group ?? UNGROUPED_LABEL;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tool);
  }
  const result: ToolGroup[] = [];
  for (const [key, tools] of map) {
    result.push({ name: key, tools });
  }
  const ungrouped = result.filter((g) => g.name === UNGROUPED_LABEL);
  const named = result.filter((g) => g.name !== UNGROUPED_LABEL);
  return [...ungrouped, ...named];
}

function ToolItem({ tool, onToggle }: { tool: ToolState; onToggle: (name: string) => void }): ReactElement {
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
  toolStates: ToolState[];
  onToggle: (name: string) => void;
}): ReactElement {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (toolStates.length === 0) {
    return <div className={styles['tools-empty']}>No tools registered yet.</div>;
  }

  const groups = groupByGroup(toolStates);

  return (
    <div className={styles['tools-panel']}>
      {groups.flatMap(({ name, tools }) => {
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
                  if (allEnabled) { tools.forEach((t) => onToggle(t.name)); }
                  else { tools.filter((t) => !t.enabled).forEach((t) => onToggle(t.name)); }
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
