/**
 * SkillManagerPanel — dropdown panel for viewing and managing Skills.
 *
 * Capabilities:
 *  • List all installed skills with name, description, author, version
 *  • Expand to see system prompt preview and scripts list
 *  • Delete a skill (with inline 2-click confirmation)
 *  • Refresh (re-read from disk)
 *  • Add a new skill: from URL, or from inline text (name + content)
 */

import React, { useState } from 'react';
import styles from './SkillManagerPanel.module.scss';
import { apiTransport } from '../../transport';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SkillEntry {
  name: string;
  description: string;
  version?: string;
  author?: string;
  systemPrompt: string;
  scripts: string[];
  skillPath?: string;
  updatedAt: string;
}

interface SkillManagerPanelProps {
  skills: SkillEntry[];
  onSync: () => Promise<void>;
  onClose: () => void;
}

// ── Add skill form ─────────────────────────────────────────────────────────────

type AddMode = 'url' | 'text';

interface AddFormProps {
  onAdded: () => void;
  onCancel: () => void;
}

function AddSkillForm({ onAdded, onCancel }: AddFormProps) {
  const [mode, setMode] = useState<AddMode>('url');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (mode === 'url') {
        await apiTransport.post('/api/skills', { url: url.trim() });
      } else {
        if (!name.trim() || !content.trim()) throw new Error('名称和内容不能为空');
        await apiTransport.post('/api/skills', {
          name: name.trim(),
          description: description.trim() || undefined,
          content: content.trim(),
        });
      }
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.addForm} onSubmit={handleSubmit}>
      <div className={styles.addTitle}>添加 Skill</div>

      {/* Mode toggle */}
      <div className={styles.modeRow}>
        {(['url', 'text'] as AddMode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`${styles.modeBtn} ${mode === m ? styles.modeBtnActive : ''}`}
            onClick={() => setMode(m)}
            disabled={saving}
          >
            {m === 'url' ? '从 URL 安装' : '手动输入'}
          </button>
        ))}
      </div>

      {mode === 'url' ? (
        <>
          <label className={styles.addLabel}>URL *</label>
          <input
            className={styles.addInput}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://raw.githubusercontent.com/…/SKILL.md"
            required
            disabled={saving}
            type="url"
            autoFocus
          />
          <div className={styles.addHint}>支持单个 SKILL.md 文件、GitHub 目录或 zip 包 URL</div>
        </>
      ) : (
        <>
          <label className={styles.addLabel}>名称 *</label>
          <input
            className={styles.addInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-skill"
            required
            disabled={saving}
            autoFocus
          />

          <label className={styles.addLabel}>描述</label>
          <input
            className={styles.addInput}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="一句话描述这个 skill 的作用"
            disabled={saving}
          />

          <label className={styles.addLabel}>内容 (Markdown / SKILL.md) *</label>
          <textarea
            className={styles.addTextarea}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={'---\nname: my-skill\ndescription: …\n---\n\nSystem prompt goes here…'}
            required
            disabled={saving}
            rows={5}
          />
        </>
      )}

      {error && <div className={styles.addError}>{error}</div>}

      <div className={styles.addActions}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={saving}>
          取消
        </button>
        <button
          type="submit"
          className={styles.submitBtn}
          disabled={saving || (mode === 'url' ? !url.trim() : !name.trim() || !content.trim())}
        >
          {saving ? '安装中…' : '安装'}
        </button>
      </div>
    </form>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function SkillManagerPanel({ skills, onSync, onClose }: SkillManagerPanelProps) {
  const [busyName, setBusyName] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [opError, setOpError] = useState<Record<string, string>>({});

  async function withBusy(name: string, fn: () => Promise<void>) {
    setBusyName(name);
    setOpError((prev) => { const n = { ...prev }; delete n[name]; return n; });
    try {
      await fn();
      await onSync();
    } catch (err) {
      setOpError((prev) => ({ ...prev, [name]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusyName(null);
    }
  }

  function handleRefresh(s: SkillEntry) {
    withBusy(s.name, () =>
      apiTransport.post(`/api/skills/refresh/${encodeURIComponent(s.name)}`).then(() => {}),
    );
  }

  function handleDelete(s: SkillEntry) {
    if (confirmDeleteName !== s.name) {
      setConfirmDeleteName(s.name);
      return;
    }
    setConfirmDeleteName(null);
    withBusy(s.name, () =>
      apiTransport.del(`/api/skills/${encodeURIComponent(s.name)}`).then(() => {}),
    );
  }

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Skills</span>
        <div className={styles.panelHeaderActions}>
          <button className={styles.syncBtn} onClick={() => onSync()} title="刷新列表">
            ↺
          </button>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Skill list */}
      <div className={styles.skillList}>
        {skills.length === 0 && !showAdd && (
          <div className={styles.empty}>暂无已安装的 Skill</div>
        )}

        {skills.map((s) => {
          const busy = busyName === s.name;
          const expanded = expandedName === s.name;
          const err = opError[s.name];

          return (
            <div key={s.name} className={`${styles.skillRow} ${expanded ? styles.skillRowExpanded : ''}`}>
              <div
                className={styles.skillMain}
                onClick={() => setExpandedName(expanded ? null : s.name)}
              >
                <div className={styles.skillInfo}>
                  <span className={styles.skillName}>{s.name}</span>
                  <span className={styles.skillMeta}>
                    {s.description}
                    {s.version && ` · v${s.version}`}
                    {s.author && ` · ${s.author}`}
                  </span>
                </div>
                <span className={styles.skillChevron}>{expanded ? '▴' : '▾'}</span>
              </div>

              {err && <div className={styles.skillError}>{err}</div>}

              {expanded && (
                <div className={styles.skillDetail}>
                  {/* Scripts */}
                  {s.scripts.length > 0 && (
                    <div className={styles.scriptList}>
                      {s.scripts.map((sc) => (
                        <span key={sc} className={styles.scriptChip} title={`scripts/${sc}`}>
                          📄 {sc}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* System prompt preview */}
                  {s.systemPrompt && (
                    <div className={styles.promptPreview}>
                      {s.systemPrompt.slice(0, 200)}
                      {s.systemPrompt.length > 200 && '…'}
                    </div>
                  )}

                  {/* Updated at */}
                  <div className={styles.skillUpdatedAt}>
                    更新于 {new Date(s.updatedAt).toLocaleString('zh-CN')}
                  </div>

                  {/* Actions */}
                  <div className={styles.skillActions}>
                    <button
                      className={styles.actionBtn}
                      onClick={() => handleRefresh(s)}
                      disabled={busy}
                      title="从磁盘重新加载"
                    >
                      ↺ 刷新
                    </button>

                    <button
                      className={`${styles.actionBtn} ${styles.actionBtnDanger} ${confirmDeleteName === s.name ? styles.actionBtnDangerConfirm : ''}`}
                      onClick={() => handleDelete(s)}
                      disabled={busy}
                      onBlur={() =>
                        setTimeout(
                          () => setConfirmDeleteName((p) => (p === s.name ? null : p)),
                          200,
                        )
                      }
                      title={confirmDeleteName === s.name ? '再次点击确认删除' : '删除 Skill'}
                    >
                      {confirmDeleteName === s.name ? '确认删除？' : '🗑 删除'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showAdd ? (
        <AddSkillForm
          onAdded={async () => {
            await onSync();
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
        />
      ) : (
        <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
          + 安装 Skill
        </button>
      )}
    </div>
  );
}
