import axios from 'axios';
import readline from 'readline';
import { parseFormFields, findNavigation } from './lib/google-form-snapshot.js';
import {
  checkOllamaReachable,
  getAIAnswersForFields,
  resolveAnswerToAction,
} from './lib/form-ai-ollama.js';

const BASE_URL = 'http://localhost:9377';
const USER_ID = 'default';
const SESSION_KEY = 'smart-form-session';

const argv = process.argv.slice(2);
const AI_MODE = argv.includes('--ai')
  || process.env.AI_MODE === '1'
  || process.env.CAMOFOX_FORM_AI === '1';
const modelFlag = argv.find((a) => a.startsWith('--model='));
const OLLAMA_MODEL = modelFlag?.split('=')[1] || process.env.OLLAMA_MODEL;

const FORM_URL = process.env.FORM_URL
  || 'https://docs.google.com/forms/d/e/1FAIpQLSfX4DlOfqjXLpk4WOXaJEjHnNf9_obXa2qV2zpRQfNKedUriw/viewform?usp=publish-editor';

const MAX_FORM_PAGES = 25;
const SCROLL_PASSES = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}
function pauseForLogin() {
  return ask('\n🔒 PAUSED: Log in visually if needed, then press [ENTER]...');
}

function fieldKey(field) {
  if (field.type === 'radio' || field.type === 'checkbox') {
    return `${field.question}::${field.type}`;
  }
  return `${field.question}::${field.type}::${field.ref}`;
}

function isSuccessScreen(snapshot) {
  return /your response has been recorded|response recorded|submit another response/i.test(snapshot);
}

function hasValidationHints(snapshot) {
  return /required question|this is a required/i.test(snapshot);
}

async function apiGetSnapshot(tabId, offset = 0) {
  const res = await axios.get(`${BASE_URL}/tabs/${tabId}/snapshot`, {
    params: { userId: USER_ID, offset },
  });
  return res.data;
}

/** Best-effort full snapshot when the page exceeds the server window size. */
async function getSnapshotText(tabId) {
  const first = await apiGetSnapshot(tabId, 0);
  if (!first.truncated || !first.hasMore) return first.snapshot;

  const chunks = [first.snapshot.split('\n[... truncated')[0]];
  let offset = first.nextOffset;
  let guard = 0;
  while (offset != null && guard < 40) {
    const part = await apiGetSnapshot(tabId, offset);
    const body = part.snapshot.split('\n[... truncated')[0];
    chunks.push(body);
    if (!part.hasMore) break;
    offset = part.nextOffset;
    guard++;
  }
  return chunks.join('\n');
}

async function dismissAlerts(tabId, snapshot) {
  const dismissBtn = snapshot.match(/button "(Dismiss|Close)" \[(e\d+)\]/i)?.[2];
  if (!dismissBtn) return snapshot;
  await axios.post(`${BASE_URL}/tabs/${tabId}/click`, { userId: USER_ID, ref: dismissBtn });
  await sleep(1500);
  return getSnapshotText(tabId);
}

async function ensureLoggedIn(tabId, snapshot) {
  if (!snapshot.includes('Sign in')) return snapshot;
  console.log('\n🔒 Login required for this form.');
  await pauseForLogin();
  await axios.post(`${BASE_URL}/tabs/${tabId}/refresh`, { userId: USER_ID });
  await sleep(4000);
  return getSnapshotText(tabId);
}

async function scrollPage(tabId) {
  await axios.post(`${BASE_URL}/tabs/${tabId}/scroll`, {
    userId: USER_ID,
    direction: 'down',
    amount: 700,
  });
  await sleep(400);
}

/** Collect fields visible across scroll positions (long single-page forms). */
async function waitForFormFields(tabId, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await getSnapshotText(tabId);
    const fields = parseFormFields(snapshot);
    if (fields.length > 0) return fields;
    await sleep(1500);
  }
  return [];
}

async function collectPageFields(tabId) {
  const byKey = new Map();
  for (let i = 0; i < SCROLL_PASSES; i++) {
    const snapshot = await getSnapshotText(tabId);
    for (const field of parseFormFields(snapshot)) {
      byKey.set(fieldKey(field), field);
    }
    if (i < SCROLL_PASSES - 1) await scrollPage(tabId);
  }
  await axios.post(`${BASE_URL}/tabs/${tabId}/scroll`, {
    userId: USER_ID,
    direction: 'up',
    amount: 4000,
  }).catch(() => {});
  await sleep(300);
  return [...byKey.values()];
}

