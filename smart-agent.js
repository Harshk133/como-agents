import axios from 'axios';
import readline from 'readline';
import { parseFormFields, findNavigation } from './lib/google-form-snapshot.js';
import {
  checkOllamaReachable,
  getAIAnswersForFields,
  resolveAnswerToAction,
} from './lib/form-ai-ollama.js';

// Change this line in smart-agent.js:
const BASE_URL = `http://localhost:${process.env.PORT || 9377}`;
const USER_ID = 'default';
const SESSION_KEY = 'smart-form-session';

const argv = process.argv.slice(2);
const DASHBOARD_MODE = process.env.DASHBOARD_MODE === '1';
const AI_MODE = argv.includes('--ai')
  || process.env.AI_MODE === '1'
  || process.env.CAMOFOX_FORM_AI === '1';
const modelFlag = argv.find((a) => a.startsWith('--model='));
const OLLAMA_MODEL = modelFlag?.split('=')[1] || process.env.OLLAMA_MODEL;

const urlFlagIdx = argv.indexOf('--url');
const FORM_URL =
  (urlFlagIdx >= 0 && argv[urlFlagIdx + 1]) ||
  process.env.FORM_URL ||
  process.env.NEXT_PUBLIC_FORM_URL ||
  'https://docs.google.com/forms/d/e/1FAIpQLSc63YdVXFb93gM2v_OwEv5Dw9bFxfhi6NTIeKPQl5reT3NIhA/viewform?usp=publish-editor';

// Camofox routes such as /phone-bridge/sessions require the API key outside
// local development; send it when the environment provides one.
const CAMOFOX_KEY = process.env.CAMOFOX_API_KEY || process.env.CAMOFOX_ACCESS_KEY || '';
if (CAMOFOX_KEY) axios.defaults.headers.common.Authorization = `Bearer ${CAMOFOX_KEY}`;

const PHONE_POLL_MS = 1500;
const PHONE_QR_ATTEMPTS = 3;

const MAX_FORM_PAGES = 25;
const SCROLL_PASSES = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function dashLog(message) {
  if (DASHBOARD_MODE) console.log(`@@LOG@@${message}`);
  else console.log(message);
}

function dashDone() {
  if (DASHBOARD_MODE) console.log('@@DONE@@');
}

function dashError(message) {
  if (DASHBOARD_MODE) console.log(`@@ERROR@@${message}`);
  else console.error(message);
}

/** Read one line of input. With a signal, resolves null if aborted first. */
function ask(prompt, { signal } = {}) {
  const query = DASHBOARD_MODE ? '' : prompt;
  return new Promise((resolve) => {
    if (!signal) return rl.question(query, resolve);
    if (signal.aborted) return resolve(null);
    signal.addEventListener('abort', () => resolve(null), { once: true });
    rl.question(query, { signal }, resolve);
  });
}

async function dashPrompt(payload, { signal } = {}) {
  console.log(`@@PROMPT@@${JSON.stringify(payload)}`);
  const answer = await ask('', { signal });
  return answer == null ? null : answer.trim();
}

/** Tell the dashboard the open prompt was answered by something other than chat. */
function dashResolved(answer) {
  if (DASHBOARD_MODE) console.log(`@@RESOLVED@@${JSON.stringify({ answer })}`);
}

function pauseForLogin() {
  if (DASHBOARD_MODE) {
    return dashPrompt({
      kind: 'login',
      question:
        'Google sign-in required. Use the live browser (right panel) to log in, then click Continue.',
    });
  }
  return ask('\n🔒 PAUSED: Log in visually if needed, then press [ENTER]...');
}

