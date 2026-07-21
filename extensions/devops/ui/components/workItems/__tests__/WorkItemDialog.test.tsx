/**
 * Tests for WorkItemDialog — unified view/create dialog.
 *
 * Uses @vitest-environment jsdom for React rendering.
 * Mocks API calls and sub-components to isolate dialog logic.
 */

// @vitest-environment happy-dom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { WorkItemDialog } from '../WorkItemDialog';
import type { WorkItem, WorkItemTypeDef, WorkItemFieldDef } from '../../../api';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockItem: WorkItem = {
  id: 1001,
  type: 'Task',
  title: '测试工作项',
  state: 'New',
  assignedTo: '张三',
  priority: 2,
  iterationPath: 'uMetaOS\\Sprint 10',
  areaPath: 'uMetaOS\\MetaHospital',
  tags: 'frontend',
  effort: 3,
  originalEstimate: 5,
  remainingWork: 2,
  completedWork: 1,
  customFields: {},
  children: [],
};

const mockTypes = [
  { name: 'Task', color: '0078d4', states: [{ name: 'New', color: '000000', category: 'Proposed' }, { name: 'Active', color: '000000', category: 'InProgress' }, { name: 'Resolved', color: '000000', category: 'Resolved' }, { name: 'Closed', color: '000000', category: 'Completed' }] },
  { name: 'Bug', color: 'd73a4a', states: [{ name: 'New', color: '000000', category: 'Proposed' }, { name: 'Active', color: '000000', category: 'InProgress' }, { name: 'Resolved', color: '000000', category: 'Resolved' }, { name: 'Closed', color: '000000', category: 'Completed' }] },
] as unknown as WorkItemTypeDef[];

const mockFieldDefs: WorkItemFieldDef[] = [
  { referenceName: 'System.Title', name: '标题', type: 'string', isCustom: false, readOnly: false, isIdentity: false, isPicklist: false },
];

const defaultProps = {
  collectionUrl: 'https://navi.united-imaging.com/MetaHospital',
  project: 'uMetaOS',
  pat: 'test-pat',
  types: mockTypes,
  iterations: ['Sprint 10'],
  areas: ['MetaHospital'],
  members: ['张三', '李四'],
  fieldDefs: mockFieldDefs,
  tagOptions: ['frontend', 'urgent'],
  onClose: vi.fn(),
  onSaved: vi.fn(),
};

// ── Mock API ─────────────────────────────────────────────────────────────────

vi.mock('../../api', () => ({
  fetchSingleWorkItemFull: vi.fn(),
  fetchWorkItemFields: vi.fn(),
  fetchWorkItemComments: vi.fn().mockResolvedValue([]),
  fetchWorkItemUpdates: vi.fn().mockResolvedValue([]),
  addWorkItemComment: vi.fn(),
  updateWorkItem: vi.fn(),
  deleteWorkItem: vi.fn(),
  uploadAttachment: vi.fn(),
  addAttachmentToWorkItem: vi.fn(),
  createWorkItem: vi.fn(),
}));

// ── Mock uiBridge ────────────────────────────────────────────────────────────

vi.mock('../../tools/uiBridge', () => ({
  uiBridge: {
    register: vi.fn(),
    unregister: vi.fn(),
    isRegistered: vi.fn().mockReturnValue(false),
  },
}));

// ── Mock sub-components ──────────────────────────────────────────────────────

vi.mock('../shared/Spinner', () => ({
  Spinner: ({ label }: { label: string }) => <div data-testid="spinner">{label}</div>,
}));

vi.mock('../WorkItemDetail', () => ({
  WorkItemDetail: ({ item }: { item: WorkItem }) => <div data-testid="detail">{item.title}</div>,
}));

vi.mock('../WorkItemComments', () => ({
  WorkItemComments: () => <div data-testid="comments">评论</div>,
}));

vi.mock('../WorkItemHistory', () => ({
  WorkItemHistory: () => <div data-testid="history">历史</div>,
}));

vi.mock('../WorkItemAttachmentTab', () => ({
  WorkItemAttachmentTab: () => <div data-testid="attachments">附件</div>,
}));

vi.mock('../WorkItemForm', () => ({
  WorkItemForm: ({ mode, onSave, saving }: {
    mode: string; onSave: () => void; saving: boolean;
  }) => (
    <div data-testid="form">
      <span data-testid="form-mode">{mode}</span>
      {saving && <span data-testid="saving">保存中</span>}
      <button data-testid="save-btn" onClick={onSave}>保存</button>
    </div>
  ),
}));

// ── Import mocked modules ────────────────────────────────────────────────────

