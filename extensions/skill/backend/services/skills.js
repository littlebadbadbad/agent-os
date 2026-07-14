/**
 * backend/services/skills.js — Skill-store business API
 *
 * One function per API method. ALL business logic lives here.
 * Bound to a specific agent directory via the factory.
 */

/**
 * Create skill service functions bound to the given store.
 *
 * @param {object} store — skill store from createSkillStore()
 * @returns {{
 *   getSkillsList: () => { skills: Array },
 *   getSkillInfo: ({ name: string }) => object,
 *   installSkill: ({ url?: string, name?: string, content?: string }) => Promise<{ installed: string, message: string }>,
 *   removeSkillByName: ({ name: string }) => { deleted: string },
 *   readSkillFileContent: ({ name: string, path: string }) => { content: string, path: string },
 * }}
 */
export function createSkillService(store) {
  function getSkillsList() {
    return { skills: store.listSkills() };
  }

  function getSkillInfo({ name }) {
    if (!name) throw new Error('name is required');
    const skill = store.getSkill(name);
    if (!skill) throw new Error(`Skill "${name}" not found`);
    return skill;
  }

  async function installSkill({ url, name, content }) {
    if (url) {
      const skill = await store.fetchAndInstallSkill(url);
      return { installed: skill.name, message: `Skill "${skill.name}" installed successfully.` };
    }
    if (!name || !content) throw new Error('name and content are required when installing from text');
    const skill = store.installSkillFromText({ name, content });
    return { installed: skill.name, message: `Skill "${skill.name}" installed.` };
  }

  function removeSkillByName({ name }) {
    if (!name) throw new Error('name is required');
    store.removeSkill(name);
    return { deleted: name };
  }

  function readSkillFileContent({ name, path }) {
    if (!name) throw new Error('name is required');
    if (!path) throw new Error('path is required');
    return store.readSkillFile(name, path);
  }

  return {
    getSkillsList,
    getSkillInfo,
    installSkill,
    removeSkillByName,
    readSkillFileContent,
  };
}
