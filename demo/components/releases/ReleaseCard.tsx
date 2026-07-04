import { useState } from 'react';
import type { Release, ReleaseEnvironment } from '../../api';
import styles from './Releases.module.scss';

export function ReleaseCard({ release }: { release: Release }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.releaseCard}>
      <div className={styles.releaseCardHeader} onClick={() => setExpanded((v) => !v)}>
        <div className={styles.releaseCardLeft}>
          <span className={styles.chevron}>{expanded ? '▾' : '▸'}</span>
          <div className={styles.releaseName}>{release.name}</div>
          <ReleaseStatusBadge status={release.status} />
        </div>
        <div className={styles.releaseCardRight}>
          {release.createdBy?.displayName && (
            <span className={styles.releaseBy}>{release.createdBy.displayName}</span>
          )}
          {release.createdOn && (
            <span className={styles.releaseDate}>
              {new Date(release.createdOn).toLocaleString('zh-CN')}
            </span>
          )}
          {release.webAccessUri && (
            <a
              href={release.webAccessUri}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.releaseLink}
              onClick={(e) => e.stopPropagation()}
            >
              ↗
            </a>
          )}
        </div>
      </div>

      {release.environments && release.environments.length > 0 && (
        <div className={styles.envPipeline}>
          {release.environments.map((env) => (
            <EnvStage key={env.id} env={env} />
          ))}
        </div>
      )}

      {expanded && (
        <div className={styles.releaseDetail}>
          {release.description && (
            <p className={styles.releaseDesc}>{release.description}</p>
          )}
          {release.artifacts && release.artifacts.length > 0 && (
            <div className={styles.artifactsSection}>
              <span className={styles.artifactsLabel}>制品：</span>
              {release.artifacts.map((a, i) => {
                const branch = a.definitionReference?.branch?.name;
                const version = a.definitionReference?.version?.name;
                return (
                  <span key={i} className={styles.artifactChip}>
                    {a.alias}
                    {(branch || version) && (
                      <span className={styles.artifactDetail}>
                        {branch && `@${branch}`}
                        {version && ` (${version})`}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EnvStage({ env }: { env: ReleaseEnvironment }) {
  const cls = envStatusClass(env.status);
  return (
    <div className={`${styles.envStage} ${cls}`} title={env.status}>
      <span className={styles.envName}>{env.name}</span>
      <span className={styles.envStatus}>{envStatusIcon(env.status)}</span>
    </div>
  );
}

function envStatusClass(status: string): string {
  switch (status) {
    case 'succeeded': return styles.envSucceeded;
    case 'inProgress':
    case 'queued': return styles.envInProgress;
    case 'rejected':
    case 'canceled': return styles.envFailed;
    case 'partiallySucceeded': return styles.envPartial;
    default: return styles.envNotStarted;
  }
}

function envStatusIcon(status: string): string {
  switch (status) {
    case 'succeeded': return '✓';
    case 'inProgress': return '↻';
    case 'queued': return '⏸';
    case 'rejected':
    case 'canceled': return '✕';
    case 'partiallySucceeded': return '~';
    default: return '○';
  }
}

function ReleaseStatusBadge({ status }: { status: string }) {
  const cls =
    status === 'active' ? styles.statusActive
    : status === 'abandoned' ? styles.statusAbandoned
    : status === 'draft' ? styles.statusDraft
    : styles.statusDefault;
  const label =
    status === 'active' ? '活跃'
    : status === 'abandoned' ? '已放弃'
    : status === 'draft' ? '草稿'
    : status;
  return <span className={`${styles.releaseBadge} ${cls}`}>{label}</span>;
}
