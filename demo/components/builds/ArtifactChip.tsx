import type { BuildArtifact } from '../../api';
import styles from './Builds.module.scss';

export function ArtifactChip({ artifact }: { artifact: BuildArtifact }) {
  const downloadUrl = artifact.resource.downloadUrl ?? artifact.resource.url;
  return (
    <div className={styles.artifactChip}>
      <span className={styles.artifactIcon}>📦</span>
      <span className={styles.artifactName}>{artifact.name}</span>
      {artifact.resource.type && (
        <span className={styles.artifactType}>{artifact.resource.type}</span>
      )}
      {downloadUrl && (
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.artifactDownload}
          title="下载"
        >
          ↓
        </a>
      )}
    </div>
  );
}

export function calcDuration(start?: string, end?: string): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
