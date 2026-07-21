/**
 * RichTextEditor
 * ──────────────
 * WYSIWYG HTML editor built on Tiptap / ProseMirror.
 *
 * Accepts and emits standard HTML strings (same format ADO uses for
 * `System.Description`, `AcceptanceCriteria`, `ReproSteps`, etc.).
 *
 * The component is semi-controlled: `value` seeds the initial content and can
 * push updates from outside (e.g. form reset). The editor fires `onChange`
 * on every keystroke / structure change.
 */

import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import styles from './RichTextEditor.module.scss';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface RichTextEditorProps {
  /** Current HTML value (semi-controlled). */
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

// ── Toolbar button ────────────────────────────────────────────────────────────

interface ToolbarButtonProps {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onMouseDown: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}

function ToolbarButton({ active, disabled, title, onMouseDown, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={onMouseDown}
      disabled={disabled}
      className={`${styles.toolbarBtn} ${active ? styles.toolbarBtnActive : ''}`}
    >
      {children}
    </button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RichTextEditor({ value, onChange, disabled = false, placeholder }: RichTextEditorProps) {
  // Track the last HTML we sent to onChange so we don't re-apply our own echo.
  const lastEmittedRef = useRef<string>(value);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable codeBlock to keep the toolbar simple for DevOps use.
        codeBlock: false,
      }),
      Underline,
    ],
    content: value || '',
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      // Normalise empty paragraph to empty string to avoid spurious '<p></p>' saves.
      const normalised = html === '<p></p>' ? '' : html;
      lastEmittedRef.current = normalised;
      onChange(normalised);
    },
  });

  // Sync external value changes (e.g. form reset, type change in create mode).
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    // Value changed from outside — push into editor without triggering onUpdate loop.
    editor.commands.setContent(value || '');
    lastEmittedRef.current = value;
  }, [value, editor]);

  // Sync disabled flag.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  if (!editor) return null;

  // ── Toolbar helpers ────────────────────────────────────────────────────────

  const btn = (
    title: string,
    active: boolean,
    action: () => void,
    label: React.ReactNode,
  ) => (
    <ToolbarButton
      key={title}
      title={title}
      active={active}
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); action(); }}
    >
      {label}
    </ToolbarButton>
  );

  return (
    <div className={`${styles.editor} ${disabled ? styles.editorDisabled : ''}`}>
      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        {btn('粗体 (Ctrl+B)', editor.isActive('bold'),
          () => editor.chain().focus().toggleBold().run(), <b>B</b>)}
        {btn('斜体 (Ctrl+I)', editor.isActive('italic'),
          () => editor.chain().focus().toggleItalic().run(), <i>I</i>)}
        {btn('下划线 (Ctrl+U)', editor.isActive('underline'),
          () => editor.chain().focus().toggleUnderline().run(), <u>U</u>)}
        {btn('删除线', editor.isActive('strike'),
          () => editor.chain().focus().toggleStrike().run(), <s>S</s>)}

        <span className={styles.toolbarDivider} />

        {btn('标题 2', editor.isActive('heading', { level: 2 }),
          () => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'H2')}
        {btn('标题 3', editor.isActive('heading', { level: 3 }),
          () => editor.chain().focus().toggleHeading({ level: 3 }).run(), 'H3')}

        <span className={styles.toolbarDivider} />

        {btn('无序列表', editor.isActive('bulletList'),
          () => editor.chain().focus().toggleBulletList().run(), '• —')}
        {btn('有序列表', editor.isActive('orderedList'),
          () => editor.chain().focus().toggleOrderedList().run(), '1.')}

        <span className={styles.toolbarDivider} />

        {btn('清除格式', false,
          () => editor.chain().focus().clearNodes().unsetAllMarks().run(), '✕ 格式')}
      </div>

      {/* ── Content ── */}
      <EditorContent
        editor={editor}
        className={styles.content}
        data-placeholder={placeholder}
      />
    </div>
  );
}
