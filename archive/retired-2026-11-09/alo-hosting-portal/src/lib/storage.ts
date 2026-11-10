import { writeFile, mkdir, unlink, stat, access } from 'fs/promises'
import { join, resolve } from 'path'
import { env } from './env'

const UPLOAD_DIR = join(process.cwd(), 'uploads')

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'application/zip', 'text/plain', 'text/csv',
  'application/json', 'video/mp4', 'audio/mpeg',
]

export function validateFile(file: { name: string; size: number; type: string }): { valid: boolean; error?: string } {
  if (!file.name || file.name.length === 0) {
    return { valid: false, error: 'File name is required' }
  }
  const maxSize = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024
  if (file.size > maxSize) {
    return { valid: false, error: `File size exceeds ${env.MAX_UPLOAD_SIZE_MB}MB limit` }
  }
  if (file.size === 0) {
    return { valid: false, error: 'File is empty' }
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { valid: false, error: `File type ${file.type} is not allowed` }
  }
  return { valid: true }
}

/**
 * Sanitize a file key to prevent path traversal attacks.
 * Strips .. , leading /, and null bytes.
 */
function sanitizePath(key: string): string {
  return key
    .replace(/\.\./g, '')     // remove path traversal
    .replace(/\0/g, '')        // remove null bytes
    .replace(/^\//g, '')       // remove leading slashes
    .replace(/\\/g, '/')      // normalize backslashes
}

export async function uploadFile(buffer: Buffer, key: string, _contentType: string): Promise<string> {
  const safeKey = sanitizePath(key)
  if (!safeKey || safeKey.startsWith('..')) {
    throw new Error('Invalid file key: path traversal detected')
  }
  const filePath = join(UPLOAD_DIR, safeKey)
  // Double-check the resolved path stays within UPLOAD_DIR
  const resolved = resolve(filePath)
  const uploadResolved = resolve(UPLOAD_DIR)
  if (!resolved.startsWith(uploadResolved)) {
    throw new Error('Invalid file key: path traversal detected')
  }
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  await mkdir(dir, { recursive: true })
  await writeFile(filePath, buffer)
  const baseUrl = process.env.APP_URL || 'http://localhost:3000'
  return `${baseUrl}/uploads/${safeKey}`
}

export async function deleteFile(key: string): Promise<void> {
  const safeKey = sanitizePath(key)
  const filePath = join(UPLOAD_DIR, safeKey)
  try {
    await access(filePath)
    await unlink(filePath)
  } catch {
    // File may not exist — ignore
  }
}

export function getFileUrl(key: string): string {
  const safeKey = sanitizePath(key)
  const baseUrl = process.env.APP_URL || 'http://localhost:3000'
  return `${baseUrl}/uploads/${safeKey}`
}

/** @deprecated Use getFileUrl instead — this does not actually sign the URL */
export async function getSignedUrl(key: string): Promise<string> {
  return getFileUrl(key)
}