function fieldKey(field) {
  if (field.type === 'radio' || field.type === 'checkbox') {
    return `${field.question}::${field.type}`;
  }
  if (field.type === 'file') return `${field.question}::file::${field.fileIndex}`;
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
  if (DASHBOARD_MODE) {
    const multi = field.type === 'checkbox';
    const hint = field.options?.length
      ? multi
        ? 'Option numbers or labels, comma-separated (or "skip")'
        : 'Option number or label (or "skip")'
      : 'Your answer (or "skip")';
    const raw = await dashPrompt({
      kind: 'field',
      ref: field.ref,
      question: field.question,
      fieldType: field.type,
      options: field.options?.map((opt, i) => ({
        index: i + 1,
        label: opt.label,
        ref: opt.ref,
      })),
      hint,
    });
    return resolveAnswerToAction(field, raw);
  }

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

// ---------------------------------------------------------------------------
// File-upload questions: QR code -> phone upload page -> attach in the browser
// (plugins/phone-bridge on the Camofox server).
// ---------------------------------------------------------------------------

function apiError(err) {
  return err.response?.data?.error || err.message;
}

/** Poll the pairing until the phone has sent a file, the pairing ends, or we are aborted. */
async function waitForPhoneFile(pairing, signal) {
  const url = `${BASE_URL}/phone-bridge/sessions/${pairing.sessionId}`;
  const headers = { 'X-Phone-Bridge-Token': pairing.desktopToken };
  let announcedPair = false;
  let announcedUpload = false;
  while (!signal.aborted) {
    let state;
    try {
      state = (await axios.get(url, { headers })).data;
    } catch (err) {
      if (err.response?.status === 404) return { ended: 'expired' };
      await sleep(PHONE_POLL_MS);
      continue;
    }
    if (state.status === 'expired' || state.status === 'revoked') return { ended: state.status, paired: announcedPair };
    if (state.status === 'paired' && !announcedPair) {
      announcedPair = true;
      dashLog('📱 Phone connected — choose the file on your phone and tap Send.');
    }
    if (state.uploadsInProgress > 0 && !announcedUpload) {
      announcedUpload = true;
      dashLog('⬆️ Receiving file from phone…');
    }
    const file = state.files?.find((f) => f.status === 'received');
    if (file && !state.uploadsInProgress) return { file };
    await sleep(PHONE_POLL_MS);
  }
  return { aborted: true };
}

async function endPairing(pairing) {
  await axios.delete(`${BASE_URL}/phone-bridge/sessions/${pairing.sessionId}`, {
    headers: { 'X-Phone-Bridge-Token': pairing.desktopToken },
  }).catch(() => {});
}

/**
 * Show a QR code for this question, wait for the user's phone to send a file
 * (or for "skip" in chat), then attach it through the question's "Add file" picker.
 */
async function phoneUploadForField(tabId, field) {
  for (let attempt = 1; attempt <= PHONE_QR_ATTEMPTS; attempt++) {
    let pairing;
    try {
      pairing = (await axios.post(`${BASE_URL}/phone-bridge/sessions`, {
        userId: USER_ID,
        maxFiles: 1,
        purpose: field.question,
      })).data;
    } catch (err) {
      dashError(`Could not start the phone upload for "${field.question}": ${apiError(err)}. Attach it in the live browser instead.`);
      return { kind: 'file-skipped' };
    }

    const abort = new AbortController();
    const payload = {
      kind: 'file-upload',
      question: field.question,
      fieldType: 'file upload',
      pairUrl: pairing.pairUrl,
      code: pairing.code,
      pairingExpiresAt: pairing.pairingExpiresAt,
      hint: 'Scan the QR code with your phone, or type "skip"',
    };
    const chat = DASHBOARD_MODE
      ? dashPrompt(payload, { signal: abort.signal })
      : (console.log(`\n📎 ${field.question}\n   Open on your phone: ${pairing.pairUrl}\n   (code ${pairing.code})`),
        ask('Waiting for your phone… type "skip" to skip: ', { signal: abort.signal }));
    const result = await Promise.race([
      chat.then((answer) => ({ answer })),
      waitForPhoneFile(pairing, abort.signal),
    ]);
    abort.abort();

    if (result.answer != null) {
      await endPairing(pairing);
      dashLog(`⏭️ Skipped file upload: ${field.question}`);
      return { kind: 'file-skipped' };
    }

    if (result.ended) {
      await endPairing(pairing);
      if (result.ended === 'expired' && !result.paired && attempt < PHONE_QR_ATTEMPTS) {
        dashResolved('QR code expired');
        dashLog('⌛ QR code expired — showing a new one.');
        continue;
      }
      dashResolved('No file received');
      dashError(`No file received for "${field.question}". Attach it in the live browser if it is required.`);
      return { kind: 'file-skipped' };
    }

    const { file } = result;
    dashLog(`📥 Received "${file.name}" — attaching it to the form…`);
    try {
      const res = await axios.post(
        `${BASE_URL}/phone-bridge/sessions/${pairing.sessionId}/files/${file.id}/attach`,
        { tabId, pickerIndex: field.fileIndex ?? 0 },
        { headers: { 'X-Phone-Bridge-Token': pairing.desktopToken }, timeout: 150000 },
      );
      dashResolved(`📎 ${file.name}`);
      dashLog(`✅ Attached "${file.name}" (${res.data.via}). Check it in the live browser.`);
      await endPairing(pairing);
      return { kind: 'file-attached', name: file.name };
    } catch (err) {
      dashResolved(`⚠️ ${file.name} not attached`);
      dashError(`Could not attach "${file.name}": ${apiError(err)}`);
      await endPairing(pairing);
      return { kind: 'file-failed' };
    }
  }
  return { kind: 'file-skipped' };
}

async function aiAnswersForPage(fields, answersCache) {
  const missing = fields.filter((f) => f.type !== 'file' && !answersCache.has(fieldKey(f)));
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
    if (field.type === 'file') {
      if (!answersCache.has(key)) answersCache.set(key, await phoneUploadForField(tabId, field));
      continue;
    }
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
        const msg =
          'AI mode requires Ollama running (ollama serve). Start Ollama, then retry.';
        dashError(msg);
        rl.close();
        process.exitCode = 1;
        return;
      }
      dashLog('🚀 Smart Form Agent — AI mode (autonomous answers via Ollama)');
      dashLog(`   Model: ${OLLAMA_MODEL || 'qwen2.5:3b (default)'}`);
    } else {
      dashLog('🚀 Smart Form Agent — guided mode (you provide each answer in the dashboard)');
      if (!DASHBOARD_MODE) dashLog('   Tip: use --ai for automatic MCQ/exam answers');
    }
    dashLog(`   Form: ${FORM_URL}`);

    const tabResponse = await axios.post(`${BASE_URL}/tabs`, {
      userId: USER_ID,
      sessionKey: SESSION_KEY,
      url: FORM_URL,
    });
    const tabId = tabResponse.data.tabId;
    dashLog(`✅ Tab created: ${tabId}`);
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
        dashError(
          'Could not detect form inputs. Open the form in the live browser and complete any login wall.',
        );
        if (/textbox/i.test(debugSnap) && !DASHBOARD_MODE) {
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
        dashLog('🎉 Form submitted — Google recorded your response.');
        rl.close();
        dashDone();
        return;
      }

      const nav = findNavigation(snapshot);
      if (nav.review) {
        await clickNav(tabId, nav.review, 'Review');
        snapshot = await getSnapshotText(tabId);
        if (isSuccessScreen(snapshot)) {
          dashLog('🎉 Form complete.');
          rl.close();
          dashDone();
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
          dashLog('🎉 Form submitted successfully.');
        } else if (hasValidationHints(snapshot)) {
          console.log('\n⚠️ Submit blocked — required fields missing. Please answer again.');
          const retryFields = await collectPageFields(tabId);
          for (const f of retryFields) answersCache.delete(fieldKey(f));
          await fillPage(tabId, retryFields, answersCache, { aiMode: AI_MODE });
          const nav2 = findNavigation(await getSnapshotText(tabId));
          if (nav2.submit) await clickNav(tabId, nav2.submit, 'Submit');
        } else {
          dashLog('✅ Submit clicked. Check the live browser to confirm.');
        }
        rl.close();
        dashDone();
        return;
      }

      console.log('\n⚠️ No Next/Submit button found. Stopping (login wall or unsupported layout).');
      break;
    }

    rl.close();
    dashDone();
  } catch (error) {
    const msg = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;
    dashError(`Agent failed: ${msg}`);
    rl.close();
    process.exitCode = 1;
  }
}

runSmartAgent();
