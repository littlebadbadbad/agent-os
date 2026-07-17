/**
 * extensions/experience/ui/ExperienceToolCard.tsx — Tool cards for experience tools
 *
 * Self-contained for sandboxed iframe rendering. Each tool has a dedicated
 * card component (Add, Update, Delete, List) dispatched by name.
 *
 * Uses CardShell/CardHeader helpers defined locally since host shared
 * components are not available in the iframe sandbox.
 */

import type { ReactElement, ReactNode } from "react";
import type { ToolCallInfo, ToolCallStatus } from "@agent-type";
import styles from "./styles.module.scss";

// ── Shared card primitives ────────────────────────────────────────────────────

function CardShell({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return <div className={styles["tc-card"]}>{children}</div>;
}

function CardHeader({
  icon,
  label,
  status,
  badge,
}: {
  icon: string;
  label: string;
  status: ToolCallStatus;
  badge?: ReactElement;
}): ReactElement {
  const statusClass =
    {
      running: styles["tc-status--running"],
      done: styles["tc-status--done"],
      error: styles["tc-status--error"],
    }[status] ?? "";

  return (
    <div className={styles["tc-header"]}>
      <span className={styles["tc-icon"]}>{icon}</span>
      <span className={styles["tc-title"]}>{label}</span>
      <span className={`${styles["tc-status"]} ${statusClass}`}>{status}</span>
      {badge}
    </div>
  );
}

function ErrorResult({ error }: { error: string }): ReactElement {
  return (
    <div className={styles["tc-error"]}>
      <div className={styles["tc-error-title"]}>Error</div>
      <pre className={styles["tc-error-body"]}>{error}</pre>
    </div>
  );
}

function PlainResult({ result }: { result: unknown }): ReactElement {
  const text =
    result === null || result === undefined
      ? "\u2014"
      : typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);
  return (
    <div className={styles["tc-result"]}>
      <pre className={styles["tc-result-body"]}>{text}</pre>
    </div>
  );
}

