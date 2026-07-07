/**
 * backend/transports/ipc/skills.js — Skill-store IPC handlers
 *
 * PURE PROTOCOL LAYER — ZERO business logic.
 * Only: extract params → call service → return result.
 */

import * as skillService from '../../services/skills.js';

/** @param {import('electron').IpcMain} ipcMain */
export function registerSkillHandlers(ipcMain) {
  ipcMain.handle('skills:list', async () => skillService.getSkillsList());
  ipcMain.handle('skills:install', async (_e, p) => skillService.installSkill(p));
  ipcMain.handle('skills:remove', async (_e, p) => skillService.removeSkillByName(p));
  ipcMain.handle('skills:refresh', async (_e, p) => skillService.getSkillInfo(p));
  ipcMain.handle('skills:readFile', async (_e, p) => skillService.readSkillFileContent(p));
}
