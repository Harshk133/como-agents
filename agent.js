import axios from 'axios';
import readline from 'readline';
import fs from 'fs';

const BASE_URL = 'http://localhost:9377';
const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdKkOgBDFGqSM9b8xq5F2ayDx-t9vwJbJyVa-5WPXznyX35Wg/viewform';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function pauseForLogin() {
  return new Promise(resolve => {
    rl.question('\n PAUSED: Log in visually, then press [ENTER] here...', resolve);
  });
}

async function runFormAgent() {
  try {
    console.log('🚀 Starting Camofox Agent...');

    const tabResponse = await axios.post(`${BASE_URL}/tabs`, {
      userId: 'default',
      sessionKey: 'main-session', 
      url: FORM_URL
    });
    const tabId = tabResponse.data.tabId;
    console.log(`✅ Tab created: ${tabId}`);

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get initial snapshot
    let snapshotRes = await axios.get(`${BASE_URL}/tabs/${tabId}/snapshot`, { params: { userId: 'default' } });
    let snapshot = snapshotRes.data.snapshot;

    // Dismiss alerts
    const dismissBtn = snapshot.match(/button "(Dismiss|Close)" \[(e\d+)\]/i)?.[2];
    if (dismissBtn) {
      console.log(`⚠️ Dismissing alert...`);
      await axios.post(`${BASE_URL}/tabs/${tabId}/click`, { userId: 'default', ref: dismissBtn });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Check for login wall
    if (snapshot.includes('Sign in')) {
      console.log('\n🔒 DETECTED: Login required!');
      console.log(' Log in via the visual browser, then press [ENTER]...');
      await pauseForLogin();
      
      console.log('🔄 Forcing page refresh...');
      await axios.post(`${BASE_URL}/tabs/${tabId}/refresh`, { userId: 'default' });
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      snapshotRes = await axios.get(`${BASE_URL}/tabs/${tabId}/snapshot`, { params: { userId: 'default' } });
      snapshot = snapshotRes.data.snapshot;
    }

    // CORRECTED REGEX: Match the actual format: textbox "..." [e3]
    // This pattern matches: textbox "any text here" [e123]
    const textboxPattern = /textbox ".*?" \[(e\d+)\]/gi;
    const textboxes = [...snapshot.matchAll(textboxPattern)].map(m => m[1]);

    // Match submit button: button "Submit" [e12]
    const submitPattern = /button "Submit" \[(e\d+)\]/i;
    const submitMatch = snapshot.match(submitPattern);
    const submitBtn = submitMatch ? submitMatch[1] : null;

    console.log(`🔍 Found ${textboxes.length} input fields: ${textboxes.join(', ')}`);
    console.log(`🔍 Submit button found: ${submitBtn ? 'Yes (' + submitBtn + ')' : 'No'}`);

    if (textboxes.length === 0) {
      console.log('\n❌ Still no fields found!');
      rl.close();
      return;
    }

    // Fill the form
    const formData = [
      'John Doe',           // Name (field 1)
      'john@test.com',      // Email (field 2)
      '123 AI Street',      // Address (field 3)
      '555-1234',           // Phone (field 4)
      'Hello!'              // Comments (field 5)
    ];

    console.log('\n⌨️ Filling form fields...');
    for (let i = 0; i < Math.min(textboxes.length, formData.length); i++) {
      const ref = textboxes[i];
      const value = formData[i];
      console.log(`  Field ${i + 1} (${ref}): "${value}"`);
      
      await axios.post(`${BASE_URL}/tabs/${tabId}/type`, {
        userId: 'default', 
        ref: ref, 
        text: value, 
        pressEnter: false
      });
      await new Promise(resolve => setTimeout(resolve, 600));
    }

    // Submit
    if (submitBtn) {
      console.log(`\n🖱️ Clicking Submit button (${submitBtn})...`);
      await axios.post(`${BASE_URL}/tabs/${tabId}/click`, { userId: 'default', ref: submitBtn });
      console.log('🎉 Form submitted successfully!');
    } else {
      console.log('\n️ Submit button not found.');
    }
    
    rl.close();

  } catch (error) {
    console.error('❌ Agent failed:', error.response?.data || error.message);
    rl.close();
  }
}

runFormAgent();