async function promptForAnswer(field) {
  console.log('\n────────────────────────────────────────');
  console.log(`📋 ${field.question}`);
  console.log(`   Type: ${field.type}`);

  if (field.options?.length) {
    field.options.forEach((opt, i) => {
      console.log(`   ${i + 1}. [${opt.ref}] ${opt.label}`);
    });
    const multi = field.type === 'checkbox';
    const hint = multi
      ? 'Enter option numbers or labels, comma-separated (or "skip"): '
      : 'Enter option number or label (or "skip"): ';
    const raw = (await ask(hint)).trim();
    return resolveAnswerToAction(field, raw);
  }

  const raw = (await ask('Your answer (or "skip"): ')).trim();
  return resolveAnswerToAction(field, raw);
}

async function aiAnswersForPage(fields, answersCache) {
  const missing = fields.filter((f) => !answersCache.has(fieldKey(f)));
  if (!missing.length) return;

  console.log(`\n🧠 AI answering ${missing.length} question(s) on this page...`);
  const answerMap = await getAIAnswersForFields(missing, fieldKey, { model: OLLAMA_MODEL });

  for (const field of missing) {
    const key = fieldKey(field);
    const raw = answerMap.get(key) ?? answerMap.get(field.question);
    let action = resolveAnswerToAction(field, raw);
    if (!action && field.options?.length) {
      action = resolveAnswerToAction(field, '1');
    }
    if (!action && field.ref) {
      action = resolveAnswerToAction(field, 'See response');
    }
    answersCache.set(key, action);
    console.log(`   🤖 ${field.question} → ${raw ?? '(fallback)'}`);
  }
}

async function applyAnswer(tabId, action) {
  if (!action) return;
  if (action.kind === 'type') {
    await axios.post(`${BASE_URL}/tabs/${tabId}/type`, {
      userId: USER_ID,
      ref: action.ref,
      text: action.text,
      pressEnter: false,
    });
    await sleep(500);
    return;
  }
  if (action.kind === 'click') {
    await axios.post(`${BASE_URL}/tabs/${tabId}/click`, { userId: USER_ID, ref: action.ref });
    await sleep(400);
    return;
  }
  if (action.kind === 'multi-click') {
    for (const opt of action.options) {
      await axios.post(`${BASE_URL}/tabs/${tabId}/click`, { userId: USER_ID, ref: opt.ref });
      await sleep(350);
    }
  }
}

async function fillCombobox(tabId, field, answerText) {
  await axios.post(`${BASE_URL}/tabs/${tabId}/click`, { userId: USER_ID, ref: field.ref });
  await sleep(800);
  const snap = await getSnapshotText(tabId);
  const options = [...snap.matchAll(/- (listitem|option|radio|menuitem) "([^"]*)" \[(e\d+)\]/gi)];
  const needle = answerText.toLowerCase();
  const match = options.find((o) => o[2].toLowerCase() === needle || o[2].toLowerCase().includes(needle));
  if (match) {
    await axios.post(`${BASE_URL}/tabs/${tabId}/click`, { userId: USER_ID, ref: match[3] });
    await sleep(400);
    return true;
  }
  await axios.post(`${BASE_URL}/tabs/${tabId}/type`, {
    userId: USER_ID,
    ref: field.ref,
    text: answerText,
    pressEnter: true,
  });
  await sleep(400);
  return true;
}

async function fillPage(tabId, fields, answersCache, { aiMode = false } = {}) {
  if (aiMode) {
    await aiAnswersForPage(fields, answersCache);
  }

  for (const field of fields) {
    const key = fieldKey(field);
    let action;
    if (!answersCache.has(key)) {
      action = await promptForAnswer(field);
      answersCache.set(key, action);
      if ((field.type === 'combobox' || field.type === 'listbox') && action?.kind === 'type') {
        await fillCombobox(tabId, field, action.text);
        continue;
      }
    } else {
      action = answersCache.get(key);
    }
    if (field.type === 'combobox' || field.type === 'listbox') {
      if (action?.kind === 'type') await fillCombobox(tabId, field, action.text);
      else if (action) await applyAnswer(tabId, action);
      continue;
    }
    await applyAnswer(tabId, action);
  }
}

async function clickNav(tabId, ref, label) {
  console.log(`\n🖱️ Clicking ${label} (${ref})...`);
  await axios.post(`${BASE_URL}/tabs/${tabId}/click`, { userId: USER_ID, ref });
  await sleep(2500);
}