import * as api from '../../../api';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WorkItemDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('view mode', () => {
    beforeEach(() => {
      vi.mocked(api.fetchSingleWorkItemFull).mockResolvedValue(mockItem);
      vi.mocked(api.fetchWorkItemFields).mockResolvedValue(mockFieldDefs);
    });

    it('显示 loading 状态后加载 item', async () => {
      render(
        <WorkItemDialog
          {...defaultProps}
          mode="view"
          dialogId="dialog-1001"
          itemId={1001}
        />,
      );

      // Initially shows spinner
      expect(screen.getByTestId('spinner')).toBeInTheDocument();

      // After load: shows item title, type chip, and ID
      await waitFor(() => {
        expect(screen.getByText('测试工作项')).toBeInTheDocument();
      });
      expect(screen.getByText('Task')).toBeInTheDocument();
      expect(screen.getByText('#1001')).toBeInTheDocument();
      expect(screen.getByTestId('detail')).toBeInTheDocument();
    });

    it('加载失败时显示错误', async () => {
      vi.mocked(api.fetchSingleWorkItemFull).mockRejectedValue(new Error('网络错误'));

      render(
        <WorkItemDialog
          {...defaultProps}
          mode="view"
          dialogId="dialog-1002"
          itemId={1002}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText(/网络错误/)).toBeInTheDocument();
      });
    });

    it('切换 tab 显示对应内容', async () => {
      render(
        <WorkItemDialog
          {...defaultProps}
          mode="view"
          dialogId="dialog-1003"
          itemId={1003}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('测试工作项')).toBeInTheDocument();
      });

      // Click each tab button
      fireEvent.click(screen.getByText('编辑'));
      fireEvent.click(screen.getByText('评论'));
      fireEvent.click(screen.getByText('历史'));
      fireEvent.click(screen.getByText('附件'));

      // Edit tab shows form
      fireEvent.click(screen.getByText('编辑'));
      expect(screen.getByTestId('form')).toBeInTheDocument();
      expect(screen.getByTestId('form-mode').textContent).toBe('edit');
    });

    it('编辑并保存成功后调用 onSaved', async () => {
      vi.mocked(api.updateWorkItem).mockResolvedValue(undefined);
      vi.mocked(api.fetchSingleWorkItemFull).mockResolvedValue(mockItem);

      render(
        <WorkItemDialog
          {...defaultProps}
          mode="view"
          dialogId="dialog-save"
          itemId={1004}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('测试工作项')).toBeInTheDocument();
      });

      // Go to edit tab
      fireEvent.click(screen.getByText('编辑'));

      // Click save
      fireEvent.click(screen.getByTestId('save-btn'));

      await waitFor(() => {
        expect(api.updateWorkItem).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.any(String),
          1004,
          expect.any(Object),
        );
      });
      expect(defaultProps.onSaved).toHaveBeenCalled();
    });

    it('编辑保存失败时显示错误', async () => {
      vi.mocked(api.updateWorkItem).mockRejectedValue(new Error('保存失败'));

      render(
        <WorkItemDialog
          {...defaultProps}
          mode="view"
          dialogId="dialog-fail"
          itemId={1005}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('测试工作项')).toBeInTheDocument();
      });

      // Go to edit tab
      fireEvent.click(screen.getByText('编辑'));

      // Click save
      fireEvent.click(screen.getByTestId('save-btn'));

      await waitFor(() => {
        expect(screen.getByText(/保存失败/)).toBeInTheDocument();
      });
    });

    it('删除确认流程：第一次点击显示确认，第二次触发删除', async () => {
      vi.mocked(api.deleteWorkItem).mockResolvedValue(undefined);

      render(
        <WorkItemDialog
          {...defaultProps}
          mode="view"
          dialogId="dialog-del"
          itemId={1006}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('测试工作项')).toBeInTheDocument();
      });

      // Click delete button
      const deleteBtn = screen.getByText('🗑');
      fireEvent.click(deleteBtn);

      // Should show confirm text
      expect(screen.getByText('确认删除？')).toBeInTheDocument();

      // Click again to confirm
      fireEvent.click(deleteBtn);

      await waitFor(() => {
        expect(api.deleteWorkItem).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.any(String),
          1006,
        );
      });
      expect(defaultProps.onClose).toHaveBeenCalled();
      expect(defaultProps.onSaved).toHaveBeenCalled();
    });
  });

  describe('create mode', () => {
    it('直接显示创建表单', () => {
      render(
        <WorkItemDialog
          {...defaultProps}
          mode="create"
          dialogId="create-1"
        />,
      );

      expect(screen.getByTestId('form')).toBeInTheDocument();
      expect(screen.getByTestId('form-mode').textContent).toBe('create');
    });

    it('创建成功后关闭弹窗并刷新', async () => {
      vi.mocked(api.createWorkItem).mockResolvedValue(mockItem);

      render(
        <WorkItemDialog
          {...defaultProps}
          mode="create"
          dialogId="create-2"
        />,
      );

      // Click save on the form
      fireEvent.click(screen.getByTestId('save-btn'));

      await waitFor(() => {
        expect(api.createWorkItem).toHaveBeenCalled();
      });
      expect(defaultProps.onSaved).toHaveBeenCalled();
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('创建失败时显示错误', async () => {
      vi.mocked(api.createWorkItem).mockRejectedValue(new Error('创建失败'));

      render(
        <WorkItemDialog
          {...defaultProps}
          mode="create"
          dialogId="create-3"
        />,
      );

      fireEvent.click(screen.getByTestId('save-btn'));

      await waitFor(() => {
        expect(screen.getByText(/创建失败/)).toBeInTheDocument();
      });
      // Should NOT close on failure
      expect(defaultProps.onClose).not.toHaveBeenCalled();
    });
  });

  describe('startEdit', () => {
    it('startEdit=true 时直接显示编辑 tab', async () => {
      vi.mocked(api.fetchSingleWorkItemFull).mockResolvedValue(mockItem);
      vi.mocked(api.fetchWorkItemFields).mockResolvedValue(mockFieldDefs);

      render(
        <WorkItemDialog
          {...defaultProps}
          mode="view"
          dialogId="dialog-edit"
          itemId={1007}
          startEdit
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId('form')).toBeInTheDocument();
      });
    });
  });
});
