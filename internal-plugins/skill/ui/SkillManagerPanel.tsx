/**
 * internal-plugins/skill/ui/SkillManagerPanel.tsx
 *
 * Skill management panel: list installed skills, install from URL or text,
 * remove skills. All operations delegated to agent-side APIs.
 *
 * Installation modes (matching backend capabilities):
 *   1. GitHub folder URL  —  e.g. https://github.com/owner/repo/tree/ref/path
 *   2. Direct SKILL.md URL —  any raw markdown URL
 *   3. Paste raw text     —  name + SKILL.md content
 */

import { useState, useEffect, useCallback } from "react";
import type { UiPluginHost, PluginStateExtension } from "@agent-type";
import type { BackendSkill, SkillBridge } from "../agent/types";
import styles from "./styles.module.scss";

// ── Props ────────────────────────────────────────────────────────────────────

export interface SkillManagerPanelProps {
  /** The UiPluginHost with a pre-bound apiClient for this plugin. */
  readonly host: UiPluginHost<PluginStateExtension, SkillBridge>;
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function SkillManagerPanel({ host }: SkillManagerPanelProps): React.ReactElement {
  const [skills, setSkills] = useState<BackendSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInstall, setShowInstall] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await host.bridge.sync();
    setSkills(Array.isArray(list) ? list : []);
  }, [host]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  if (loading) {
    return (
      <div className={styles["panel"]}>
        <div className={styles["panel-empty"]}>Loading skills...</div>
      </div>
    );
  }

  return (
    <div className={styles["panel"]}>
      <div className={styles["panel-header"]}>
        <span className={styles["panel-title"]}>🎞️ Installed Skills</span>
        <span className={styles["panel-count"]}>{skills.length}</span>
      </div>

      {skills.length === 0 && !showInstall && (
        <div className={styles["panel-empty"]}>
          No skills installed yet.
        </div>
      )}

      <div className={styles["panel-list"]}>
        {skills.map((skill) => (
          <SkillItem
            key={skill.name}
            skill={skill}
            host={host}
            confirmRemove={confirmRemove === skill.name}
            onRemoveRequest={() => setConfirmRemove(skill.name)}
            onRemoveCancel={() => setConfirmRemove(null)}
            onRemoved={() => { setConfirmRemove(null); refresh(); }}
          />
        ))}
      </div>

      {showInstall ? (
        <InstallForm
          host={host}
          onInstalled={() => { setShowInstall(false); refresh(); }}
          onCancel={() => setShowInstall(false)}
        />
      ) : (
        <button
          className={styles["add-btn"]}
          onClick={() => setShowInstall(true)}
        >
          + Install Skill
        </button>
      )}
    </div>
  );
}

// ── Single skill row ─────────────────────────────────────────────────────────

interface SkillItemProps {
  readonly skill: BackendSkill;
  readonly host: UiPluginHost<PluginStateExtension, SkillBridge>;
  readonly confirmRemove: boolean;
  readonly onRemoveRequest: () => void;
  readonly onRemoveCancel: () => void;
  readonly onRemoved: () => void;
}

function SkillItem({ skill, host, confirmRemove, onRemoveRequest, onRemoveCancel, onRemoved }: SkillItemProps) {
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    setRemoving(true);
    try {
      await host.bridge.remove(skill.name);
      onRemoved();
    } catch {
      setRemoving(false);
    }
  }

  return (
    <div className={styles["skill-item"]}>
      <div className={styles["skill-item-header"]}>
        <span className={styles["skill-item-name"]}>{skill.name}</span>
        {skill.version && (
          <span className={styles["skill-item-version"]}>v{skill.version}</span>
        )}
        <div className={styles["skill-item-spacer"]} />
        {confirmRemove ? (
          <div className={styles["skill-item-actions"]}>
            <button
              className={styles["btn-danger-confirm"]}
              onClick={handleRemove}
              disabled={removing}
            >
              {removing ? "..." : "Confirm"}
            </button>
            <button
              className={styles["btn-cancel"]}
              onClick={onRemoveCancel}
              disabled={removing}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            className={styles["btn-remove"]}
            onClick={onRemoveRequest}
            title="Remove skill"
          >
            ✕
          </button>
        )}
      </div>
      <div className={styles["skill-item-desc"]}>{skill.description}</div>
      <div className={styles["skill-item-meta"]}>
        {(skill.scripts?.length ?? 0) > 0 && (
          <span className={styles["skill-item-tools"]}>
            {skill.scripts!.length} script{skill.scripts!.length !== 1 ? "s" : ""}
          </span>
        )}
        {skill.author && (
          <span className={styles["skill-item-author"]}>by {skill.author}</span>
        )}
      </div>
    </div>
  );
}

