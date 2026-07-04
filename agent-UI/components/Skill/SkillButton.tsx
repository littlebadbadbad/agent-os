import { useState, useEffect } from 'react';
import { SkillManagerPanel } from './SkillManagerPanel';
import type { SkillEntry } from './SkillManagerPanel';
import { DropdownPanel } from '../DropdownPanel';
import { listSkills } from '../../api/backend';
import styles from './SkillButton.module.scss';

export function SkillButton() {
  const [skills, setSkills] = useState<SkillEntry[]>([]);

  async function syncSkills() {
    try {
      const data = await listSkills();
      setSkills((data.skills ?? []) as SkillEntry[]);
    } catch { /* ignore */ }
  }

  useEffect(() => { syncSkills(); }, []);

  return (
    <DropdownPanel
      trigger={
        <button
          className={`${styles.skillPill} ${skills.length > 0 ? styles.skillPillActive : ''}`}
          title="管理 Skills"
        >
          🎞 Skills
          {skills.length > 0 && <span className={styles.skillCount}>{skills.length}</span>}
        </button>
      }
    >
      {({ close }) => (
        <SkillManagerPanel
          skills={skills}
          onSync={syncSkills}
          onClose={close}
        />
      )}
    </DropdownPanel>
  );
}