async function runSmartAgent() {
  try {
    if (AI_MODE) {
      const ok = await checkOllamaReachable();
      if (!ok) {
        console.error('❌ AI mode requires Ollama running (ollama serve). Start Ollama, then retry with --ai');
        rl.close();
        process.exitCode = 1;
        return;
      }
      console.log('🚀 Smart Form Agent — AI mode (MCQ / exam auto-answer via Ollama)');
      console.log(`   Model: ${OLLAMA_MODEL || 'qwen2.5:3b (default)'}`);
    } else {
      console.log('🚀 Smart Form Agent — manual mode (prompts you for each answer)');
      console.log('   Tip: use --ai for automatic MCQ/exam answers');
    }
    console.log(`   Form: ${FORM_URL}\n`);

    const tabResponse = await axios.post(`${BASE_URL}/tabs`, {
      userId: USER_ID,
      sessionKey: SESSION_KEY,
      url: FORM_URL,
    });
    const tabId = tabResponse.data.tabId;
    console.log(`✅ Tab created: ${tabId}`);
    await sleep(3000);

    let snapshot = await getSnapshotText(tabId);
    snapshot = await dismissAlerts(tabId, snapshot);
    snapshot = await ensureLoggedIn(tabId, snapshot);

    const answersCache = new Map();

    for (let page = 1; page <= MAX_FORM_PAGES; page++) {
      console.log(`\n📄 Scanning form page ${page}...`);
      let fields = await collectPageFields(tabId);
      if (fields.length === 0) {
        console.log('   Waiting for form fields to appear...');
        fields = await waitForFormFields(tabId);
      }
      if (fields.length === 0) {
        const debugSnap = await getSnapshotText(tabId);
        console.error('\n❌ Could not detect any form inputs in the accessibility snapshot.');
        console.error('   Ensure the form URL loads in the browser and you are past any login wall.');
        if (/textbox/i.test(debugSnap)) {
          console.error('   (Textboxes exist in snapshot but parser failed — please report this form.)');
        }
        rl.close();
        process.exitCode = 1;
        return;
      } else {
        console.log(`   Found ${fields.length} question(s) on this screen.`);
        fields.forEach((f) => {
          const extra = f.options ? ` (${f.options.length} choices)` : '';
          console.log(`   • ${f.question}${extra}`);
        });
        await fillPage(tabId, fields, answersCache, { aiMode: AI_MODE });
      }

      snapshot = await getSnapshotText(tabId);
      if (isSuccessScreen(snapshot)) {
        console.log('\n🎉 Form submitted — Google recorded your response.');
        rl.close();
        return;
      }

      const nav = findNavigation(snapshot);
      if (nav.review) {
        await clickNav(tabId, nav.review, 'Review');
        snapshot = await getSnapshotText(tabId);
        if (isSuccessScreen(snapshot)) {
          console.log('\n🎉 Form complete.');
          rl.close();
          return;
        }
      }

      if (nav.next) {
        await clickNav(tabId, nav.next, 'Next');
        snapshot = await getSnapshotText(tabId);
        if (hasValidationHints(snapshot)) {
          console.log('\n⚠️ Google flagged required questions — filling this page again.');
          const retryFields = await collectPageFields(tabId);
          for (const f of retryFields) answersCache.delete(fieldKey(f));
          await fillPage(tabId, retryFields, answersCache, { aiMode: AI_MODE });
          await clickNav(tabId, nav.next, 'Next');
        }
        continue;
      }

      if (nav.submit) {
        if (fields.length === 0) {
          console.log('\n⚠️ Refusing to submit — no fields were filled on this page.');
          break;
        }
        await clickNav(tabId, nav.submit, 'Submit');
        snapshot = await getSnapshotText(tabId);
        if (isSuccessScreen(snapshot)) {
          console.log('\n🎉 Form submitted successfully.');
        } else if (hasValidationHints(snapshot)) {
          console.log('\n⚠️ Submit blocked — required fields missing. Please answer again.');
          const retryFields = await collectPageFields(tabId);
          for (const f of retryFields) answersCache.delete(fieldKey(f));
          await fillPage(tabId, retryFields, answersCache, { aiMode: AI_MODE });
          const nav2 = findNavigation(await getSnapshotText(tabId));
          if (nav2.submit) await clickNav(tabId, nav2.submit, 'Submit');
        } else {
          console.log('\n✅ Submit clicked. Check the browser tab to confirm.');
        }
        rl.close();
        return;
      }

      console.log('\n⚠️ No Next/Submit button found. Stopping (login wall or unsupported layout).');
      break;
    }

    rl.close();
  } catch (error) {
    console.error('❌ Agent failed:', error.response?.data || error.message);
    rl.close();
    process.exitCode = 1;
  }
}

runSmartAgent();