// ── Install form ─────────────────────────────────────────────────────────────

type InstallMode = "url" | "text";

interface InstallFormProps {
  readonly host: UiPluginHost<PluginStateExtension, SkillBridge>;
  readonly onInstalled: () => void;
  readonly onCancel: () => void;
}

function InstallForm({ host, onInstalled, onCancel }: InstallFormProps) {
  const [mode, setMode] = useState<InstallMode>("url");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [useProxy, setUseProxy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setUrl("");
    setName("");
    setContent("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (mode === "url") {
        if (!url.trim()) throw new Error("URL is required");
        await host.bridge.install({ url: url.trim(), useProxy });
      } else {
        if (!name.trim()) throw new Error("Skill name is required");
        if (!content.trim()) throw new Error("SKILL.md content is required");
        await host.bridge.install({
          name: name.trim(),
          content: content.trim(),
          useProxy,
        });
      }
      reset();
      onInstalled();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles["install-form"]} onSubmit={handleSubmit}>
      <div className={styles["install-title"]}>Install Skill</div>

      {/* Mode toggle */}
      <div className={styles["install-mode-row"]}>
        <button
          type="button"
          className={`${styles["install-mode-btn"]} ${mode === "url" ? styles["install-mode-btn--active"] : ""}`}
          onClick={() => setMode("url")}
          disabled={saving}
        >
          From URL
        </button>
        <button
          type="button"
          className={`${styles["install-mode-btn"]} ${mode === "text" ? styles["install-mode-btn--active"] : ""}`}
          onClick={() => setMode("text")}
          disabled={saving}
        >
          Paste Text
        </button>
      </div>

      {mode === "url" ? (
        <>
          <label className={styles["install-label"]}>
            SKILL.md URL or GitHub folder URL
          </label>
          <input
            className={styles["install-input"]}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/tree/main/skills/my-skill"
            required={mode === "url"}
            disabled={saving}
            autoFocus
          />
          <div className={styles["install-hint"]}>
            Supports GitHub folder URLs (<code>/tree/</code>) and direct raw SKILL.md URLs.
          </div>
        </>
      ) : (
        <>
          <label className={styles["install-label"]}>Skill Name</label>
          <input
            className={styles["install-input"]}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-custom-skill"
            required={mode === "text"}
            disabled={saving}
            autoFocus
          />

          <label className={styles["install-label"]}>SKILL.md Content</label>
          <textarea
            className={styles["install-textarea"]}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={`---\nname: my-skill\ndescription: My custom skill\n---\n\nSystem prompt content here...`}
            rows={6}
            required={mode === "text"}
            disabled={saving}
          />
        </>
      )}

      {mode === "url" && (
        <label className={styles["install-proxy"]}>
          <input
            type="checkbox"
            checked={useProxy}
            onChange={(e) => setUseProxy(e.target.checked)}
            disabled={saving}
          />
          Use proxy (enable for external network access)
        </label>
      )}

      {error && <div className={styles["install-error"]}>{error}</div>}

      <div className={styles["install-actions"]}>
        <button
          type="button"
          className={styles["btn-cancel"]}
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="submit"
          className={styles["btn-submit"]}
          disabled={saving}
        >
          {saving ? "Installing..." : "Install"}
        </button>
      </div>
    </form>
  );
}
