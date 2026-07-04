import React from 'react';
import styles from './Pagination.module.scss';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  /** When true, actual total exceeds `total` — renders "N+" label. */
  isCapped?: boolean;
  pageSizeOptions?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

export function Pagination({ page, pageSize, total, isCapped, pageSizeOptions, onPageChange, onPageSizeChange }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);
  if (total === 0) return null;

  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);

  return (
    <div className={styles.wrapper}>
      <span className={styles.info}>
        {start}–{end} / {isCapped ? `${total}+` : total}
      </span>
      {pageSizeOptions && onPageSizeChange && (
        <select
          className={styles.pageSizeSelect}
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          aria-label="每页条数"
        >
          {pageSizeOptions.map((s) => (
            <option key={s} value={s}>{s} 条/页</option>
          ))}
        </select>
      )}
      {totalPages > 1 && (
      <div className={styles.controls}>
        <button
          className={styles.btn}
          onClick={() => onPageChange(0)}
          disabled={page === 0}
          title="第一页"
        >
          «
        </button>
        <button
          className={styles.btn}
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0}
          title="上一页"
        >
          ‹
        </button>
        <span className={styles.pages}>
          {page + 1} / {totalPages}
        </span>
        <button
          className={styles.btn}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages - 1}
          title="下一页"
        >
          ›
        </button>
        <button
          className={styles.btn}
          onClick={() => onPageChange(totalPages - 1)}
          disabled={page >= totalPages - 1}
          title="最后一页"
        >
          »
        </button>
      </div>
      )}
    </div>
  );
}
