// Google Forms accessibility snapshots indent lines under the form container.
const INTERACTIVE_LINE =
  /^\s*-\s*(textbox|radio|checkbox|combobox|listbox|spinbutton|slider|switch|searchbox)(?:\s+"([^"]*)")?\s+\[(e\d+)\]/i;
const HEADING_Q =
  /heading\s+"([^"]*)"\s+\[level=3\](?::\s*(.*))?/i;
const TEXTBOX_FALLBACK = /textbox\s+"([^"]*)"\s+\[(e\d+)\]/gi;
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

  for (const line of snapshot.split('\n')) {
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
