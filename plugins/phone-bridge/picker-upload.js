/**
 * Attach a file to a Google Forms file-upload question.
 *
 * A Forms file question has no <input type=file> on the page: its "Add file"
 * button opens Google's picker in an iframe, the file is chosen there (hidden
 * <input type=file>, or a "Browse" button that opens the native chooser),
 * and the picker may need an "Upload" click before it closes. This walks
 * that flow with Playwright, searching every frame, and only reports success
 * once the picker has gone away.
 *
 * The same steps also cover simpler sites whose trigger mounts a file input
 * or opens the native chooser directly.
 */

const TRIGGER_NAME = /^(add|upload) files?$/i;
const TRIGGER_TEXT = /^\s*(add|upload) files?\s*$/i;
const BROWSE_NAME = /^(browse|select files? from your (device|computer)|choose files?)$/i;
const CONFIRM_NAME = /^(upload|insert|select|done)$/i;

const FIND_INPUT_MS = 20000;
const BROWSE_AFTER_MS = 4000;
const POLL_MS = 400;

function fail(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

async function firstFileInput(frame) {
  const input = frame.locator('input[type="file"]').first();
  return (await input.count().catch(() => 0)) > 0 ? input : null;
}

async function frameVisible(page, frame) {
  if (!frame || frame.isDetached()) return false;
  const el = await frame.frameElement().catch(() => null);
  if (!el) return false;
  return el.isVisible().catch(() => false);
}

/**
 * @param {import('playwright-core').Page} page
 * @param {object} opts
 * @param {number} opts.triggerIndex - which "Add file" button on the page (DOM order)
 * @param {string|string[]} opts.files - absolute path(s) inside the uploads dir
 * @param {number} [opts.timeoutMs=90000] - overall budget, incl. Google's own upload
 * @returns {Promise<{via: string}>}
 */
export async function attachThroughPicker(page, { triggerIndex, files, timeoutMs = 90000, log = () => {} }) {
  // Live Google Forms names the button after the question; "Add file" is only its text.
  const trigger = page.getByRole('button', { name: TRIGGER_NAME })
    .or(page.getByRole('button').filter({ hasText: TRIGGER_TEXT }))
    .nth(triggerIndex);
  if ((await trigger.count()) === 0) {
    throw fail(422, 'Could not find this question\'s "Add file" button on the page.');
  }

  let chosen = null; // a FileChooser, if any click opened the native dialog
  const onChooser = (fc) => { chosen = chosen || fc; };
  page.on('filechooser', onChooser);
  try {
    await trigger.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await trigger.click({ timeout: 5000 });

    // 1. Put the file into whichever UI appeared.
    let pickerFrame = null;
    let via = null;
    let browseTried = false;
    const start = Date.now();
    while (!via && Date.now() - start < FIND_INPUT_MS) {
      if (chosen) {
        await chosen.setFiles(files);
        via = 'filechooser';
        break;
      }
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        const input = await firstFileInput(frame);
        if (input) {
          await input.setInputFiles(files, { timeout: 5000 });
          pickerFrame = frame;
          via = 'picker_input';
          break;
        }
      }
      if (via) break;
      const mainInput = await firstFileInput(page.mainFrame());
      if (mainInput) {
        await mainInput.setInputFiles(files, { timeout: 5000 });
        via = 'direct_input';
        break;
      }
      // No input yet: the picker may only expose a "Browse" button.
      if (!browseTried && Date.now() - start > BROWSE_AFTER_MS) {
        browseTried = true;
        for (const frame of page.frames()) {
          const browse = frame.getByRole('button', { name: BROWSE_NAME }).first();
          if ((await browse.count().catch(() => 0)) > 0) {
            if (frame !== page.mainFrame()) pickerFrame = frame;
            await browse.click({ timeout: 4000 }).catch(() => {});
            break;
          }
        }
      }
      await page.waitForTimeout(POLL_MS);
    }
    if (!via) {
      throw fail(422, 'The upload dialog did not offer a way to attach a file. Finish this question in the live browser.');
    }
    log('info', 'phone-bridge: file handed to upload UI', { via });

    // 2. Picker-based UIs: confirm if needed, then wait for the picker to close.
    if (!pickerFrame) {
      // A native chooser can still have come from inside a picker frame.
      for (const frame of page.frames()) {
        if (frame !== page.mainFrame() && await frameVisible(page, frame)
          && (await frame.getByRole('button', { name: CONFIRM_NAME }).count().catch(() => 0)) > 0) {
          pickerFrame = frame;
          break;
        }
      }
    }
    if (!pickerFrame) return { via };

    const deadline = start + timeoutMs;
    let confirmed = false;
    while (Date.now() < deadline) {
      if (!(await frameVisible(page, pickerFrame))) return { via: confirmed ? `${via}+confirm` : via };
      if (!confirmed) {
        const confirm = pickerFrame.getByRole('button', { name: CONFIRM_NAME }).first();
        if ((await confirm.count().catch(() => 0)) > 0
          && await confirm.isVisible().catch(() => false)
          && await confirm.isEnabled().catch(() => false)) {
          await confirm.click({ timeout: 4000 }).catch(() => {});
          confirmed = true;
        }
      }
      await page.waitForTimeout(POLL_MS);
    }
    throw fail(504, 'The upload dialog is still open. Check the live browser and finish the upload there.');
  } finally {
    page.off('filechooser', onChooser);
  }
}
