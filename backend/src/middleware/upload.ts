import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export const UPLOAD_ROOT = path.resolve(process.cwd(), env.uploadDir);

// Files are stored OUTSIDE the public web root with randomised names so they can
// never be guessed or served directly. Access is always through an
// authenticated download endpoint.
if (!fs.existsSync(UPLOAD_ROOT)) {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.com', '.cpl', '.scr', '.msi', '.msp', '.jar',
  '.sh', '.bash', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.hta', '.php', '.php3', '.php4', '.php5', '.phtml', '.asp', '.aspx', '.jsp',
  '.py', '.rb', '.pl', '.cgi', '.htaccess', '.svg',
]);

const ALLOWED_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'text/',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument',
  'application/json',
  'application/octet-stream', // needed for some archives/source bundles; extension blocklist still applies
];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const now = new Date();
    const subDir = path.join(
      UPLOAD_ROOT,
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
    );
    fs.mkdir(subDir, { recursive: true }, (err) => cb(err, subDir));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const random = crypto.randomBytes(24).toString('hex');
    cb(null, `${Date.now()}_${random}${ext.slice(0, 12)}`);
  },
});

export const upload = multer({
  storage,
  limits: {
    fileSize: env.maxFileSizeMb * 1024 * 1024,
    files: 10,
    fields: 40,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return cb(new AppError(`File type ${ext || '(none)'} is not permitted for security reasons.`, 400));
    }
    if (!ALLOWED_MIME_PREFIXES.some((prefix) => file.mimetype.startsWith(prefix))) {
      return cb(new AppError(`Unsupported file type: ${file.mimetype}`, 400));
    }
    return cb(null, true);
  },
});

/** Safely resolves a stored file path, preventing path traversal. */
export function resolveStoredFile(relativeKey: string): string {
  // storageKey is stored as <year>/<month>/<filename>
  const normalized = path.normalize(relativeKey).replace(/^([/\\])+/, '');
  const full = path.resolve(UPLOAD_ROOT, normalized);
  if (full !== UPLOAD_ROOT && !full.startsWith(UPLOAD_ROOT + path.sep)) {
    throw new AppError('Invalid file path', 400);
  }
  return full;
}

export function storageKeyFromAbsolute(absolutePath: string): string {
  return path.relative(UPLOAD_ROOT, absolutePath).split(path.sep).join('/');
}
