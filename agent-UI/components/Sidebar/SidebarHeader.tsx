import { useEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import type { WidgetIcon } from "@agent-sdk";
import styles from "./SidebarHeader.module.scss";
// ── Icon renderer (framework-agnostic: emoji string | URL | DOM/SVG node) ─────

function isUrl(s: string): boolean {
  return (
    /^https?:\/\//i.test(s) ||
    /^data:image\//i.test(s) ||
    /\.(?:png|jpe?g|gif|webp|svg|avif|ico)$/i.test(s)
  );
}

function DomIconNode({
  node,
}: {
  node: HTMLElement | SVGElement;
}): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";
    el.appendChild(node.cloneNode(true));
  }, [node]);
  return <span className={styles["icon-node"]} ref={ref} />;
}

function IconNode({ icon }: { icon: WidgetIcon }): ReactElement {
  if (typeof icon === "string" && isUrl(icon)) {
    return (
      <img
        className={styles["icon-img"]}
        src={icon}
        alt=""
        aria-hidden="true"
      />
    );
  }
  if (typeof icon === "string") {
    return (
      <span className={styles["icon-emoji"]} aria-hidden="true">
        {icon}
      </span>
    );
  }
  return <DomIconNode node={icon} />;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface SidebarHeaderProps {
  icon?: WidgetIcon;
  onToggleOpen: () => void;
  /** Optional control bar rendered in the header identity area. */
  controlBar?: ReactNode;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SidebarHeader({
  icon,
  onToggleOpen,
  controlBar,
}: SidebarHeaderProps): ReactElement {
  return (
    <div className={styles["header"]}>
      <div className={styles["identity"]}>
        {icon && <IconNode icon={icon} />}
        <span className={styles["title"]}>Agent</span>
        {controlBar}
      </div>
      <div className={styles["controls"]}>
        <button
          type="button"
          className={styles["ctrl-btn"]}
          onClick={onToggleOpen}
          title="Collapse panel"
          aria-label="Collapse panel"
        >
          ›
        </button>
      </div>
    </div>
  );
}
