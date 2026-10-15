import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../app';
import { UPLOAD_ROOT, resolveStoredFile } from '../middleware/upload';
import {
  Api,
  createClientWithPortalUser,
  createUser,
  resetDatabase,
  seedCatalogue,
  signIn,
} from './helpers';
import { prisma } from '../config/prisma';
import type { TestUser } from './helpers';

let app: Express;

let uploader: Api;
let staff: TestUser;
let noPermApi: Api;
let pngId: string;

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF', 'utf8');

function pngFile(name = 'pixel.png') {
  return { field: 'file', buffer: PNG_BYTES, filename: name, contentType: 'image/png' };
}

function pdfFile(name = 'document.pdf') {
  return { field: 'file', buffer: PDF_BYTES, filename: name, contentType: 'application/pdf' };
}

beforeAll(async () => {
  app = createApp();
  await resetDatabase();
  await seedCatalogue();

  staff = await createUser({ permissions: ['attachments.upload', 'attachments.view'] });
  uploader = await signIn(app, staff);

  const noPerm = await createUser({ permissions: ['clients.view'] });
  noPermApi = await signIn(app, noPerm);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('attachments - upload authorization', () => {
  it('requires authentication (401)', async () => {
    const res = await new Api(app).upload('/attachments', [pngFile()]);
    expect(res.status).toBe(401);
  });

  it('requires the attachments.upload permission (403)', async () => {
    const res = await noPermApi.upload('/attachments', [pngFile('denied.png')]);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

describe('attachments - accepted uploads', () => {
  it('accepts a .png and does not leak the absolute storage path', async () => {
    const res = await uploader.upload('/attachments', [pngFile()], { category: 'DOCUMENT' });
    expect(res.status).toBe(201);
    expect(res.body.data.originalName).toBe('pixel.png');

    const raw = JSON.stringify(res.body);
    expect(raw.includes(UPLOAD_ROOT)).toBe(false);
    expect(path.isAbsolute(String(res.body.data.storageKey))).toBe(false);

    pngId = res.body.data.id as string;
  });

  it('accepts a .pdf', async () => {
    const res = await uploader.upload('/attachments', [pdfFile()], { category: 'DOCUMENT' });
    expect(res.status).toBe(201);
    expect(res.body.data.originalName).toBe('document.pdf');
    expect(res.body.data.mimeType).toBe('application/pdf');
  });

  it('stores the file under a randomised on-disk name, not the original', async () => {
    expect(process.env.UPLOAD_DIR).toBeDefined();
    const res = await uploader.upload('/attachments', [pngFile('my-unique-original.png')]);
    expect(res.status).toBe(201);

    const storageKey = String(res.body.data.storageKey);
    const absolute = resolveStoredFile(storageKey);
    expect(fs.existsSync(absolute)).toBe(true);

    const base = path.basename(absolute);
    expect(base).not.toBe('my-unique-original.png');
    expect(base).not.toContain('my-unique-original');
    expect(base).toMatch(/^\d+_[0-9a-f]{48}\.png$/);
    // The stored key itself never embeds the original name either.
    expect(storageKey).not.toContain('my-unique-original');
  });
});

describe('attachments - rejected uploads', () => {
  it('rejects executable and SVG files (and a .txt carrying a non-text MIME type)', async () => {
    // The filter blocks by dangerous extension first, then by an allow-list of
    // MIME prefixes. There is no content sniffing, so a "text" extension with a
    // binary/unknown MIME type is rejected via the MIME allow-list.
    const cases: Array<{ filename: string; contentType: string }> = [
      { filename: 'icon.svg', contentType: 'image/svg+xml' },
      { filename: 'virus.exe', contentType: 'application/octet-stream' },
      { filename: 'notes.txt', contentType: 'application/x-msdownload' },
    ];
    for (const file of cases) {
      const res = await uploader.upload('/attachments', [
        { field: 'file', buffer: Buffer.from('MZ'), filename: file.filename, contentType: file.contentType },
      ]);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
    expect(await prisma.attachment.count({ where: { originalName: 'notes.txt' } })).toBe(0);
  });
});

describe('attachments - download authorization', () => {
  it('returns 401 for an unauthenticated download', async () => {
    const res = await new Api(app).get(`/attachments/${pngId}?download=true`);
    expect(res.status).toBe(401);
  });

  it('returns 404 when a portal user downloads an attachment scoped to another client', async () => {
    const other = await createClientWithPortalUser('OtherOwner', ['tickets.view']);
    const ownedByOther = await prisma.attachment.create({
      data: {
        storageKey: `2026/10/secret-${Date.now()}.png`,
        originalName: 'secret.png',
        mimeType: 'image/png',
        size: PNG_BYTES.length,
        category: 'DOCUMENT',
        uploadedById: other.user.id,
        clientId: other.clientId,
        isClientVisible: true,
      },
    });

    const viewer = await createClientWithPortalUser('Viewer', ['tickets.view']);
    const api = await signIn(app, viewer.user);

    const res = await api.get(`/attachments/${ownedByOther.id}?download=true`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('streams the file to an authorized staff viewer', async () => {
    const res = await uploader.get(`/attachments/${pngId}?download=true`);
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('image/png');
    expect(String(res.headers['content-disposition'] ?? '')).toContain('pixel.png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('attachments - path traversal is blocked', () => {
  it('does not serve a file outside the uploads directory', async () => {
    // Plant a real file just outside the uploads root and point a storageKey at it.
    const outside = path.join(UPLOAD_ROOT, '..', 'traversal-secret.txt');
    fs.writeFileSync(outside, 'TRAVERSAL_SECRET_CONTENT');
    try {
      const evil = await prisma.attachment.create({
        data: {
          storageKey: '../traversal-secret.txt',
          originalName: 'evil.txt',
          mimeType: 'text/plain',
          size: 24,
          category: 'DOCUMENT',
          uploadedById: staff.id,
          isClientVisible: false,
        },
      });

      const res = await uploader.get(`/attachments/${evil.id}?download=true`);
      expect([400, 404]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain('TRAVERSAL_SECRET_CONTENT');
    } finally {
      if (fs.existsSync(outside)) fs.unlinkSync(outside);
    }
  });

  it('does not escape via a traversal in the id parameter', async () => {
    const res = await uploader.get(`/attachments/${encodeURIComponent('../../etc/passwd')}`);
    expect([400, 404]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain('root:');
  });
});
