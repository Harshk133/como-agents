// Google Forms accessibility snapshots indent lines under the form container.
const INTERACTIVE_LINE =
  /^\s*-\s*(textbox|radio|checkbox|combobox|listbox|spinbutton|slider|switch|searchbox)(?:\s+"([^"]*)")?\s+\[(e\d+)\]/i;
const HEADING_Q =
  /heading\s+"([^"]*)"\s+\[level=3\](?::\s*(.*))?/i;
// File-upload questions render an "Add file" button that opens Google's picker.
// On live Google Forms the button is named after the question ("<label>: Required
// question"), so Playwright quotes the YAML key and no ref is attached; "Add file"
// only shows up as a child text line. Accept either shape.
const BUTTON_LINE = /^(\s*)-\s+'?button(?:\s+"([^"]*)")?(?:\s+\[(e\d+)\])?/i;
const FILE_LABEL = /^(?:add|upload)\s+files?$/i;
const CHILD_FILE_TEXT = /^\s*-\s+text:\s*(?:add|upload)\s+files?\s*$/i;

function fileButtonAt(lines, i) {
  const m = lines[i].match(BUTTON_LINE);
  if (!m) return null;
  const [, indent, name, ref] = m;
  if (name && FILE_LABEL.test(name.trim())) return { ref: ref || null };
  for (let j = i + 1; j < lines.length; j++) {
    const childIndent = lines[j].match(/^(\s*)/)[1].length;
    if (childIndent <= indent.length) break;
    if (CHILD_FILE_TEXT.test(lines[j])) return { ref: ref || null };
  }
  return null;
}
const TEXTBOX_FALLBACK =/textbox\s+"([^"]*)"\s+\[(e\d+)\]/gi;
const RADIO_FALLBACK = /^\s*-\s*radio\s+"([^"]*)"\s+\[(e\d+)\]/gim;

export function normalizeQuestionLabel(raw) {
  return (raw || '')
    .replace(/Required question/gi, '')
    .replace(/\*+/g, '')
    .trim();
}

function questionFromAriaName(name) {
  const n = normalizeQuestionLabel(name);
  return n || 'Form field';
}

export function parseFormFields(snapshot) {
  const fields = [];
  let currentQuestion = 'Form field';
  let openChoice = null;
  let fileIndex = 0;

  const lines = snapshot.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fb = fileButtonAt(lines, i);
    if (fb) {
      // fileIndex = position among the page's "Add file" buttons (DOM order),
      // which is how the phone bridge locates this question's button.
      fields.push({ question: currentQuestion, type: 'file', ref: fb.ref, fileIndex, options: null });
      fileIndex++;
      openChoice = null;
      continue;
    }

    const hq = line.match(HEADING_Q);
    if (hq) {
      const fromColon = normalizeQuestionLabel(hq[2]);
      const fromHeadingName = questionFromAriaName(hq[1]);
      currentQuestion = fromColon || fromHeadingName;
      openChoice = null;
      continue;
    }

    const m = line.match(INTERACTIVE_LINE);
    if (!m) continue;

    const role = m[1].toLowerCase();
    const label = (m[2] || '').trim();
    const ref = m[3];

    if (role === 'radio' || role === 'checkbox') {
      if (!openChoice || openChoice.question !== currentQuestion || openChoice.type !== role) {
        openChoice = { question: currentQuestion, type: role, options: [] };
        fields.push(openChoice);
      }
      openChoice.options.push({ label: label || ref, ref });
      continue;
    }

    openChoice = null;
    const question = label ? questionFromAriaName(label) : currentQuestion;
    fields.push({
      question,
      type: role,
      ref,
      options: null,
    });
  }

  if (fields.length > 0) return fields;

  for (const [, name, ref] of snapshot.matchAll(TEXTBOX_FALLBACK)) {
    fields.push({
      question: questionFromAriaName(name),
      type: 'textbox',
      ref,
      options: null,
    });
  }

  const radios = [...snapshot.matchAll(RADIO_FALLBACK)];
  if (radios.length) {
    fields.push({
      question: currentQuestion !== 'Form field' ? currentQuestion : 'Select an option',
      type: 'radio',
      options: radios.map(([, label, ref]) => ({ label, ref })),
    });
  }

  return fields;
}

export function findNavigation(snapshot) {
  const nav = { next: null, submit: null, review: null };
  const navRe = /button\s+"(Next|Submit|Review)"\s+\[(e\d+)\]/gi;
  for (const m of snapshot.matchAll(navRe)) {
    nav[m[1].toLowerCase()] = m[2];
  }
  return nav;
}
