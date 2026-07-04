import React from 'react';
import styles from './Spinner.module.scss';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export function Spinner({ size = 'md', label }: SpinnerProps) {
  return (
    <div className={`${styles.wrapper} ${styles[size]}`} role="status" aria-label={label ?? '加载中'}>
      <div className={styles.ring} />
      {label && <span className={styles.label}>{label}</span>}
    </div>
  );
}
