/**
 * Tests for backend/routes/skills.js — Skill management HTTP routes
 *
 * PURE PROTOCOL LAYER: routes HTTP methods/paths → skillService calls.
 *
 * Coverage:
 *   GET    /api/skills              — list skills
 *   GET    /api/skills/:name        — get skill info
 *   GET    /api/skills/:name/file?path= — read skill file content
 *   POST   /api/skills              — install skill from URL or text
 *   POST   /api/skills/refresh/:name — refresh skill
 *   DELETE /api/skills/:name        — remove skill
 *   unmatched routes → false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

const mockService = vi.hoisted(() => ({
  getSkillsList:          vi.fn(),
  getSkillInfo:           vi.fn(),
  readSkillFileContent:   vi.fn(),
  installSkill:           vi.fn(),
  installSkillFromZipUpload: vi.fn(),
  removeSkillByName:      vi.fn(),
}));

vi.mock('../services/skills.js', () => mockService);

import { handleSkillRoutes } from '../transports/network/skills.js';

function makeReq(method, path, body = null, rawBody = null) {
  const req = new EventEmitter();
  req.method = method;
  req.url = path;
  process.nextTick(() => {
    if (rawBody !== null) {
      req.emit('data', rawBody);
    } else if (body !== null) {
      req.emit('data', JSON.stringify(body));
    }
    req.emit('end');
  });
  return req;
}

function makeRes() {
  const chunks = [];
  return {
    _status: null, _headers: {}, _chunks: chunks,
    writeHead(s, h) { this._status = s; if (h) Object.assign(this._headers, h); },
    end(c) { if (c) chunks.push(c); },
    setHeader(k, v) { this._headers[k] = v; },
    json() { return JSON.parse(chunks.join('')); },
  };
}

beforeEach(() => vi.clearAllMocks());

// ── GET /api/skills ───────────────────────────────────────────────────────────

describe('GET /api/skills', () => {
  it('returns 200 with skill list', async () => {
    mockService.getSkillsList.mockReturnValue({ skills: [{ name: 'test-skill' }] });

    const res = makeRes();
    await handleSkillRoutes(makeReq('GET', '/api/skills'), res, '/api/skills');

    expect(res._status).toBe(200);
    expect(res.json().skills).toHaveLength(1);
    expect(mockService.getSkillsList).toHaveBeenCalledOnce();
  });
});

// ── GET /api/skills/:name ─────────────────────────────────────────────────────

describe('GET /api/skills/:name', () => {
  it('returns 200 with skill info', async () => {
    mockService.getSkillInfo.mockReturnValue({ name: 'my-skill', description: 'A skill' });

    const res = makeRes();
    await handleSkillRoutes(makeReq('GET', '/api/skills/my-skill'), res, '/api/skills/my-skill');

    expect(res._status).toBe(200);
    expect(res.json().name).toBe('my-skill');
    expect(mockService.getSkillInfo).toHaveBeenCalledWith({ name: 'my-skill' });
  });

  it('URL-decodes the skill name', async () => {
    mockService.getSkillInfo.mockReturnValue({ name: 'my skill' });

    const res = makeRes();
    await handleSkillRoutes(makeReq('GET', '/api/skills/my%20skill'), res, '/api/skills/my%20skill');

    expect(mockService.getSkillInfo).toHaveBeenCalledWith({ name: 'my skill' });
  });
});

// ── GET /api/skills/:name/file?path= ──────────────────────────────────────────

describe('GET /api/skills/:name/file', () => {
  it('returns 200 with file content', async () => {
    mockService.readSkillFileContent.mockReturnValue({ content: '# Hello', path: 'README.md' });

    const res = makeRes();
    await handleSkillRoutes(
      makeReq('GET', '/api/skills/my-skill/file?path=README.md'),
      res,
      '/api/skills/my-skill/file',
    );

    expect(res._status).toBe(200);
    expect(mockService.readSkillFileContent).toHaveBeenCalledWith({ name: 'my-skill', path: 'README.md' });
  });

  it('handles missing path query param', async () => {
    mockService.readSkillFileContent.mockReturnValue({ content: '' });

    const res = makeRes();
    await handleSkillRoutes(
      makeReq('GET', '/api/skills/my-skill/file'),
      res,
      '/api/skills/my-skill/file',
    );

    expect(mockService.readSkillFileContent).toHaveBeenCalledWith({ name: 'my-skill', path: null });
  });
});

// ── POST /api/skills ──────────────────────────────────────────────────────────

describe('POST /api/skills', () => {
  it('returns 201 with install result', async () => {
    const body = { url: 'https://example.com/skill.zip' };
    mockService.installSkill.mockResolvedValue({ name: 'installed-skill' });

    const res = makeRes();
    await handleSkillRoutes(makeReq('POST', '/api/skills', body), res, '/api/skills');

    expect(res._status).toBe(201);
    expect(res.json().name).toBe('installed-skill');
    expect(mockService.installSkill).toHaveBeenCalledWith(body);
  });
});

// ── POST /api/skills/refresh/:name ────────────────────────────────────────────

describe('POST /api/skills/refresh/:name', () => {
  it('returns 200 with refreshed skill info', async () => {
    mockService.getSkillInfo.mockReturnValue({ name: 'my-skill' });

    const res = makeRes();
    await handleSkillRoutes(makeReq('POST', '/api/skills/refresh/my-skill'), res, '/api/skills/refresh/my-skill');

    expect(res._status).toBe(200);
    expect(mockService.getSkillInfo).toHaveBeenCalledWith({ name: 'my-skill' });
  });
});

// ── DELETE /api/skills/:name ──────────────────────────────────────────────────

describe('DELETE /api/skills/:name', () => {
  it('returns 200 with removal result', async () => {
    mockService.removeSkillByName.mockReturnValue({ removed: 'my-skill' });

    const res = makeRes();
    await handleSkillRoutes(makeReq('DELETE', '/api/skills/my-skill'), res, '/api/skills/my-skill');

    expect(res._status).toBe(200);
    expect(res.json().removed).toBe('my-skill');
    expect(mockService.removeSkillByName).toHaveBeenCalledWith({ name: 'my-skill' });
  });
});

// ── Unmatched routes ──────────────────────────────────────────────────────────

describe('unmatched routes', () => {
  it('returns false for an unknown path', async () => {
    const result = await handleSkillRoutes(makeReq('GET', '/api/unknown'), makeRes(), '/api/unknown');
    expect(result).toBe(false);
  });
});
