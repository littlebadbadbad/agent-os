/**
 * backend/lib/services/skills.js — Skill-store business API
 *
 * One function per IPC channel / HTTP endpoint.
 * ALL business logic lives here.
 */

import {
  listSkills,
  getSkill,
  removeSkill,
  readSkillFile,
  fetchAndInstallSkill,
  installSkillFromText,
  installSkillFromZip,
} from '../lib/skill-store/index.js';

export function getSkillsList() {
  return { skills: listSkills() };
}

export function getSkillInfo({ name }) {
  if (!name) throw new Error('name is required');
  const skill = getSkill(name);
  if (!skill) throw new Error(`Skill "${name}" not found`);
  return skill;
}

export async function installSkill({ url, name, content }) {
  if (url) {
    const skill = await fetchAndInstallSkill(url);
    return { installed: skill.name, message: `Skill "${skill.name}" installed successfully.` };
  }
  if (!name || !content) throw new Error('name and content are required when installing from text');
  const skill = await installSkillFromText({ name, content });
  return { installed: skill.name, message: `Skill "${skill.name}" installed.` };
}

export async function installSkillFromZipUpload(buffer) {
  const skill = await installSkillFromZip(buffer);
  return { installed: skill.name, message: `Skill "${skill.name}" installed from zip.` };
}

export function removeSkillByName({ name }) {
  if (!name) throw new Error('name is required');
  removeSkill(name);
  return { deleted: name };
}

export function readSkillFileContent({ name, path }) {
  if (!name) throw new Error('name is required');
  if (!path) throw new Error('path is required');
  return readSkillFile(name, path);
}