function TagChips({ tags }: { tags: readonly string[] }): ReactElement {
  return (
    <div className={styles["exp-item-tags"]}>
      {tags.map((t) => (
        <span
          key={t}
          className={`${styles["exp-tag"]} ${styles["exp-tag--static"]}`}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function TruncatedRow({
  label,
  value,
  max = 120,
}: {
  label: string;
  value: string;
  max?: number;
}): ReactElement {
  return (
    <div className={styles["tc-info-row"]}>
      <span className={styles["tc-info-label"]}>{label}</span>
      <span className={styles["tc-info-value"]}>
        {value.length > max ? `${value.slice(0, max)}\u2026` : value}
      </span>
    </div>
  );
}

function argStr(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

function argNum(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = args[key];
  return typeof v === "number" ? v : undefined;
}

function argArr(
  args: Record<string, unknown>,
  key: string,
): unknown[] | undefined {
  const v = args[key];
  return Array.isArray(v) ? v : undefined;
}

function resObj(result: unknown): Record<string, unknown> | undefined {
  if (result === null || result === undefined) return undefined;
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  if (typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return undefined;
}

// ── ExperienceAddCard ─────────────────────────────────────────────────────────

function ExperienceAddCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { arguments: args, status, result, error } = info;
  const trigger = argStr(args, "trigger") ?? "";
  const insight = argStr(args, "insight") ?? "";
  const evidence = argStr(args, "evidence");
  const confidence = argNum(args, "confidence");
  const rawTags = argArr(args, "tags");
  const tags = rawTags?.filter((t): t is string => typeof t === "string") ?? [];

  const res = resObj(result);
  const addedId = typeof res?.["id"] === "string" ? res["id"] : undefined;
  const total = typeof res?.["total"] === "number" ? res["total"] : undefined;

  const badge =
    total !== undefined ? (
      <span className={styles["tc-todo-summary"]}>{total} total</span>
    ) : undefined;

  return (
    <CardShell>
      <CardHeader
        icon="\uD83D\uDCA1"
        label="experience_add"
        status={status}
        badge={badge}
      />
      {!!(trigger || insight) ? (
        <div className={styles["tc-body"]}>
          {trigger && <TruncatedRow label="Trigger" value={trigger} />}
          {insight && <TruncatedRow label="Insight" value={insight} />}
          {evidence && <TruncatedRow label="Evidence" value={evidence} />}
          {confidence !== undefined && (
            <div className={styles["tc-info-row"]}>
              <span className={styles["tc-info-label"]}>Confidence</span>
              <span className={styles["tc-info-value"]}>
                {confidence.toFixed(2)}
              </span>
            </div>
          )}
          {tags.length > 0 && (
            <div className={styles["tc-info-row"]}>
              <span className={styles["tc-info-label"]}>Tags</span>
              <TagChips tags={tags} />
            </div>
          )}
          {status !== "running" && addedId && (
            <div className={styles["tc-info-row"]}>
              <span className={styles["tc-info-label"]}>ID</span>
              <span className={styles["tc-info-value"]}>
                <code>{addedId.slice(0, 8)}\u2026</code>
              </span>
            </div>
          )}
        </div>
      ) : (
        <></>
      )}
      {status !== "running" ? (
        !!error ? (
          <ErrorResult error={error} />
        ) : !(trigger || insight) ? (
          <PlainResult result={result} />
        ) : (
          <></>
        )
      ) : (
        <></>
      )}
    </CardShell>
  );
}

// ── ExperienceUpdateCard ──────────────────────────────────────────────────────

function ExperienceUpdateCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { arguments: args, status, result, error } = info;
  const id = argStr(args, "id") ?? "";
  const trigger = argStr(args, "trigger");
  const insight = argStr(args, "insight");
  const evidence = argStr(args, "evidence");
  const confidence = argNum(args, "confidence");
  const rawTags = argArr(args, "tags");
  const tags = rawTags?.filter((t): t is string => typeof t === "string");

  const changed: string[] = [
    trigger !== undefined ? "trigger" : null,
    insight !== undefined ? "insight" : null,
    evidence !== undefined ? "evidence" : null,
    confidence !== undefined ? "confidence" : null,
    tags !== undefined ? "tags" : null,
  ].filter((x): x is string => x !== null);

  return (
    <CardShell>
      <CardHeader
        icon="\u270F\uFE0F"
        label="experience_update"
        status={status}
      />
      <div className={styles["tc-body"]}>
        <div className={styles["tc-info-row"]}>
          <span className={styles["tc-info-label"]}>ID</span>
          <span className={styles["tc-info-value"]}>
            <code>{id.slice(0, 8)}\u2026</code>
          </span>
        </div>
        {changed.length > 0 && (
          <div className={styles["tc-info-row"]}>
            <span className={styles["tc-info-label"]}>Updated</span>
            <span className={styles["tc-info-value"]}>
              {changed.join(", ")}
            </span>
          </div>
        )}
        {trigger !== undefined && (
          <TruncatedRow label="Trigger" value={trigger} max={100} />
        )}
        {insight !== undefined && (
          <TruncatedRow label="Insight" value={insight} max={100} />
        )}
        {evidence !== undefined && (
          <TruncatedRow label="Evidence" value={evidence} max={100} />
        )}
        {confidence !== undefined && (
          <div className={styles["tc-info-row"]}>
            <span className={styles["tc-info-label"]}>Confidence</span>
            <span className={styles["tc-info-value"]}>
              {confidence.toFixed(2)}
            </span>
          </div>
        )}
        {tags !== undefined && tags.length > 0 && (
          <div className={styles["tc-info-row"]}>
            <span className={styles["tc-info-label"]}>Tags</span>
            <TagChips tags={tags} />
          </div>
        )}
      </div>
      {status !== "running" ? (
        error ? (
          <ErrorResult error={error} />
        ) : (
          <></>
        )
      ) : (
        <></>
      )}
    </CardShell>
  );
}

// ── ExperienceDeleteCard ──────────────────────────────────────────────────────

function ExperienceDeleteCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { arguments: args, status, result, error } = info;
  const id = argStr(args, "id") ?? "";
  const res = resObj(result);
  const remaining =
    typeof res?.["remaining"] === "number" ? res["remaining"] : undefined;

  const badge =
    remaining !== undefined ? (
      <span className={styles["tc-todo-summary"]}>{remaining} remaining</span>
    ) : undefined;

  return (
    <CardShell>
      <CardHeader
        icon="\uD83D\uDDD1"
        label="experience_delete"
        status={status}
        badge={badge}
      />
      <div className={styles["tc-body"]}>
        <div className={styles["tc-info-row"]}>
          <span className={styles["tc-info-label"]}>ID</span>
          <span className={styles["tc-info-value"]}>
            <code>{id.slice(0, 8)}\u2026</code>
          </span>
        </div>
      </div>
      {status !== "running" && (error ? <ErrorResult error={error} /> : null)}
    </CardShell>
  );
}

// ── ExperienceListCard ────────────────────────────────────────────────────────

function ExperienceListCard({ info }: { info: ToolCallInfo }): ReactElement {
  const { arguments: args, status, result, error } = info;
  const tag = argStr(args, "tag");
  const res = resObj(result);
  const total = typeof res?.["total"] === "number" ? res["total"] : undefined;

  const badge =
    total !== undefined ? (
      <span className={styles["tc-todo-summary"]}>
        {total} {tag ? `tagged "${tag}"` : "entries"}
      </span>
    ) : undefined;

  return (
    <CardShell>
      <CardHeader
        icon="\uD83D\uDCCB"
        label="experience_list"
        status={status}
        badge={badge}
      />
      {tag && (
        <div className={styles["tc-body"]}>
          <div className={styles["tc-info-row"]}>
            <span className={styles["tc-info-label"]}>Filter</span>
            <TagChips tags={[tag]} />
          </div>
        </div>
      )}
      {status !== "running" && (error ? <ErrorResult error={error} /> : null)}
    </CardShell>
  );
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export function ExperienceToolCard({
  info,
}: {
  info: ToolCallInfo;
}): ReactElement {
  switch (info.name) {
    case "experience_add":
      return <ExperienceAddCard info={info} />;
    case "experience_update":
      return <ExperienceUpdateCard info={info} />;
    case "experience_delete":
      return <ExperienceDeleteCard info={info} />;
    case "experience_list":
      return <ExperienceListCard info={info} />;
    default:
      return <PlainResult result={info.result} />;
  }
}
