import { useSyncExternalStore, useState } from 'react';
import type { ReactElement } from 'react';
import type { SlotSession } from '@agent-type';
import type { WidgetIcon, WidgetTheme, SessionManager } from '@agent-sdk';
import { Widget } from '../../Widget';
import { AIControlBar } from '../../Sidebar/AIControlBar';
import { SessionContent } from './SessionContent';
import { SessionTabTitle } from './SessionTabTitle';
import styles from '../AgentWidget.module.scss';

export function MultiSessionWidget({
  icon,
  theme,
  initialWidth,
  sessionManager,
}: {
  icon?: WidgetIcon;
  theme?: WidgetTheme;
  initialWidth?: number;
  sessionManager: SessionManager;
}): ReactElement {
  const { sessions, activeSessionId } = useSyncExternalStore(
    sessionManager.subscribe,
    sessionManager.getState,
    sessionManager.getState,
  );

  const activeEntry = sessions.find((s) => s.id === activeSessionId);
  const activeSession: SlotSession | undefined = activeEntry?.session;

  // agentId is stable (set once from config.id) — all sessions share the same value.
  const agentId = sessions[0]?.session.getState().agentId;

  // ── Session-bar collapse/expand ───────────────────────────────────────────
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Widget id={agentId} icon={icon} theme={theme} initialWidth={initialWidth}
      controlBar={<AIControlBar activeSession={activeSession} />}
    >
      <div className={styles['chat']}>
        {/* Session sidebar (left vertical tab list) */}
        <div className={`${styles['session-bar']}${collapsed ? ` ${styles['session-bar--collapsed']}` : ''}`}>
          {collapsed ? (
            /* Collapsed state: expand button */
            <button
              type="button"
              className={styles['session-toggle-btn']}
              onClick={() => setCollapsed(false)}
              title="Expand session list"
            >
              ▶
            </button>
          ) : (
            <>
              {/* Session tabs list */}
              <div className={styles['session-tabs']}>
                {sessions.map((entry) => (
                  <div
                    key={entry.id}
                    className={`${styles['session-tab']}${entry.id === activeSessionId ? ` ${styles['session-tab--active']}` : ''}`}
                    onClick={() => sessionManager.setActiveSession(entry.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        sessionManager.setActiveSession(entry.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    title={entry.title}
                  >
                    <SessionTabTitle
                      sessionId={entry.id}
                      title={entry.title}
                      sessionManager={sessionManager}
                    />
                    {sessions.length > 1 && (
                      <span
                        className={styles['session-tab-close']}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          sessionManager.removeSession(entry.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            sessionManager.removeSession(entry.id);
                          }
                        }}
                        title="Close session"
                      >
                        ×
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className={styles['session-new-btn']}
                onClick={() => sessionManager.createSession()}
                title="New chat"
              >
                +
              </button>
              {/* Collapse button */}
              <button
                type="button"
                className={styles['session-toggle-btn']}
                onClick={() => setCollapsed(true)}
                title="Collapse session list"
              >
                ◀
              </button>
            </>
          )}
        </div>

        {/* Active session content — fills remaining width */}
        <div className={styles['session-content-area']}>
          {activeEntry && (
            <SessionContent key={activeEntry.id} session={activeEntry.session} sessionId={activeEntry.id} />
          )}
        </div>
      </div>
    </Widget>
  );
}
