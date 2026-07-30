/**
 * BrowserSessionView — self-contained view for a single browser session.
 *
 * Delegates to focused sub-components: address bar, config panel, video settings,
 * page tabs, live view, and the unified console (log viewer + JS evaluation).
 */

import { useState, useCallback, useEffect, type ReactElement } from "react";
import type { BrowserEntry, BrowserAdapter, BrowserLaunchConfig, StreamConfig } from "../agent/types";
import type { BrowserTabInfo } from "../agent/types";
import type { BrowserPageInfo } from "./BrowserLiveView";
import { BrowserLiveView } from "./BrowserLiveView";
import { BrowserPageTabs } from "./BrowserPageTabs";
import { BrowserAddressBar } from "./BrowserAddressBar";
import { BrowserConfigPanel } from "./BrowserConfigPanel";
import { BrowserVideoSettings } from "./BrowserVideoSettings";
import { BrowserConsole } from "./BrowserConsole";
import styles from "./BrowserPanel.module.scss";

export interface BrowserSessionViewProps {
  entry: BrowserEntry;
  adapter: BrowserAdapter;
  log: string;
  onPageInfo(info: BrowserPageInfo): void;
  onToggleProxy(): void;
  onSwitchTab(index: number): void;
  onApplyConfig(config: BrowserLaunchConfig): void;
  configApplying: boolean;
  streamConfig: StreamConfig;
  onStreamConfigChange(config: Partial<StreamConfig>): void;
  viewport: { width: number; height: number };
  onViewportResize(width: number, height: number): void;
  onAppendToLog(text: string): void;
}

export function BrowserSessionView({
  entry, adapter, log,
  onPageInfo, onToggleProxy, onSwitchTab,
  onApplyConfig, configApplying,
  streamConfig, onStreamConfigChange, viewport, onViewportResize,
  onAppendToLog,
}: BrowserSessionViewProps): ReactElement {
  const [navigating, setNavigating] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(150);
  const [showConfig, setShowConfig] = useState(false);
  const [showVideoSettings, setShowVideoSettings] = useState(false);
  const [pageUrl, setPageUrl] = useState("");
  const [pageTitle, setPageTitle] = useState<string | null>(null);

  const tabs: BrowserTabInfo[] = entry.tabs;
  const activeTabIndex = entry.activeTabIndex;

  const handleNavigate = useCallback(async (url: string) => {
    setNavigating(true);
    try {
      await adapter.navigate(entry.id, url);
    } catch {
      // Navigation errors visible on stream.
    } finally {
      setNavigating(false);
    }
  }, [adapter, entry.id]);

  const handlePageInfo = useCallback(
    (info: BrowserPageInfo) => {
      if (info.url !== undefined) setPageUrl(info.url ?? "");
      if (info.title !== undefined) setPageTitle(info.title);
      onPageInfo(info);
    },
    [onPageInfo],
  );

  useEffect(() => {
    setNavigating(false);
    setPageUrl("");
    setPageTitle(null);
  }, [entry.id]);

  const handleDividerMouseDown = useCallback((e: { clientY: number; preventDefault(): void }) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = consoleHeight;
    const onMove = (ev: MouseEvent) => {
      setConsoleHeight(Math.max(40, Math.min(360, startHeight + (startY - ev.clientY))));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [consoleHeight]);

  return (
    <div className={styles["session-view"]}>
      <BrowserAddressBar
        url={pageUrl}
        pageTitle={pageTitle}
        alive={entry.alive}
        useProxy={entry.useProxy}
        navigating={navigating}
        onNavigate={handleNavigate}
        onToggleProxy={onToggleProxy}
        onToggleConfig={() => setShowConfig((v) => !v)}
        onToggleVideoSettings={() => setShowVideoSettings((v) => !v)}
      />

      {showConfig && (
        <BrowserConfigPanel
          config={entry.launchConfig}
          applying={configApplying}
          onApply={(cfg) => { onApplyConfig(cfg); setShowConfig(false); }}
          onClose={() => setShowConfig(false)}
        />
      )}

      {showVideoSettings && (
        <BrowserVideoSettings
          streamConfig={streamConfig}
          onStreamConfigChange={onStreamConfigChange}
          viewport={viewport}
          onViewportChange={(w, h) => onViewportResize(w, h)}
          onClose={() => setShowVideoSettings(false)}
        />
      )}

      <BrowserPageTabs
        tabs={tabs}
        activeIndex={activeTabIndex}
        onSwitch={onSwitchTab}
        disabled={!entry.alive}
      />

      <BrowserLiveView
        alive={entry.alive}
        adapter={adapter}
        browserId={entry.id}
        onPageInfo={handlePageInfo}
        streamConfig={streamConfig}
        viewport={viewport}
        onViewportResize={onViewportResize}
      />

      <div className={styles["resize-divider"]} onMouseDown={handleDividerMouseDown} />

      <div className={styles["console-area"]} style={{ height: consoleHeight }}>
        <BrowserConsole
          text={log}
          tabKey={`${entry.id}-${activeTabIndex}`}
          adapter={adapter}
          browserId={entry.id}
          alive={entry.alive}
          onAppendToLog={onAppendToLog}
        />
      </div>
    </div>
  );
}