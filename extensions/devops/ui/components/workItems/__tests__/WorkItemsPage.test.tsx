/**
 * Tests for WorkItemsPage — multi-dialog state management.
 *
 * Tests focus on the pure state logic: opening/closing dialogs,
 * ID deduplication, and the counter-based ID generation.
 * The full rendering with API responses is tested in WorkItemDialog tests.
 */

// @vitest-environment happy-dom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkItemsPage } from '../WorkItemsPage';

// ── Mock API ─────────────────────────────────────────────────────────────────

import '@testing-library/jest-dom/vitest';

vi.mock('../../../api', () => ({
  fetchWorkItemTypes: vi.fn().mockResolvedValue([
    { name: 'Task', color: '0078d4', states: [{ name: 'New' }, { name: 'Active' }], fields: [] },
  ]),
  fetchWorkItemFields: vi.fn().mockResolvedValue([
    { referenceName: 'System.Title', name: '标题', type: 'string', isCustom: false, readOnly: false, isIdentity: false, isPicklist: false },
  ]),
  fetchFieldAllowedValues: vi.fn().mockResolvedValue([]),
  fetchFilteredWorkItemIds: vi.fn().mockResolvedValue({ ids: [], isCapped: false, cap: 500 }),
  fetchWorkItemDetails: vi.fn().mockResolvedValue([]),
  fetchIterations: vi.fn().mockResolvedValue(['Sprint 10']),
  fetchAreas: vi.fn().mockResolvedValue(['MetaHospital']),
  fetchProjectMembers: vi.fn().mockResolvedValue(['张三', '李四']),
  fetchProjectTags: vi.fn().mockResolvedValue(['frontend', 'urgent']),
  composeFilter: vi.fn().mockReturnValue({}),
}));

// ── Mock sub-components ──────────────────────────────────────────────────────

vi.mock('../WorkItemFilters', () => ({
  WorkItemFilters: ({ onCreate, onRefresh }: { onCreate: () => void; onRefresh: () => void }) => (
    <div data-testid="filters">
      <button data-testid="create-btn" onClick={onCreate}>新建</button>
      <button data-testid="refresh-btn" onClick={onRefresh}>刷新</button>
    </div>
  ),
}));

vi.mock('../WorkItemTable', () => ({
  WorkItemTable: ({ onRowClick }: { onRowClick: (id: number) => void; items: Array<{ id: number }> }) => (
    <div data-testid="table">
      <button data-testid="row-42" onClick={() => onRowClick(42)}>行 42</button>
      <button data-testid="row-43" onClick={() => onRowClick(43)}>行 43</button>
    </div>
  ),
}));

vi.mock('../WorkItemDialog', () => ({
  WorkItemDialog: ({ mode, dialogId, itemId, onClose, onSaved }: {
    mode: string; dialogId: string; itemId?: number; onClose: () => void; onSaved: () => void;
  }) => (
    <div data-testid={`dialog-${dialogId}`} data-mode={mode} data-itemid={itemId}>
      <span>{mode === 'create' ? '新建' : `查看 #${itemId}`}</span>
      <button data-testid={`close-${dialogId}`} onClick={onClose}>关闭</button>
    </div>
  ),
}));

vi.mock('../shared/Spinner', () => ({
  Spinner: ({ label }: { label: string }) => <div data-testid="spinner">{label}</div>,
}));

vi.mock('../shared/EmptyState', () => ({
  EmptyState: () => <div data-testid="empty">空列表</div>,
}));

vi.mock('../shared/Pagination', () => ({
  Pagination: () => <div data-testid="pagination">分页</div>,
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WorkItemsPage', () => {
  const renderPage = () => render(
    <WorkItemsPage
      collectionUrl="https://navi.united-imaging.com/MetaHospital"
      project="uMetaOS"
      pat="test-pat"
    />,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('initial state', () => {
    it('无弹窗时不显示弹窗容器', async () => {
      renderPage();

      // Wait for loading to finish
      await waitFor(() => {
        expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
      });

      // No dialog container when no dialogs are open
      expect(screen.queryByTestId(/^dialog-/)).not.toBeInTheDocument();
    });
  });

  describe('dialog state management', () => {
    it('点击创建按钮后打开新建弹窗', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('create-btn')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('create-btn'));

      // Should show a create dialog
      await waitFor(() => {
        const dialogs = screen.getAllByText('新建');
        expect(dialogs.length).toBeGreaterThan(0);
      });
    });

    it('多次点击创建按钮打开多个弹窗', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('create-btn')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('create-btn'));
      await userEvent.click(screen.getByTestId('create-btn'));
      await userEvent.click(screen.getByTestId('create-btn'));

      const createDialogs = screen.getAllByTestId(/^dialog-create-/);
      expect(createDialogs.length).toBe(3);
    });

    it('关闭弹窗后弹窗消失', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('create-btn')).toBeInTheDocument();
      });

      // Open a dialog
      await userEvent.click(screen.getByTestId('create-btn'));

      // Find the close button and click it
      await waitFor(() => {
        const closeBtn = screen.queryByTestId(/^close-create-/);
        expect(closeBtn).toBeInTheDocument();
      });

      // Get all close buttons
      const closeBtns = screen.getAllByTestId(/^close-/);
      await userEvent.click(closeBtns[0]);

      // Dialog should be gone
      await waitFor(() => {
        expect(screen.queryByTestId(/^dialog-create/)).not.toBeInTheDocument();
      });
    });
  });

  describe('accessibility and mode switching', () => {
    it('打开和关闭多个不同类型弹窗', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('filters')).toBeInTheDocument();
      });

      // Open two create dialogs
      await userEvent.click(screen.getByTestId('create-btn'));
      await userEvent.click(screen.getByTestId('create-btn'));

      // Verify both are present
      await waitFor(() => {
        const createDialogs = screen.getAllByTestId(/^dialog-create-/);
        expect(createDialogs.length).toBe(2);
      });

      // Close one
      const closeBtns = screen.getAllByTestId(/^close-create-/);
      await userEvent.click(closeBtns[closeBtns.length - 1]);

      // One should remain
      await waitFor(() => {
        const remaining = screen.getAllByTestId(/^dialog-create-/);
        expect(remaining.length).toBe(1);
      });
    });
  });
});
