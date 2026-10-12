/**
 * Content validation for phone-bridge uploads.
 *
 * The client-supplied filename and MIME type are never trusted: the type is
 * decided from the file's leading bytes, and the filename extension must agree
 * with it. Only formats commonly accepted by application/document upload
 * forms are allowed.
 */

export const ALLOWED_TYPES = {
  'application/pdf': { label: 'PDF', extensions: ['pdf'] },
  'image/jpeg': { label: 'JPEG image', extensions: ['jpg', 'jpeg'] },
  'image/png': { label: 'PNG image', extensions: ['png'] },
  'image/webp': { label: 'WebP image', extensions: ['webp'] },
};

/** Bytes needed by sniffType(). */
export const SNIFF_BYTES = 16;

/**
 * Identify a file from its leading bytes.
 * @param {Buffer} head - at least the first SNIFF_BYTES bytes (fewer for tiny files)
 * @returns {string|null} MIME type from ALLOWED_TYPES, or null if unrecognised
 */
export function sniffType(head) {
  if (!Buffer.isBuffer(head) || head.length < 4) return null;
  // %PDF-
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  // JPEG SOI + marker
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  // PNG signature
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  // RIFF....WEBP
  if (head.length >= 12
    && head.subarray(0, 4).toString('latin1') === 'RIFF'
    && head.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Recognise formats we deliberately reject, to give the user a useful message. */
export function describeRejectedType(head) {
  if (!Buffer.isBuffer(head) || head.length < 12) return null;
  const brand = head.subarray(4, 12).toString('latin1');
  if (/^ftyp(heic|heix|hevc|mif1|msf1)/.test(brand)) return 'HEIC photo';
  return null;
}

export function extensionOf(name) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/**
 * Reduce a client-supplied filename to a safe display/storage name.
 * Strips any directory components, control and reserved characters, and
 * caps the length while keeping the extension. Never returns '' / '.' / '..'.
 */
export function sanitizeFilename(raw, fallbackExt = '') {
  let name = String(raw || '');
  name = name.split(/[\\/]/).pop() || '';
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim();
  name = name.replace(/^\.+/, '');
  if (name.length > 120) {
    const ext = extensionOf(name);
    const stem = name.slice(0, 120 - (ext ? ext.length + 1 : 0));
    name = ext ? `${stem}.${ext}` : stem;
  }
  if (!name || name === '.' || name === '..') {
    name = fallbackExt ? `document.${fallbackExt}` : 'document';
  }
  return name;
}
