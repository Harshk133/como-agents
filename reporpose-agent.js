import axios from "axios";
import fs from "fs"; // Built-in Node.js module for file system operations

const BASE_URL = 'http://localhost:9377';

// Replace this with the YouTube video URL you want to process
const VIDEO_URL = 'https://www.youtube.com/watch?v=sqGoC2FRYfY'; 

async function runRepurposeAgent() {
  try {
    console.log(`🚀 Starting Repurpose Agent for: ${VIDEO_URL}`);

    // 1. Extract Transcript using Camofox's built-in yt-dlp endpoint
    console.log('📥 Extracting transcript via yt-dlp (no API key needed)...');
    const transcriptRes = await axios.post(`${BASE_URL}/youtube/transcript`, {
      url: VIDEO_URL,
      languages: ['en', 'hi'] // Prioritize English, fallback to Hindi if available
    });

    if (transcriptRes.data.status !== 'ok') {
      console.log('❌ Failed to extract transcript. The video might not have captions enabled.');
      return;
    }

    const { video_title, transcript, total_words } = transcriptRes.data;
    console.log(`✅ Success! Extracted ${total_words} words from: "${video_title}"`);

    // 2. Clean up the transcript for better AI processing
    // Removes timestamps like [00:18] and sound cues like [music] or [अप्लॉड]
    const cleanText = transcript
      .replace(/\[\d{2}:\d{2}\]/g, '') // Remove timestamps
      .replace(/\[.*?\]/g, '')         // Remove bracketed sound cues
      .replace(/\s+/g, ' ')            // Collapse multiple spaces into one
      .trim();

    // 3. Save the clean transcript to a text file (Fixes terminal UTF-8 wrapping issues)
    const transcriptFileName = 'transcript.txt';
    fs.writeFileSync(transcriptFileName, cleanText, 'utf8');
    console.log(`\n✅ Saved clean transcript to '${transcriptFileName}'!`);
    console.log('   👉 Open this file in Notepad, VS Code, or Word to read it neatly.');

    // 4. Generate and save the AI Prompt
    const promptText = `You are an expert content creator and strategist. 

Here is the transcript of a YouTube video (it may contain a mix of Hindi and English):
"${cleanText}"

Based on this transcript, please generate the following in English:
1. A 5-tweet Twitter/X thread summarizing the core value and key takeaways.
2. A 30-second TikTok/YouTube Shorts script with a strong, viral hook.
3. 3 potential click-worthy YouTube titles for a video on this topic.

Format the output clearly with headings.`;

    const promptFileName = 'ai-prompt.txt';
    fs.writeFileSync(promptFileName, promptText, 'utf8');
    console.log(`✅ Saved AI prompt to '${promptFileName}'!`);
    console.log('   👉 You can now copy the contents of this file and paste it into ChatGPT, Claude, or your preferred AI tool.\n');

    console.log('🎉 Agent finished successfully!');

  } catch (error) {
    console.error('❌ Agent failed:', error.response?.data || error.message);
  }
}

// Run the agent
runRepurposeAgent();