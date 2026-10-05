import axios from 'axios';
import readline from 'readline';

const BASE_URL = `http://localhost:${process.env.PORT || 9377}`;
const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfX4DlOfqjXLpk4WOXaJEjHnNf9_obXa2qV2zpRQfNKedUriw/viewform?usp=publish-editor';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function waitForInput() {
  return new Promise(resolve => {
    rl.question('', resolve); // Waits silently for backend to pipe an answer
  });
}

async function runInteractiveAgent() {
  try {
    console.log('@@LOG@@🚀 Starting Interactive Form Agent...');

    const tabResponse = await axios.post(`${BASE_URL}/tabs`, {
      userId: 'default',
      sessionKey: 'interactive-session',
      url: FORM_URL
    });
    const tabId = tabResponse.data.tabId;
    console.log(`@@LOG@@✅ Tab created: ${tabId}`);
    await new Promise(resolve => setTimeout(resolve, 3000));

    let snapshotRes = await axios.get(`${BASE_URL}/tabs/${tabId}/snapshot`, { params: { userId: 'default' } });
    let snapshot = snapshotRes.data.snapshot;

    // Dismiss alerts
    const dismissBtn = snapshot.match(/button "(Dismiss|Close)" \[(e\d+)\]/i)?.[2];
    if (dismissBtn) {
      await axios.post(`${BASE_URL}/tabs/${tabId}/click`, { userId: 'default', ref: dismissBtn });
      await new Promise(resolve => setTimeout(resolve, 2000));
      snapshotRes = await axios.get(`${BASE_URL}/tabs/${tabId}/snapshot`, { params: { userId: 'default' } });
      snapshot = snapshotRes.data.snapshot;
    }

    // Extract text-based questions and their refs
    const questionMatches = [...snapshot.matchAll(/heading ".*?" \[level=3\]: (.*?)\n/g)].map(m => m[1].replace('Required question', '').trim());
    const textboxMatches = [...snapshot.matchAll(/textbox ".*?" \[(e\d+)\]/g)].map(m => m[1]);
    
    const formFields = questionMatches.map((question, i) => ({
      question: question,
      ref: textboxMatches[i]
    })).filter(field => field.ref && field.question);

    console.log(`@@LOG@@📋 Found ${formFields.length} text-based questions.`);

    for (const field of formFields) {
      // 1. Send prompt to frontend
      console.log(`@@PROMPT@@${field.ref}|${field.question}`);
      
      // 2. Wait for frontend to send answer via stdin
      const answer = await waitForInput();
      
      // 3. Type the answer
      console.log(`@@LOG@@⌨️ Typing into [${field.ref}]: "${answer}"`);
      await axios.post(`${BASE_URL}/tabs/${tabId}/type`, {
        userId: 'default',
        ref: field.ref,
        text: answer,
        pressEnter: false
      });
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    // Submit
    const submitBtn = snapshot.match(/button "Submit" \[(e\d+)\]/i)?.[1];
    if (submitBtn) {
      console.log(`@@LOG@@🖱️ Clicking Submit button (${submitBtn})...`);
      await axios.post(`${BASE_URL}/tabs/${tabId}/click`, { userId: 'default', ref: submitBtn });
      console.log('@@LOG@@🎉 Form submitted successfully!');
    }

    console.log('@@DONE@@');
    rl.close();
    process.exit(0);

  } catch (error) {
    console.error(`@@ERROR@@${error.message}`);
    rl.close();
    process.exit(1);
  }
}

runInteractiveAgent();