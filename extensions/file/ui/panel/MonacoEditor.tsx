/**
 * extensions/file/ui/panel/MonacoEditor.tsx — Monaco code editor wrapper
 *
 * Ported 1:1 from the devops plugin's editor.
 */

import { useCallback, useRef } from 'react';
import MonacoReact, { type OnMount, type BeforeMount, type Monaco } from '@monaco-editor/react';

// ── Language detection ────────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts: 'typescript',   tsx: 'typescript',
  js: 'javascript',   jsx: 'javascript',
  json: 'json',       html: 'html',
  css: 'css',         scss: 'scss',
  less: 'less',       md: 'markdown',
  py: 'python',       rs: 'rust',
  go: 'go',           java: 'java',
  cs: 'csharp',       cpp: 'cpp',
  c: 'c',             sh: 'shell',
  bat: 'bat',         yml: 'yaml',
  yaml: 'yaml',       toml: 'ini',
  xml: 'xml',         sql: 'sql',
  txt: 'plaintext',
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[ext] ?? 'plaintext';
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  readonly filePath: string;
  readonly content: string;
  readonly onChange: (value: string) => void;
  readonly onSave: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MonacoEditor({ filePath, content, onChange, onSave }: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const handleBeforeMount: BeforeMount = useCallback((monaco: Monaco) => {
    monaco.editor.defineTheme('file-plugin-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1f2228',
        'editor.lineHighlightBackground': '#262c36',
        'editorLineNumber.foreground': '#6e7681',
        'editorLineNumber.activeForeground': '#8b949e',
        'editor.selectionBackground': '#1f4068',
        'editor.inactiveSelectionBackground': '#182535',
        'editorCursor.foreground': '#58a6ff',
      },
    });
  }, []);

  const handleMount: OnMount = useCallback(
    (editor, monaco: Monaco) => {
      editorRef.current = editor;
      monaco.editor.setTheme('file-plugin-dark');

      // Ctrl+S / Cmd+S → save
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSave();
      });
    },
    [onSave],
  );

  return (
    <MonacoReact
      height="100%"
      language={detectLanguage(filePath)}
      value={content}
      onChange={(val) => onChange(val ?? '')}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
        fontLigatures: true,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        renderWhitespace: 'selection',
        tabSize: 2,
        insertSpaces: true,
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        bracketPairColorization: { enabled: true },
        padding: { top: 8 },
      }}
    />
  );
}
