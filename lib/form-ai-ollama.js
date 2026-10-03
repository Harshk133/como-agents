/**
 * Ollama-backed answers for Google Form fields (MCQ / exam-style).
 */

const DEFAULT_OLLAMA_URL = 'http://localhost:11434/api/generate';
const DEFAULT_MODEL = 'qwen2.5:3b';

export function resolveAnswerToAction(field, raw) {
  if (raw == null) return null;
  const answer = String(raw).trim();
  if (!answer || answer.toLowerCase() === 'skip') return null;

  if (field.options?.length) {
    const multi = field.type === 'checkbox';
    if (multi) {
      const parts = answer.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
      const refs = [];
      for (const part of parts) {
        const num = parseInt(part, 10);
        if (!Number.isNaN(num) && num >= 1 && num <= field.options.length) {
          refs.push(field.options[num - 1]);
          continue;
        }
        const match = field.options.find(
          (o) => o.label.toLowerCase() === part.toLowerCase()
            || o.label.toLowerCase().includes(part.toLowerCase()),
        );
        if (match) refs.push(match);
      }
      return refs.length ? { kind: 'multi-click', options: refs } : null;
    }

    const num = parseInt(answer, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= field.options.length) {
      return { kind: 'click', ref: field.options[num - 1].ref };
    }
    const match = field.options.find(
      (o) => o.label.toLowerCase() === answer.toLowerCase()
        || o.label.toLowerCase().includes(answer.toLowerCase()),
    );
    if (match) return { kind: 'click', ref: match.ref };
    return { kind: 'click', ref: field.options[0].ref };
  }

  if (!field.ref) return null;
  return { kind: 'type', ref: field.ref, text: answer };
}

function extractAnswerObjects(obj) {
  if (Array.isArray(obj)) {
    const out = [];
    for (const item of obj) {
      if (item && typeof item === 'object' && (item.id || item.question) && item.answer != null) {
        out.push(item);
      } else if (item && typeof item === 'object') {
        out.push(...extractAnswerObjects(item));
      }
    }
    return out;
  }
  if (obj && typeof obj === 'object') {
    if ((obj.id || obj.question) && obj.answer != null) return [obj];
    return Object.values(obj).flatMap((v) => extractAnswerObjects(v));
  }
  return [];
}

function fieldPayload(field, id) {
  return {
    id,
    question: field.question,
    type: field.type,
    options: field.options?.map((o) => o.label) ?? null,
  };
}

export async function getAIAnswersForFields(fields, idForField, options = {}) {
  const ollamaUrl = options.ollamaUrl || process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL;
  const model = options.model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;

  const items = fields.map((f) => fieldPayload(f, idForField(f)));
  const prompt = `You are taking a multiple-choice or short-answer exam. Answer every question as accurately as you can.

Rules:
- Return ONLY valid JSON (no markdown).
- Format: {"answers":[{"id":"<id>","answer":"<value>"}, ...]}
- For type "radio": answer must be the exact option text OR a 1-based option number as a string (e.g. "2").
- For type "checkbox": answer is comma-separated option texts or numbers (e.g. "1,3").
- For text fields (textbox, combobox, etc.): give a concise correct answer.
- Never leave an answer empty.

Questions:
${JSON.stringify(items, null, 2)}`;

  const response = await fetch(ollamaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0.2 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const clean = (data.response || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error(`Ollama returned non-JSON: ${clean.slice(0, 200)}`);
  }

  const rows = extractAnswerObjects(parsed.answers ?? parsed);
  const map = new Map();
  for (const row of rows) {
    const key = row.id || row.question;
    if (key) map.set(String(key), row.answer);
  }
  return map;
}

export async function checkOllamaReachable(options = {}) {
  const base = (options.ollamaUrl || process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL)
    .replace(/\/api\/generate\/?$/, '');
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}
