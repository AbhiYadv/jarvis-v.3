const { GoogleGenAI, Modality } = require('@google/genai');
const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const { saveDebugAudio } = require('../audioUtils');
const { getSystemPrompt } = require('./prompts');
const { getAvailableModel, incrementLimitCount, getApiKey, getGroqApiKey, getClaudeApiKey, getOpenaiApiKey, incrementCharUsage, getModelForToday, getProModel } = require('../storage');
const { connectCloud, sendCloudAudio, sendCloudText, sendCloudImage, closeCloud, isCloudActive, setOnTurnComplete } = require('./cloud');

const TOKEN_CONFIG = {
    max_tokens: 400,
    session_budget: 100000,
};

const OPENAI_TEXT_MODEL = 'gpt-5.1';

let session = { input: 0, output: 0, calls: 0, freshTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, cacheHits: 0 };
let analyzeSession = { input: 0, output: 0, calls: 0, cacheHits: 0, cacheWrites: 0, freshTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

// Lazy-loaded to avoid circular dependency (localai.js imports from gemini.js)
let _localai = null;
function getLocalAi() {
    if (!_localai) _localai = require('./localai');
    return _localai;
}

// Provider mode: 'byok', 'cloud', or 'local'
let currentProviderMode = 'byok';

// Groq conversation history for context
let groqConversationHistory = [];

// Conversation tracking variables
let currentSessionId = null;
let currentTranscription = '';
let conversationHistory = [];
let screenAnalysisHistory = [];
let lastScreenAnalysis = null; // holds only the most recent analyze result
let screenAnalysisTurnsLeft = 0; // injects context only for the next 2 audio turns after analyze
let tseScreenHistory = []; // TSE profile: full conversation history across screen captures (capped 20 turns)
let currentProfile = null;
let currentCustomPrompt = null;
let isInitializingSession = false;
let currentSystemPrompt = null;

// --- Groq Direct Mode ---
// When Groq key is available, bypass Gemini Live entirely
// Audio → VAD → Groq Whisper (~1-2s) → Groq LLM (~3-5s) = ~5-8s total
let useGroqDirect = false;

// VAD (Voice Activity Detection) configuration
const VAD_CONFIG = {
    energyThreshold: 0.008,       // RMS energy threshold for speech detection
    speechFramesRequired: 3,       // Consecutive speech frames to start buffering
    silenceFramesRequired: 8,      // Consecutive silence frames to stop (0.8s at 0.1s/frame)
    maxBufferDuration: 30,         // Max seconds to buffer before force-transcribing
};

let vadState = {
    isSpeaking: false,
    speechBuffer: [],
    silenceFrameCount: 0,
    speechFrameCount: 0,
    isTranscribing: false,
};
let vadPendingTimer = null;       // debounce timer after speech ends
let vadPendingBuffer = null;      // audio captured at speech-end, held during debounce
const VAD_DEBOUNCE_MS = 600;      // wait 0.6s before sending to model

function resetVadState() {
    vadState = {
        isSpeaking: false,
        speechBuffer: [],
        silenceFrameCount: 0,
        speechFrameCount: 0,
        isTranscribing: false,
    };
    if (vadPendingTimer) {
        clearTimeout(vadPendingTimer);
        vadPendingTimer = null;
    }
    vadPendingBuffer = null;
}

function calculateRMSEnergy(pcmBuffer) {
    const samples = pcmBuffer.length / 2;
    let sumSquares = 0;
    for (let i = 0; i < samples; i++) {
        const sample = pcmBuffer.readInt16LE(i * 2) / 32768.0;
        sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / samples);
}

function pcmToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
    const dataLength = pcmBuffer.length;
    const headerLength = 44;
    const wav = Buffer.alloc(headerLength + dataLength);

    // RIFF header
    wav.write('RIFF', 0);
    wav.writeUInt32LE(headerLength + dataLength - 8, 4);
    wav.write('WAVE', 8);

    // fmt chunk
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(channels, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
    wav.writeUInt16LE(channels * bitsPerSample / 8, 32);
    wav.writeUInt16LE(bitsPerSample, 34);

    // data chunk
    wav.write('data', 36);
    wav.writeUInt32LE(dataLength, 40);
    pcmBuffer.copy(wav, 44);

    return wav;
}

function extractTextFromOpenAIContent(content) {
    if (!content) return '';
    if (typeof content === 'string') return content;

    if (Array.isArray(content)) {
        return content.map(part => extractTextFromOpenAIContent(part)).join('');
    }

    if (typeof content === 'object') {
        if (typeof content.text === 'string') return content.text;
        if (typeof content.value === 'string') return content.value;
        if (typeof content.content === 'string') return content.content;
        if (content.content) return extractTextFromOpenAIContent(content.content);
    }

    return '';
}

function extractOpenAIStreamText(json) {
    const choice = json?.choices?.[0];
    if (!choice) return '';

    return extractTextFromOpenAIContent(choice.delta?.content)
        || extractTextFromOpenAIContent(choice.message?.content)
        || extractTextFromOpenAIContent(choice.text);
}

function getOpenAICompletionBudget(profile = currentProfile) {
    if (profile === 'tse') return 3000;
    if (profile === 'interview') return 800;
    return TOKEN_CONFIG.max_tokens;
}

function estimateTokenCount(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

function decodeHtmlEntities(text) {
    if (!text) return '';
    return text
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#x2F;/g, '/');
}

function stripHtmlTags(text) {
    return decodeHtmlEntities(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function shouldUseWebSearch(query) {
    if (!query) return false;
    const q = query.toLowerCase();
    return /(latest|recent|today|current|new|release|version|news|incident|outage|cve|error code|known issue|compare|pricing|regulation|changelog)/.test(q);
}

async function fetchWebSearchContext(query) {
    try {
        const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
            },
        });
        if (!response.ok) {
            console.log('Web search request failed:', response.status);
            return '';
        }

        const html = await response.text();
        const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[\s\S]*?>([\s\S]*?)<\/a>/g;
        const results = [];
        let match;

        while ((match = resultRegex.exec(html)) !== null && results.length < 3) {
            const duckUrl = decodeHtmlEntities(match[1]);
            const title = stripHtmlTags(match[2]);
            const snippet = stripHtmlTags(match[3]);
            let finalUrl = duckUrl;
            const uddgMatch = duckUrl.match(/[?&]uddg=([^&]+)/);
            if (uddgMatch) {
                finalUrl = decodeURIComponent(uddgMatch[1]);
            } else if (duckUrl.startsWith('//')) {
                finalUrl = `https:${duckUrl}`;
            }

            try {
                const host = new URL(finalUrl).hostname.replace(/^www\./, '');
                results.push(`- ${title} (${host}): ${snippet}`);
            } catch {
                results.push(`- ${title}: ${snippet}`);
            }
        }

        return results.length ? `Web search results:\n${results.join('\n')}` : '';
    } catch (error) {
        console.error('Error fetching web search context:', error.message);
        return '';
    }
}

async function maybeAugmentWithWebSearch(transcription) {
    const googleSearchEnabled = await getStoredSetting('googleSearchEnabled', 'true');
    if (googleSearchEnabled !== 'true') return transcription;
    if (!shouldUseWebSearch(transcription)) return transcription;

    const searchContext = await fetchWebSearchContext(transcription);
    if (!searchContext) return transcription;

    console.log('Added shared web search context for non-Gemini model');
    return `${transcription.trim()}\n\n${searchContext}\n\nUse these search results when relevant and mention the source domain briefly for searched facts.`;
}

async function transcribeWithGroqWhisper(pcmBuffer, language = 'en') {
    const groqApiKey = getGroqApiKey();
    if (!groqApiKey) return null;

    const wavBuffer = pcmToWav(pcmBuffer);

    // Build multipart form data manually (no external deps needed)
    const boundary = '----FormBoundary' + Date.now() + Math.random().toString(36).substr(2);
    const CRLF = '\r\n';

    const preamble = `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="audio.wav"${CRLF}Content-Type: audio/wav${CRLF}${CRLF}`;

    const postFile = [
        `${CRLF}--${boundary}${CRLF}`,
        `Content-Disposition: form-data; name="model"${CRLF}${CRLF}`,
        `whisper-large-v3-turbo${CRLF}`,
        `--${boundary}${CRLF}`,
        `Content-Disposition: form-data; name="language"${CRLF}${CRLF}`,
        `${language}${CRLF}`,
        `--${boundary}${CRLF}`,
        `Content-Disposition: form-data; name="response_format"${CRLF}${CRLF}`,
        `json${CRLF}`,
        `--${boundary}--${CRLF}`,
    ].join('');

    const body = Buffer.concat([
        Buffer.from(preamble),
        wavBuffer,
        Buffer.from(postFile),
    ]);

    try {
        const startTime = Date.now();
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqApiKey}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
            },
            body: body,
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('Whisper API error:', response.status, errText);
            return null;
        }

        const result = await response.json();
        console.log(`Whisper transcription (${Date.now() - startTime}ms):`, result.text);
        return result.text || null;
    } catch (error) {
        console.error('Whisper transcription error:', error);
        return null;
    }
}

async function processAudioWithVAD(monoChunk) {
    if (vadState.isTranscribing) {
        // Still processing previous speech, keep buffering if speaking
        if (vadState.isSpeaking) {
            vadState.speechBuffer.push(monoChunk);
        }
        return;
    }

    const energy = calculateRMSEnergy(monoChunk);

    if (energy > VAD_CONFIG.energyThreshold) {
        // Speech detected
        vadState.silenceFrameCount = 0;
        vadState.speechFrameCount++;

        if (!vadState.isSpeaking && vadState.speechFrameCount >= VAD_CONFIG.speechFramesRequired) {
            vadState.isSpeaking = true;
            sendToRenderer('update-status', 'Hearing speech...');
            console.log('VAD: Speech started');
            // Cancel debounce — user is still speaking
            if (vadPendingTimer) {
                clearTimeout(vadPendingTimer);
                vadPendingTimer = null;
            }
        }

        if (vadState.isSpeaking) {
            vadState.speechBuffer.push(monoChunk);
        }
    } else {
        // Silence
        vadState.speechFrameCount = 0;

        if (vadState.isSpeaking) {
            vadState.speechBuffer.push(monoChunk);
            vadState.silenceFrameCount++;

            if (vadState.silenceFrameCount >= VAD_CONFIG.silenceFramesRequired) {
                // Speech ended — start debounce timer before transcribing
                console.log('VAD: Speech ended, buffered', vadState.speechBuffer.length, 'chunks');
                const audioBuffer = Buffer.concat(vadState.speechBuffer);

                vadState.isSpeaking = false;
                vadState.speechBuffer = [];
                vadState.silenceFrameCount = 0;

                // Merge with any previous pending buffer (user paused mid-sentence)
                vadPendingBuffer = vadPendingBuffer
                    ? Buffer.concat([vadPendingBuffer, audioBuffer])
                    : audioBuffer;

                // Cancel existing timer — reset the 4.5s window
                if (vadPendingTimer) clearTimeout(vadPendingTimer);

                sendToRenderer('update-status', 'Waiting...');
                vadPendingTimer = setTimeout(async () => {
                    vadPendingTimer = null;
                    const pendingAudio = vadPendingBuffer;
                    vadPendingBuffer = null;

                    vadState.isTranscribing = true;
                    sendToRenderer('update-status', 'Transcribing...');
                    const langCode = (sessionParams?.language || 'en-US').split('-')[0];

                    try {
                        const transcription = await transcribeWithGroqWhisper(pendingAudio, langCode);

                        if (transcription && passesConfidenceFilter(transcription)) {
                            sendToRenderer('update-status', 'Generating response...');
                            if (hasGptKey()) {
                                await sendToGPT(transcription.trim());
                            } else if (hasClaudeKey()) {
                                await sendToClaude(transcription.trim());
                            } else {
                                await sendToGroq(transcription.trim());
                            }
                        } else {
                            sendToRenderer('update-status', 'Listening...');
                        }
                    } catch (error) {
                        console.error('VAD pipeline error:', error);
                        sendToRenderer('update-status', 'Error: ' + error.message);
                    } finally {
                        vadState.isTranscribing = false;
                        sendToRenderer('update-status', 'Listening...');
                    }
                }, VAD_DEBOUNCE_MS);
            }
        }
    }

    // Force transcribe if buffer exceeds max duration
    const maxChunks = VAD_CONFIG.maxBufferDuration / 0.1;
    if (vadState.speechBuffer.length >= maxChunks) {
        console.log('VAD: Max buffer reached, force transcribing');
        const audioBuffer = Buffer.concat(vadState.speechBuffer);

        vadState.isSpeaking = false;
        vadState.speechBuffer = [];
        vadState.silenceFrameCount = 0;
        vadState.isTranscribing = true;

        sendToRenderer('update-status', 'Transcribing...');
        const langCode = (sessionParams?.language || 'en-US').split('-')[0];

        try {
            const transcription = await transcribeWithGroqWhisper(audioBuffer, langCode);
            if (transcription && passesConfidenceFilter(transcription)) {
                sendToRenderer('update-status', 'Generating response...');
                if (hasGptKey()) {
                    await sendToGPT(transcription.trim());
                } else if (hasClaudeKey()) {
                    await sendToClaude(transcription.trim());
                } else {
                    await sendToGroq(transcription.trim());
                }
            }
        } catch (error) {
            console.error('VAD pipeline error:', error);
        } finally {
            vadState.isTranscribing = false;
            sendToRenderer('update-status', 'Listening...');
        }
    }
}

function formatSpeakerResults(results) {
    let text = '';
    for (const result of results) {
        if (result.transcript && result.speakerId) {
            const speakerLabel = result.speakerId === 1 ? 'Interviewer' : 'Candidate';
            text += `[${speakerLabel}]: ${result.transcript}\n`;
        }
    }
    return text;
}

module.exports.formatSpeakerResults = formatSpeakerResults;

// Audio capture variables
let systemAudioProc = null;
let messageBuffer = '';

// Debounce timer for input transcription (Gemini fallback path)
// Instead of waiting for generationComplete (25+ seconds), fire after silence
let transcriptionDebounceTimer = null;
const TRANSCRIPTION_DEBOUNCE_MS = 800;


// Reconnection variables
let isUserClosing = false;
let sessionParams = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY = 2000;

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

// Build context message for session restoration
function buildContextMessage() {
    const lastTurns = conversationHistory.slice(-20);
    const validTurns = lastTurns.filter(turn => turn.transcription?.trim() && turn.ai_response?.trim());

    if (validTurns.length === 0) return null;

    const contextLines = validTurns.map(turn =>
        `[Interviewer]: ${turn.transcription.trim()}\n[Your answer]: ${turn.ai_response.trim()}`
    );

    return `Session reconnected. Here's the conversation so far:\n\n${contextLines.join('\n\n')}\n\nContinue from here.`;
}

// Conversation management functions
function initializeNewSession(profile = null, customPrompt = null) {
    currentSessionId = Date.now().toString();
    currentTranscription = '';
    conversationHistory = [];
    screenAnalysisHistory = [];
    lastScreenAnalysis = null;
    screenAnalysisTurnsLeft = 0;
    tseScreenHistory = [];
    groqConversationHistory = [];
    currentProfile = profile;
    currentCustomPrompt = customPrompt;
    console.log('New conversation session started:', currentSessionId, 'profile:', profile);

    // Save initial session with profile context
    if (profile) {
        sendToRenderer('save-session-context', {
            sessionId: currentSessionId,
            profile: profile,
            customPrompt: customPrompt || ''
        });
    }
}

function saveConversationTurn(transcription, aiResponse) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const conversationTurn = {
        timestamp: Date.now(),
        transcription: transcription.trim(),
        ai_response: aiResponse.trim(),
    };

    conversationHistory.push(conversationTurn);
    console.log('Saved conversation turn:', conversationTurn);

    // Send to renderer to save in IndexedDB
    sendToRenderer('save-conversation-turn', {
        sessionId: currentSessionId,
        turn: conversationTurn,
        fullHistory: conversationHistory,
    });
}

function saveScreenAnalysis(prompt, response, model) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const analysisEntry = {
        timestamp: Date.now(),
        prompt: prompt,
        response: response.trim(),
        model: model
    };

    screenAnalysisHistory.push(analysisEntry);
    console.log('Saved screen analysis:', analysisEntry);

    // Replace lastScreenAnalysis — audio follow-ups get context of the LATEST screen only
    lastScreenAnalysis = response.trim();
    // interview gets 4 turns for query plan follow-ups, others get 2
    screenAnalysisTurnsLeft = (currentProfile === 'interview') ? 4 : 2;

    // TSE + interview profiles: maintain multi-turn history across screen captures
    if (currentProfile === 'tse' || currentProfile === 'interview') {
        tseScreenHistory.push(
            { role: 'user', content: prompt },
            { role: 'assistant', content: response.trim() }
        );
        if (tseScreenHistory.length > 20) { // cap at 10 turns = 20 messages
            tseScreenHistory = tseScreenHistory.slice(-20);
        }
    }

    // Send to renderer to save
    sendToRenderer('save-screen-analysis', {
        sessionId: currentSessionId,
        analysis: analysisEntry,
        fullHistory: screenAnalysisHistory,
        profile: currentProfile,
        customPrompt: currentCustomPrompt
    });
}

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        history: conversationHistory,
    };
}

async function getEnabledTools() {
    const tools = [];

    // Check if Google Search is enabled (default: true)
    const googleSearchEnabled = await getStoredSetting('googleSearchEnabled', 'true');
    console.log('Google Search enabled:', googleSearchEnabled);

    if (googleSearchEnabled === 'true') {
        tools.push({ googleSearch: {} });
        console.log('Added Google Search tool');
    } else {
        console.log('Google Search tool disabled');
    }

    return tools;
}

async function getStoredSetting(key, defaultValue) {
    try {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            // Wait a bit for the renderer to be ready
            await new Promise(resolve => setTimeout(resolve, 100));

            // Try to get setting from renderer process localStorage
            const value = await windows[0].webContents.executeJavaScript(`
                (function() {
                    try {
                        if (typeof localStorage === 'undefined') {
                            console.log('localStorage not available yet for ${key}');
                            return '${defaultValue}';
                        }
                        const stored = localStorage.getItem('${key}');
                        console.log('Retrieved setting ${key}:', stored);
                        return stored || '${defaultValue}';
                    } catch (e) {
                        console.error('Error accessing localStorage for ${key}:', e);
                        return '${defaultValue}';
                    }
                })()
            `);
            return value;
        }
    } catch (error) {
        console.error('Error getting stored setting for', key, ':', error.message);
    }
    console.log('Using default value for', key, ':', defaultValue);
    return defaultValue;
}

// helper to check if groq has been configured
function hasGroqKey() {
    const key = getGroqApiKey();
    return key && key.trim() != ''
}

// helper to check if claude has been configured
function hasClaudeKey() {
    const key = getClaudeApiKey();
    return key && key.trim() !== '';
}

// helper to check if OpenAI/GPT has been configured
function hasGptKey() {
    const key = getOpenaiApiKey();
    return key && key.trim() !== '';
}

// GPT conversation history
let gptConversationHistory = [];

// Claude conversation history (separate from Groq)
let claudeConversationHistory = [];

// Confidence filter — blocks Whisper garbage/hallucinations
const WHISPER_HALLUCINATIONS = [
    'thank you for watching',
    'thanks for watching',
    'please subscribe',
    'like and subscribe',
    'see you in the next video',
    'bye bye',
    'thank you',
    'sayonara',
    'the end',
    'subtitles by',
    'translated by',
    'amara.org',
    '.',
    '...',
    'yeah.',
    'yeah',
    'yep',
    'yep.',
    'no no',
    'no.',
    'ok.',
    'ok',
    'okay',
    'okay.',
    'alright.',
    'alright',
    "that's it",
    "that's it.",
    'right.',
    'cool.',
    'got it',
    'got it.',
    'sure.',
    'sure',
    'hmm',
    'hmm.',
];

function passesConfidenceFilter(text) {
    if (!text || text.trim() === '') return false;

    const cleaned = text.trim().toLowerCase();

    // Too short (single word / noise)
    if (cleaned.split(/\s+/).length <= 1 && cleaned.length < 5) {
        console.log('Confidence filter: blocked (too short):', text);
        return false;
    }

    // Known Whisper hallucinations — exact match only for short phrases, startsWith for long ones
    for (const hallucination of WHISPER_HALLUCINATIONS) {
        const isLong = hallucination.split(/\s+/).length >= 4;
        if (cleaned === hallucination || (isLong && cleaned.startsWith(hallucination))) {
            console.log('Confidence filter: blocked (hallucination):', text);
            return false;
        }
    }

    // Repeated characters / gibberish
    if (/^(.)\1{4,}$/.test(cleaned)) {
        console.log('Confidence filter: blocked (repeated chars):', text);
        return false;
    }

    return true;
}

// Place cache_control on the second-to-last message so history gets cached
// once it exceeds Claude Haiku's 2048-token minimum
function buildMessagesWithCache(history) {
    if (history.length < 2) return [...history];
    const msgs = history.map(m => ({ ...m }));
    const cacheIdx = msgs.length - 2; // second-to-last message (last assistant reply)
    const target = msgs[cacheIdx];
    if (typeof target.content === 'string') {
        msgs[cacheIdx] = { ...target, content: [{ type: 'text', text: target.content, cache_control: { type: 'ephemeral' } }] };
    } else if (Array.isArray(target.content) && target.content.length > 0) {
        const last = target.content[target.content.length - 1];
        if (!last.cache_control) {
            const newContent = [...target.content];
            newContent[newContent.length - 1] = { ...last, cache_control: { type: 'ephemeral' } };
            msgs[cacheIdx] = { ...target, content: newContent };
        }
    }
    return msgs;
}

// Send transcription to OpenAI GPT-5
async function sendToGPT(transcription) {
    const openaiApiKey = getOpenaiApiKey();
    if (!openaiApiKey) {
        console.log('No OpenAI API key, falling back to Claude');
        return hasClaudeKey() ? sendToClaude(transcription) : sendToGeminiText(transcription);
    }

    if (!transcription || transcription.trim() === '') {
        console.log('Empty transcription, skipping GPT');
        return;
    }

    console.log('Sending to GPT-5.1:', transcription.substring(0, 100) + '...');
    const modelInput = await maybeAugmentWithWebSearch(transcription);

    const histCap = (currentProfile === 'interview' || currentProfile === 'tse') ? 6 : 2;
    gptConversationHistory.push({ role: 'user', content: transcription.trim() });
    if (gptConversationHistory.length > histCap) {
        gptConversationHistory = gptConversationHistory.slice(-histCap);
    }

    const messages = [];
    if (currentSystemPrompt) {
        messages.push({ role: 'system', content: currentSystemPrompt });
    }
    const gptHistoryForCall = [...gptConversationHistory];
    gptHistoryForCall[gptHistoryForCall.length - 1] = { role: 'user', content: modelInput.trim() };
    messages.push(...gptHistoryForCall);

    const controller = new AbortController();
    let firstTokenReceived = false;
    const timeoutId = setTimeout(() => {
        if (!firstTokenReceived) {
            console.log('GPT timeout — no first token in 8s, falling back to Claude');
            controller.abort();
        }
    }, 8000);

    try {
        const startTime = Date.now();
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: OPENAI_TEXT_MODEL,
                max_completion_tokens: getOpenAICompletionBudget(),
                stream: true,
                stream_options: { include_usage: true },
                messages,
            }),
        });

        if (!response.ok) {
            clearTimeout(timeoutId);
            const errorText = await response.text();
            console.error('GPT API error:', response.status, errorText);
            sendToRenderer('update-status', `GPT error: ${response.status} — trying Claude`);
            gptConversationHistory.pop();
            return hasClaudeKey() ? sendToClaude(transcription) : sendToGeminiText(transcription);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let isFirst = true;
        let sseBuffer = '';
        let gptPromptTokens = 0;
        let gptCompletionTokens = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const json = JSON.parse(data);
                        // Capture usage from the final chunk (stream_options: include_usage)
                        if (json.usage) {
                            gptPromptTokens = json.usage.prompt_tokens || 0;
                            gptCompletionTokens = json.usage.completion_tokens || 0;
                        }
                        const delta = extractOpenAIStreamText(json);
                        if (delta) {
                            if (!firstTokenReceived) {
                                firstTokenReceived = true;
                                clearTimeout(timeoutId);
                            }
                            fullText += delta;
                            sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                            isFirst = false;
                        }
                    } catch (parseError) {
                        // Skip invalid JSON chunks
                    }
                }
            }
        }

        clearTimeout(timeoutId);
        console.log(`GPT response completed (${Date.now() - startTime}ms)`);

        // Track GPT token usage in the shared session stats
        if (gptPromptTokens > 0 || gptCompletionTokens > 0) {
            session.freshTokens += gptPromptTokens;
            session.input += gptPromptTokens;
            session.output += gptCompletionTokens;
            session.calls += 1;
            console.log(`GPT tokens — prompt: ${gptPromptTokens}, completion: ${gptCompletionTokens}`);
        }

        if (fullText) {
            gptConversationHistory.push({ role: 'assistant', content: fullText });
            // Keep Claude history in sync for fallback context
            claudeConversationHistory.push(
                { role: 'user', content: transcription.trim() },
                { role: 'assistant', content: fullText }
            );
            if (claudeConversationHistory.length > histCap) {
                claudeConversationHistory = claudeConversationHistory.slice(-histCap);
            }
            saveConversationTurn(transcription, fullText);
            sendToRenderer('update-status', 'Listening...');
        } else {
            console.warn('GPT returned empty — falling back to Claude');
            sendToRenderer('update-status', 'GPT empty — trying Claude');
            gptConversationHistory.pop();
            return hasClaudeKey() ? sendToClaude(transcription) : sendToGeminiText(transcription);
        }

    } catch (error) {
        clearTimeout(timeoutId);
        const isTimeout = error.name === 'AbortError';
        console.error(isTimeout ? 'GPT timed out' : 'GPT error', error.message);
        sendToRenderer('update-status', isTimeout ? 'GPT timeout — trying Claude' : 'GPT error — trying Claude');
        gptConversationHistory.pop();
        return hasClaudeKey() ? sendToClaude(transcription) : sendToGeminiText(transcription);
    }}

// Send transcription to Claude Sonnet for response
async function sendToClaude(transcription) {
    const claudeApiKey = getClaudeApiKey();
    if (!claudeApiKey) {
        console.log('No Claude API key configured, falling back to Groq');
        return sendToGroq(transcription);
    }

    if (!transcription || transcription.trim() === '') {
        console.log('Empty transcription, skipping Claude');
        return;
    }

    console.log('Sending to Claude Sonnet:', transcription.substring(0, 100) + '...');
    const modelInput = await maybeAugmentWithWebSearch(transcription);

    claudeConversationHistory.push({
        role: 'user',
        content: transcription.trim()
    });

    // Keep last 3 turns (6 messages) for interview/tse — enough context for follow-ups
    const histCap = (currentProfile === 'interview' || currentProfile === 'tse') ? 6 : 2;
    if (claudeConversationHistory.length > histCap) {
        claudeConversationHistory = claudeConversationHistory.slice(-histCap);
    }

    // Build messages — inject lastScreenAnalysis only within 2 turns of the analyze
    let messagesForCall;
    if (lastScreenAnalysis && screenAnalysisTurnsLeft > 0) {
        const screenContext = lastScreenAnalysis; // snapshot before potential null
        screenAnalysisTurnsLeft--;
        if (screenAnalysisTurnsLeft === 0) lastScreenAnalysis = null; // expire after last use
        const historyWithoutLast = claudeConversationHistory.slice(0, -1);
        const currentMsg = { role: 'user', content: modelInput.trim() };
        messagesForCall = buildMessagesWithCache([
            { role: 'user', content: '[Screen question context]' },
            { role: 'assistant', content: screenContext },
            ...historyWithoutLast,
            currentMsg,
        ]);
    } else {
        const claudeHistoryForCall = [...claudeConversationHistory];
        claudeHistoryForCall[claudeHistoryForCall.length - 1] = { role: 'user', content: modelInput.trim() };
        messagesForCall = buildMessagesWithCache(claudeHistoryForCall);
    }

    const controller = new AbortController();
    let firstTokenReceived = false;
    const timeoutId = setTimeout(() => {
        if (!firstTokenReceived) {
            console.log('Claude timeout — no first token in 6s, falling back to Gemini');
            controller.abort();
        }
    }, 6000);

    try {
        const startTime = Date.now();
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'x-api-key': claudeApiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'prompt-caching-2024-07-31',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: TOKEN_CONFIG.max_tokens,
                stream: true,
                system: [
                    {
                        type: 'text',
                        text: currentSystemPrompt || 'You are a helpful assistant.',
                        cache_control: { type: 'ephemeral' },
                    },
                ],
                messages: messagesForCall,
            }),
        });

        if (!response.ok) {
            clearTimeout(timeoutId);
            const errorText = await response.text();
            console.error('Claude API error:', response.status, errorText);
            sendToRenderer('update-status', `Claude error: ${response.status} — trying Gemini`);
            claudeConversationHistory.pop();
            return sendToGeminiText(transcription);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let isFirst = true;
        let sseBuffer = '';
        let usageInput = 0;
        let usageOutput = 0;
        let cacheReadTokens = 0;
        let cacheWriteTokens = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const json = JSON.parse(data);

                        if (json.type === 'message_start' && json.message?.usage) {
                            const u = json.message.usage;
                            usageInput = u.input_tokens || 0;
                            cacheReadTokens = u.cache_read_input_tokens || 0;
                            cacheWriteTokens = u.cache_creation_input_tokens || 0;
                            if (cacheReadTokens > 0) {
                                console.log(`Cache HIT: ${cacheReadTokens} tokens served from cache (${usageInput} fresh)`);
                            } else if (cacheWriteTokens > 0) {
                                console.log(`Cache WRITE: ${cacheWriteTokens} tokens written to cache (${usageInput} fresh)`);
                            }
                        }
                        if (json.type === 'message_delta' && json.usage) {
                            usageOutput = json.usage.output_tokens || 0;
                        }

                        if (json.type === 'content_block_delta' && json.delta?.text) {
                            if (!firstTokenReceived) {
                                firstTokenReceived = true;
                                clearTimeout(timeoutId);
                            }
                            fullText += json.delta.text;
                            const displayText = stripThinkingTags(fullText);
                            if (displayText) {
                                sendToRenderer(isFirst ? 'new-response' : 'update-response', displayText);
                                isFirst = false;
                            }
                        }

                        if (json.type === 'message_stop') {
                            break;
                        }
                    } catch (parseError) {
                        // Skip invalid JSON chunks
                    }
                }
            }
        }

        clearTimeout(timeoutId);
        const effectiveInput = usageInput + Math.ceil(cacheReadTokens * 0.1) + cacheWriteTokens;
        session.input += effectiveInput;
        session.output += usageOutput;
        session.calls += 1;
        session.freshTokens += usageInput;
        session.cacheWriteTokens += cacheWriteTokens;
        session.cacheReadTokens += cacheReadTokens;
        if (cacheReadTokens > 0) session.cacheHits += 1;
        console.log(`Token usage — fresh: ${usageInput}, cache_read: ${cacheReadTokens}, cache_write: ${cacheWriteTokens}, effective: ${effectiveInput}`);
        if (session.input + session.output > TOKEN_CONFIG.session_budget) {
            throw new Error('Session budget exceeded');
        }

        const cleanedResponse = stripThinkingTags(fullText);
        console.log(`Claude response completed (${Date.now() - startTime}ms)`);

        if (cleanedResponse) {
            claudeConversationHistory.push({ role: 'assistant', content: cleanedResponse });
            saveConversationTurn(transcription, cleanedResponse);
        } else {
            // Claude returned HTTP 200 but empty body (API degradation) — fall through to Gemini
            console.warn('Claude returned empty response — falling back to Gemini');
            sendToRenderer('update-status', 'Claude empty — trying Gemini');
            claudeConversationHistory.pop();
            return sendToGeminiText(transcription);
        }

        sendToRenderer('update-status', 'Listening...');

    } catch (error) {
        clearTimeout(timeoutId);
        const isTimeout = error.name === 'AbortError';
        console.error(isTimeout ? 'Claude timed out — falling back to Gemini' : 'Claude error — falling back to Gemini', error.message);
        sendToRenderer('update-status', isTimeout ? 'Claude timeout — trying Gemini' : 'Claude error — trying Gemini');
        claudeConversationHistory.pop();
        return sendToGeminiText(transcription);
    }
}

// Text-only Gemini fallback — same system prompt, writes answer into Claude history
async function sendToGeminiText(transcription) {
    const apiKey = getApiKey();
    if (!apiKey) {
        console.log('No Gemini API key — falling back to Groq');
        return sendToGroq(transcription);
    }

    try {
        const model = getAvailableModel();
        console.log(`Sending to Gemini (${model}) as fallback...`);
        sendToRenderer('update-status', 'Gemini responding...');
        const modelInput = await maybeAugmentWithWebSearch(transcription);

        const ai = new GoogleGenAI({ apiKey });

        // Build contents with last 1 turn from claudeConversationHistory for follow-up context
        // Gemini uses 'model' role instead of 'assistant'
        const contents = [];
        if (claudeConversationHistory.length >= 2) {
            const prev = claudeConversationHistory.slice(-2);
            contents.push(
                { role: 'user', parts: [{ text: prev[0].content }] },
                { role: 'model', parts: [{ text: prev[1].content }] }
            );
        }
        contents.push({ role: 'user', parts: [{ text: modelInput.trim() }] });

        const generateParams = { model, contents };
        if (currentSystemPrompt) {
            generateParams.config = { systemInstruction: currentSystemPrompt };
        }

        const response = await ai.models.generateContentStream(generateParams);
        incrementLimitCount(model);

        let fullText = '';
        let isFirst = true;
        for await (const chunk of response) {
            const chunkText = chunk.text;
            if (chunkText) {
                fullText += chunkText;
                sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                isFirst = false;
            }
        }

        if (fullText) {
            // Write Q+A into Claude history — Claude stays caught up on next call
            claudeConversationHistory.push(
                { role: 'user', content: transcription.trim() },
                { role: 'assistant', content: fullText }
            );
            if (claudeConversationHistory.length > 2) {
                claudeConversationHistory = claudeConversationHistory.slice(-2);
            }
            saveConversationTurn(transcription, fullText);
            console.log(`Gemini fallback response completed (${model})`);
            sendToRenderer('update-status', 'Listening...');
        } else {
            // Gemini returned empty — fall through to Groq
            console.warn('Gemini returned empty response — falling back to Groq');
            sendToRenderer('update-status', 'Gemini empty — trying Groq');
            return sendToGroq(transcription);
        }

    } catch (error) {
        console.error('Gemini fallback error — falling back to Groq:', error.message);
        sendToRenderer('update-status', 'Gemini error — trying Groq');
        return sendToGroq(transcription);
    }
}

function trimConversationHistoryForGemma(history, maxChars=42000) {
    if(!history || history.length === 0) return [];
    let totalChars = 0;
    const trimmed = [];

    for(let i = history.length - 1; i >= 0; i--) {
        const turn = history[i];
        const turnChars = (turn.content || '').length;

        if(totalChars + turnChars > maxChars) break;
        totalChars += turnChars;
        trimmed.unshift(turn);
    }
    return trimmed;
}

function stripThinkingTags(text) {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function sendToGroq(transcription) {
    const groqApiKey = getGroqApiKey();
    if (!groqApiKey) {
        console.log('No Groq API key configured, skipping Groq response');
        return;
    }

    if (!transcription || transcription.trim() === '') {
        console.log('Empty transcription, skipping Groq');
        return;
    }

    const modelToUse = getModelForToday();
    if (!modelToUse) {
        console.log('All Groq daily limits exhausted');
        sendToRenderer('update-status', 'Groq limits reached for today');
        return;
    }

    console.log(`Sending to Groq (${modelToUse}):`, transcription.substring(0, 100) + '...');
    const modelInput = await maybeAugmentWithWebSearch(transcription);

    groqConversationHistory.push({
        role: 'user',
        content: transcription.trim()
    });

    if (groqConversationHistory.length > 20) {
        groqConversationHistory = groqConversationHistory.slice(-20);
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelToUse,
                messages: [
                    { role: 'system', content: currentSystemPrompt || 'You are a helpful assistant.' },
                    ...groqConversationHistory.slice(0, -1),
                    { role: 'user', content: modelInput.trim() }
                ],
                stream: true,
                temperature: 0.7,
                max_tokens: 1024
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Groq API error:', response.status, errorText);
            sendToRenderer('update-status', `Groq error: ${response.status}`);
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let isFirst = true;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const json = JSON.parse(data);
                        const token = json.choices?.[0]?.delta?.content || '';
                        if (token) {
                            fullText += token;
                            const displayText = stripThinkingTags(fullText);
                            if (displayText) {
                                sendToRenderer(isFirst ? 'new-response' : 'update-response', displayText);
                                isFirst = false;
                            }
                        }
                    } catch (parseError) {
                        // Skip invalid JSON chunks
                    }
                }
            }
        }

        const cleanedResponse = stripThinkingTags(fullText);
        const modelKey = modelToUse.split('/').pop();

        const systemPromptChars = (currentSystemPrompt || 'You are a helpful assistant.').length;
        const historyChars = groqConversationHistory.reduce((sum, msg) => sum + (msg.content || '').length, 0);
        const inputChars = systemPromptChars + historyChars;
        const outputChars = cleanedResponse.length;

        incrementCharUsage('groq', modelKey, inputChars + outputChars);

        if (cleanedResponse) {
            groqConversationHistory.push({ role: 'assistant', content: cleanedResponse });

            // Keep Claude history in sync — so Claude has context when it recovers
            claudeConversationHistory.push(
                { role: 'user', content: transcription.trim() },
                { role: 'assistant', content: cleanedResponse }
            );
            if (claudeConversationHistory.length > 2) {
                claudeConversationHistory = claudeConversationHistory.slice(-2);
            }

            saveConversationTurn(transcription, cleanedResponse);
        }

        console.log(`Groq response completed (${modelToUse})`);
        sendToRenderer('update-status', 'Listening...');

    } catch (error) {
        console.error('Error calling Groq API:', error);
        sendToRenderer('update-status', 'Groq error — trying Gemini');
        return sendToGeminiText(transcription);
    }
}

async function sendToGemma(transcription) {
    const apiKey = getApiKey();
    if (!apiKey) {
        console.log('No Gemini API key configured');
        return;
    }

    if (!transcription || transcription.trim() === '') {
        console.log('Empty transcription, skipping Gemma');
        return;
    }

    console.log('Sending to Gemma:', transcription.substring(0, 100) + '...');

    groqConversationHistory.push({
        role: 'user',
        content: transcription.trim()
    });

    const trimmedHistory = trimConversationHistoryForGemma(groqConversationHistory, 42000);

    try {
        const ai = new GoogleGenAI({ apiKey: apiKey });

        const messages = trimmedHistory.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        }));

        const systemPrompt = currentSystemPrompt || 'You are a helpful assistant.';
        const messagesWithSystem = [
            { role: 'user', parts: [{ text: systemPrompt }] },
            { role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] },
            ...messages
        ];

        const response = await ai.models.generateContentStream({
            model: 'gemma-3-27b-it',
            contents: messagesWithSystem,
        });

        let fullText = '';
        let isFirst = true;

        for await (const chunk of response) {
            const chunkText = chunk.text;
            if (chunkText) {
                fullText += chunkText;
                sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                isFirst = false;
            }
        }

        const systemPromptChars = (currentSystemPrompt || 'You are a helpful assistant.').length;
        const historyChars = trimmedHistory.reduce((sum, msg) => sum + (msg.content || '').length, 0);
        const inputChars = systemPromptChars + historyChars;
        const outputChars = fullText.length;

        incrementCharUsage('gemini', 'gemma-3-27b-it', inputChars + outputChars);

        if (fullText.trim()) {
            groqConversationHistory.push({
                role: 'assistant',
                content: fullText.trim()
            });

            if (groqConversationHistory.length > 40) {
                groqConversationHistory = groqConversationHistory.slice(-40);
            }

            saveConversationTurn(transcription, fullText);
        }

        console.log('Gemma response completed');
        sendToRenderer('update-status', 'Listening...');

    } catch (error) {
        console.error('Error calling Gemma API:', error);
        sendToRenderer('update-status', 'Gemma error: ' + error.message);
    }
}

async function initializeGeminiSession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US', isReconnect = false) {
    if (isInitializingSession) {
        console.log('Session initialization already in progress');
        return false;
    }

    isInitializingSession = true;
    if (!isReconnect) {
        sendToRenderer('session-initializing', true);
    }

    // Store params for reconnection
    if (!isReconnect) {
        sessionParams = { apiKey, customPrompt, profile, language };
        reconnectAttempts = 0;
    }

    const client = new GoogleGenAI({
        vertexai: false,
        apiKey: apiKey,
        httpOptions: { apiVersion: 'v1alpha' },
    });

    // Get enabled tools first to determine Google Search status
    const enabledTools = await getEnabledTools();
    const googleSearchEnabled = enabledTools.some(tool => tool.googleSearch);

    const systemPrompt = getSystemPrompt(profile, customPrompt, googleSearchEnabled);
    currentSystemPrompt = systemPrompt; // Store for Groq

    // Initialize new conversation session only on first connect
    if (!isReconnect) {
        initializeNewSession(profile, customPrompt);
    }

    try {
        const session = await client.live.connect({
            model: 'gemini-2.5-flash-preview-native-audio-dialog',
            callbacks: {
                onopen: function () {
                    sendToRenderer('update-status', 'Live session connected');
                },
                onmessage: function (message) {
                    // Handle input transcription (what was spoken)
                    if (message.serverContent?.inputTranscription?.results) {
                        currentTranscription += formatSpeakerResults(message.serverContent.inputTranscription.results);
                        sendToRenderer('update-status', 'Hearing speech...');

                        // Debounce: send to LLM after last transcription chunk
                        if (transcriptionDebounceTimer) clearTimeout(transcriptionDebounceTimer);
                        transcriptionDebounceTimer = setTimeout(() => {
                            if (currentTranscription.trim() !== '') {
                                console.log('Debounce fired — sending transcription to LLM');
                                const text = currentTranscription;
                                currentTranscription = '';
                                if (hasGptKey()) {
                                    sendToGPT(text);
                                } else if (hasClaudeKey()) {
                                    sendToClaude(text);
                                } else if (hasGroqKey()) {
                                    sendToGroq(text);
                                } else {
                                    sendToGemma(text);
                                }
                            }
                        }, TRANSCRIPTION_DEBOUNCE_MS);
                    } else if (message.serverContent?.inputTranscription?.text) {
                        const text = message.serverContent.inputTranscription.text;
                        if (text.trim() !== '') {
                            currentTranscription += text;
                            sendToRenderer('update-status', 'Hearing speech...');

                            // Debounce: send to LLM after last transcription chunk
                            if (transcriptionDebounceTimer) clearTimeout(transcriptionDebounceTimer);
                            transcriptionDebounceTimer = setTimeout(() => {
                                if (currentTranscription.trim() !== '') {
                                    console.log('Debounce fired — sending transcription to LLM');
                                    const txn = currentTranscription;
                                    currentTranscription = '';
                                    if (hasGptKey()) {
                                        sendToGPT(txn);
                                    } else if (hasClaudeKey()) {
                                        sendToClaude(txn);
                                    } else if (hasGroqKey()) {
                                        sendToGroq(txn);
                                    } else {
                                        sendToGemma(txn);
                                    }
                                }
                            }, TRANSCRIPTION_DEBOUNCE_MS);
                        }
                    }

                    // generationComplete: clear debounce and send immediately if not already sent
                    if (message.serverContent?.generationComplete) {
                        if (transcriptionDebounceTimer) {
                            clearTimeout(transcriptionDebounceTimer);
                            transcriptionDebounceTimer = null;
                        }
                        if (currentTranscription.trim() !== '') {
                            const text = currentTranscription;
                            currentTranscription = '';
                            if (hasGptKey()) {
                                sendToGPT(text);
                            } else if (hasClaudeKey()) {
                                sendToClaude(text);
                            } else if (hasGroqKey()) {
                                sendToGroq(text);
                            } else {
                                sendToGemma(text);
                            }
                        }
                        messageBuffer = '';
                    }

                    if (message.serverContent?.turnComplete) {
                        sendToRenderer('update-status', 'Listening...');
                    }
                },
                onerror: function (e) {
                    console.log('Session error:', e.message);
                    sendToRenderer('update-status', 'Error: ' + e.message);
                },
                onclose: function (e) {
                    console.log('Session closed:', e.reason);

                    // Don't reconnect if user intentionally closed
                    if (isUserClosing) {
                        isUserClosing = false;
                        sendToRenderer('update-status', 'Session closed');
                        return;
                    }

                    // Attempt reconnection
                    if (sessionParams && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        attemptReconnect();
                    } else {
                        sendToRenderer('update-status', 'Session closed');
                    }
                },
            },
            config: {
                responseModalities: [Modality.AUDIO],
                proactivity: { proactiveAudio: true },
                outputAudioTranscription: {},
                tools: enabledTools,
                // Enable speaker diarization
                inputAudioTranscription: {
                    enableSpeakerDiarization: true,
                    minSpeakerCount: 2,
                    maxSpeakerCount: 2,
                },
                contextWindowCompression: { slidingWindow: {} },
                speechConfig: { languageCode: language },
                systemInstruction: {
                    parts: [{ text: systemPrompt }],
                },
            },
        });

        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        return session;
    } catch (error) {
        console.error('Failed to initialize Gemini session:', error);
        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        return null;
    }
}

async function attemptReconnect() {
    reconnectAttempts++;
    console.log(`Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

    // Clear stale buffers
    messageBuffer = '';
    currentTranscription = '';
    // Don't reset groqConversationHistory to preserve context across reconnects

    sendToRenderer('update-status', `Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    // Wait before attempting
    await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));

    try {
        const session = await initializeGeminiSession(
            sessionParams.apiKey,
            sessionParams.customPrompt,
            sessionParams.profile,
            sessionParams.language,
            true // isReconnect
        );

        if (session && global.geminiSessionRef) {
            global.geminiSessionRef.current = session;

            // Restore context from conversation history via text message
            const contextMessage = buildContextMessage();
            if (contextMessage) {
                try {
                    console.log('Restoring conversation context...');
                    await session.sendRealtimeInput({ text: contextMessage });
                } catch (contextError) {
                    console.error('Failed to restore context:', contextError);
                    // Continue without context - better than failing
                }
            }

            // Don't reset reconnectAttempts here - let it reset on next fresh session
            sendToRenderer('update-status', 'Reconnected! Listening...');
            console.log('Session reconnected successfully');
            return true;
        }
    } catch (error) {
        console.error(`Reconnection attempt ${reconnectAttempts} failed:`, error);
    }

    // If we still have attempts left, try again
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        return attemptReconnect();
    }

    // Max attempts reached - notify frontend
    console.log('Max reconnection attempts reached');
    sendToRenderer('reconnect-failed', {
        message: 'Tried 3 times to reconnect. Must be upstream/network issues. Try restarting or download updated app from site.',
    });
    sessionParams = null;
    return false;
}

function killExistingSystemAudioDump() {
    return new Promise(resolve => {
        console.log('Checking for existing SystemAudioDump processes...');

        // Kill any existing SystemAudioDump processes
        const killProc = spawn('pkill', ['-f', 'SystemAudioDump'], {
            stdio: 'ignore',
        });

        killProc.on('close', code => {
            if (code === 0) {
                console.log('Killed existing SystemAudioDump processes');
            } else {
                console.log('No existing SystemAudioDump processes found');
            }
            resolve();
        });

        killProc.on('error', err => {
            console.log('Error checking for existing processes (this is normal):', err.message);
            resolve();
        });

        // Timeout after 2 seconds
        setTimeout(() => {
            killProc.kill();
            resolve();
        }, 2000);
    });
}

async function startMacOSAudioCapture(geminiSessionRef) {
    if (process.platform !== 'darwin') return false;

    isStoppingAudio = false;

    // Kill any existing SystemAudioDump processes first
    await killExistingSystemAudioDump();

    console.log('Starting macOS audio capture with SystemAudioDump...');

    const { app } = require('electron');
    const fs = require('fs');
    const path = require('path');

    let systemAudioPath;
    if (app.isPackaged) {
        systemAudioPath = path.join(process.resourcesPath, 'SystemAudioDump');
    } else {
        systemAudioPath = path.join(__dirname, '../assets', 'SystemAudioDump');
    }

    console.log('SystemAudioDump path:', systemAudioPath);

    // Verify binary exists
    if (!fs.existsSync(systemAudioPath)) {
        console.error('SystemAudioDump binary not found at:', systemAudioPath);
        sendToRenderer('update-status', 'Audio capture unavailable — binary missing');
        return false;
    }

    // Ensure executable permission
    try {
        fs.chmodSync(systemAudioPath, 0o755);
    } catch (e) {
        console.warn('Could not chmod SystemAudioDump:', e.message);
    }

    const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
        },
    };

    let didReceiveData = false;
    const noDataTimer = setTimeout(() => {
        if (!didReceiveData && systemAudioProc) {
            console.warn('SystemAudioDump: no audio data received in 5s — check Screen Recording permission in System Settings → Privacy & Security');
            sendToRenderer('update-status', 'No audio — grant Screen Recording permission in System Settings');
        }
    }, 5000);

    systemAudioProc = spawn(systemAudioPath, [], spawnOptions);

    if (!systemAudioProc.pid) {
        clearTimeout(noDataTimer);
        console.error('Failed to start SystemAudioDump');
        sendToRenderer('update-status', 'Audio capture failed to start — check permissions');
        return false;
    }

    console.log('SystemAudioDump started with PID:', systemAudioProc.pid);

    const CHUNK_DURATION = 0.1;
    const SAMPLE_RATE = 24000;
    const BYTES_PER_SAMPLE = 2;
    const CHANNELS = 2;
    const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

    let audioBuffer = Buffer.alloc(0);

    systemAudioProc.stdout.on('data', data => {
        if (!didReceiveData) {
            didReceiveData = true;
            clearTimeout(noDataTimer);
            console.log('SystemAudioDump: first audio data received — capture working');
            sendToRenderer('update-status', 'Listening...');
        }

        audioBuffer = Buffer.concat([audioBuffer, data]);

        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);

            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;

            if (currentProviderMode === 'cloud') {
                sendCloudAudio(monoChunk);
            } else if (currentProviderMode === 'local') {
                getLocalAi().processLocalAudio(monoChunk);
            } else if (useGroqDirect) {
                processAudioWithVAD(monoChunk);
            } else {
                const base64Data = monoChunk.toString('base64');
                sendAudioToGemini(base64Data, geminiSessionRef);
            }

            if (process.env.DEBUG_AUDIO) {
                console.log(`Processed audio chunk: ${chunk.length} bytes`);
                saveDebugAudio(monoChunk, 'system_audio');
            }
        }

        const maxBufferSize = SAMPLE_RATE * BYTES_PER_SAMPLE * 1;
        if (audioBuffer.length > maxBufferSize) {
            audioBuffer = audioBuffer.slice(-maxBufferSize);
        }
    });

    systemAudioProc.stderr.on('data', data => {
        const msg = data.toString().trim();
        console.error('SystemAudioDump stderr:', msg);
        // Surface permission errors immediately
        if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
            clearTimeout(noDataTimer);
            sendToRenderer('update-status', 'Audio blocked — grant Screen Recording in System Settings');
        }
    });

    // Reset restart counter after 30s of sustained uptime
    const uptimeResetTimer = setTimeout(() => {
        if (!isStoppingAudio && systemAudioProc) {
            audioRestartAttempts = 0;
        }
    }, 30000);

    systemAudioProc.on('close', code => {
        clearTimeout(uptimeResetTimer);
        console.log('SystemAudioDump process closed with code:', code);
        systemAudioProc = null;

        if (isStoppingAudio) return;

        if (audioRestartAttempts >= MAX_AUDIO_RESTARTS) {
            console.error('Max SystemAudioDump restart attempts reached — giving up');
            sendToRenderer('update-status', 'Audio capture failed — restart session');
            audioRestartAttempts = 0;
            return;
        }

        // Exponential backoff: 3s, 6s, 12s, 24s, 48s
        const delay = AUDIO_RESTART_DELAY * Math.pow(2, audioRestartAttempts);
        audioRestartAttempts++;
        console.log(`Auto-restarting SystemAudioDump (attempt ${audioRestartAttempts}/${MAX_AUDIO_RESTARTS}) in ${delay}ms...`);
        sendToRenderer('update-status', `Audio restarting in ${Math.round(delay / 1000)}s...`);

        setTimeout(() => {
            if (!isStoppingAudio) {
                startMacOSAudioCapture(geminiSessionRef).then(success => {
                    if (success) {
                        console.log('SystemAudioDump restarted successfully');
                        sendToRenderer('update-status', 'Listening...');
                    } else {
                        console.error('Failed to restart SystemAudioDump');
                    }
                });
            }
        }, delay);
    });

    systemAudioProc.on('error', err => {
        clearTimeout(noDataTimer);
        console.error('SystemAudioDump process error:', err);
        sendToRenderer('update-status', 'Audio capture error: ' + err.message);
        systemAudioProc = null;
    });

    return true;
}

function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4;
    const monoBuffer = Buffer.alloc(samples * 2);

    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        monoBuffer.writeInt16LE(leftSample, i * 2);
    }

    return monoBuffer;
}

let isStoppingAudio = false;
let audioRestartAttempts = 0;
const MAX_AUDIO_RESTARTS = 5;
const AUDIO_RESTART_DELAY = 3000;

function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        console.log('Stopping SystemAudioDump...');
        isStoppingAudio = true;
        audioRestartAttempts = 0;
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
}

async function sendAudioToGemini(base64Data, geminiSessionRef) {
    if (!geminiSessionRef.current) return;

    try {
        process.stdout.write('.');
        await geminiSessionRef.current.sendRealtimeInput({
            audio: {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            },
        });
    } catch (error) {
        console.error('Error sending audio to Gemini:', error);
    }
}

async function sendImageToGeminiHttp(base64Data, prompt) {
    // Get available model based on rate limits
    const model = getAvailableModel();

    const apiKey = getApiKey();
    if (!apiKey) {
        return { success: false, error: 'No API key configured' };
    }

    try {
        const ai = new GoogleGenAI({ apiKey: apiKey });

        const contents = [
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Data,
                },
            },
            { text: prompt },
        ];

        console.log(`Sending image to ${model} (streaming)...`);
        const generateParams = {
            model: model,
            contents: contents,
        };
        if (currentSystemPrompt) {
            generateParams.config = {
                systemInstruction: currentSystemPrompt,
            };
        }
        const response = await ai.models.generateContentStream(generateParams);

        // Increment count after successful call
        incrementLimitCount(model);

        // Stream the response
        let fullText = '';
        let isFirst = true;
        for await (const chunk of response) {
            const chunkText = chunk.text;
            if (chunkText) {
                fullText += chunkText;
                // Send to renderer - new response for first chunk, update for subsequent
                sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                isFirst = false;
            }
        }

        console.log(`Image response completed from ${model}`);

        // Save screen analysis to history
        saveScreenAnalysis(prompt, fullText, model);

        return { success: true, text: fullText, model: model };
    } catch (error) {
        console.error('Error sending image to Gemini HTTP:', error);
        return { success: false, error: error.message };
    }
}

async function sendImageToClaude(base64Data, prompt) {
    const claudeApiKey = getClaudeApiKey();
    if (!claudeApiKey) {
        return { success: false, error: 'No Claude API key configured' };
    }

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': claudeApiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'prompt-caching-2024-07-31',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: currentProfile === 'tse' ? 1200 : currentProfile === 'interview' ? 800 : TOKEN_CONFIG.max_tokens,
                stream: true,
                system: [
                    {
                        type: 'text',
                        text: currentSystemPrompt || 'You are a helpful assistant.',
                        cache_control: { type: 'ephemeral' },
                    },
                ],
                messages: (() => {
                    // TSE + interview: inject prior screen history for follow-up context
                    if ((currentProfile === 'tse' || currentProfile === 'interview') && tseScreenHistory.length > 0) {
                        const prior = tseScreenHistory.slice(-20).map(m => ({
                            role: m.role,
                            content: [{ type: 'text', text: m.content }],
                        }));
                        // Replace last user entry with the image + text version
                        prior.push({
                            role: 'user',
                            content: [
                                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Data } },
                                { type: 'text', text: prompt },
                            ],
                        });
                        return prior;
                    }
                    return [
                        {
                            role: 'user',
                            content: [
                                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Data } },
                                { type: 'text', text: prompt },
                            ],
                        },
                    ];
                })(),
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Claude image API error:', response.status, errorText);
            return { success: false, error: `Claude error: ${response.status}` };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let isFirst = true;
        let sseBuffer = '';
        let imgInputTokens = 0, imgOutputTokens = 0, imgCacheRead = 0, imgCacheWrite = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const json = JSON.parse(data);
                        if (json.type === 'message_start' && json.message?.usage) {
                            const u = json.message.usage;
                            imgInputTokens = u.input_tokens || 0;
                            imgCacheRead = u.cache_read_input_tokens || 0;
                            imgCacheWrite = u.cache_creation_input_tokens || 0;
                        }
                        if (json.type === 'message_delta' && json.usage) {
                            imgOutputTokens = json.usage.output_tokens || 0;
                        }
                        if (json.type === 'content_block_delta' && json.delta?.text) {
                            fullText += json.delta.text;
                            sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                            isFirst = false;
                        }
                    } catch (parseError) {
                        // Skip invalid JSON
                    }
                }
            }
        }

        // Track analyze tokens separately
        analyzeSession.freshTokens += imgInputTokens;
        analyzeSession.cacheReadTokens += imgCacheRead;
        analyzeSession.cacheWriteTokens += imgCacheWrite;
        analyzeSession.input += imgInputTokens + Math.ceil(imgCacheRead * 0.1) + imgCacheWrite;
        analyzeSession.output += imgOutputTokens;
        analyzeSession.calls += 1;
        if (imgCacheRead > 0) analyzeSession.cacheHits += 1;
        if (imgCacheWrite > 0) analyzeSession.cacheWrites += 1;
        console.log(`Analyze tokens — fresh: ${imgInputTokens}, cache_read: ${imgCacheRead}, cache_write: ${imgCacheWrite}, output: ${imgOutputTokens}`);

        console.log('Claude image analysis completed');
        if (!fullText) {
            console.warn('Claude image returned empty response — will fall back to Gemini');
            return { success: false, error: 'empty response' };
        }
        saveScreenAnalysis(prompt, fullText, 'claude-sonnet');
        return { success: true, text: fullText, model: 'claude-sonnet' };

    } catch (error) {
        console.error('Error sending image to Claude:', error);
        return { success: false, error: error.message };
    }
}

// Send image to GPT-5 Vision
async function sendImageToGPT(base64Data, prompt) {
    const openaiApiKey = getOpenaiApiKey();
    if (!openaiApiKey) {
        return { success: false, error: 'No OpenAI API key configured' };
    }

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: OPENAI_TEXT_MODEL,
                max_completion_tokens: getOpenAICompletionBudget(),
                stream: true,
                stream_options: { include_usage: true },
                messages: [
                    ...(currentSystemPrompt ? [{ role: 'system', content: currentSystemPrompt }] : []),
                    {
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Data}`, detail: 'high' } },
                            { type: 'text', text: prompt },
                        ],
                    },
                ],
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('GPT vision API error:', response.status, errorText);
            return { success: false, error: `GPT error: ${response.status}` };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let isFirst = true;
        let sseBuffer = '';
        let gptImgPromptTokens = 0;
        let gptImgCompletionTokens = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const json = JSON.parse(data);
                        // Capture usage from the final chunk (stream_options: include_usage)
                        if (json.usage) {
                            gptImgPromptTokens = json.usage.prompt_tokens || 0;
                            gptImgCompletionTokens = json.usage.completion_tokens || 0;
                        }
                        const delta = extractOpenAIStreamText(json);
                        if (delta) {
                            fullText += delta;
                            sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                            isFirst = false;
                        }
                    } catch (parseError) {
                        // Skip invalid JSON
                    }
                }
            }
        }

        console.log('GPT image analysis completed');
        if (!fullText) {
            console.warn('GPT vision returned empty — will fall back to Gemini');
            return { success: false, error: 'empty response' };
        }

        // Track GPT vision tokens in the analyze session
        if (gptImgPromptTokens > 0 || gptImgCompletionTokens > 0) {
            analyzeSession.freshTokens += gptImgPromptTokens;
            analyzeSession.input += gptImgPromptTokens;
            analyzeSession.output += gptImgCompletionTokens;
            analyzeSession.calls += 1;
            console.log(`GPT vision tokens — prompt: ${gptImgPromptTokens}, completion: ${gptImgCompletionTokens}`);
        }

        saveScreenAnalysis(prompt, fullText, OPENAI_TEXT_MODEL);
        return { success: true, text: fullText, model: OPENAI_TEXT_MODEL };

    } catch (error) {
        console.error('Error sending image to GPT:', error);
        return { success: false, error: error.message };
    }
}

function setupGeminiIpcHandlers(geminiSessionRef) {
    // Store the geminiSessionRef globally for reconnection access
    global.geminiSessionRef = geminiSessionRef;

    ipcMain.handle('initialize-cloud', async (event, token, profile, userContext) => {
        try {
            currentProviderMode = 'cloud';
            initializeNewSession(profile);
            setOnTurnComplete((transcription, response) => {
                saveConversationTurn(transcription, response);
            });
            sendToRenderer('session-initializing', true);
            const proModel = getProModel();
            await connectCloud(token, profile, userContext, proModel);
            sendToRenderer('session-initializing', false);
            return true;
        } catch (err) {
            console.error('[Cloud] Init error:', err);
            currentProviderMode = 'byok';
            sendToRenderer('session-initializing', false);
            return false;
        }
    });

    ipcMain.handle('initialize-gemini', async (event, apiKey, customPrompt, profile = 'interview', language = 'en-US') => {
        currentProviderMode = 'byok';

        console.log('=== INITIALIZE-GEMINI CALLED ===');
        console.log('hasGroqKey():', hasGroqKey());
        console.log('Groq key length:', (getGroqApiKey() || '').length);

        // Groq Direct Mode — skip Gemini Live entirely for much faster responses
        if (hasGroqKey()) {
            useGroqDirect = true;
            sessionParams = { apiKey, customPrompt, profile, language };

            sendToRenderer('session-initializing', true);

            const enabledTools = await getEnabledTools();
            const googleSearchEnabled = enabledTools.some(tool => tool.googleSearch);
            currentSystemPrompt = getSystemPrompt(profile, customPrompt, googleSearchEnabled);
            console.log(
                `System prompt stats (${profile || 'default'}) — chars: ${currentSystemPrompt.length}, est_tokens: ${estimateTokenCount(currentSystemPrompt)}`
            );

            initializeNewSession(profile, customPrompt);
            resetVadState();
            claudeConversationHistory = [];
            gptConversationHistory = [];
            tseScreenHistory = [];

            const brainModel = hasGptKey() ? 'GPT-5.1' : (hasClaudeKey() ? 'Claude Sonnet' : 'Groq');
            sendToRenderer('session-initializing', false);
            sendToRenderer('update-status', `Ready (${brainModel} + Whisper)`);
            console.log('=== DIRECT MODE ACTIVATED ===');
            console.log(`Brain: ${brainModel} | Transcription: Groq Whisper | Gemini: SKIPPED`);
            return true;
        }

        // Fallback: use Gemini Live session (slower, but works without Groq key)
        useGroqDirect = false;
        const session = await initializeGeminiSession(apiKey, customPrompt, profile, language);
        if (session) {
            geminiSessionRef.current = session;
            return true;
        }
        return false;
    });

    ipcMain.handle('initialize-local', async (event, ollamaHost, ollamaModel, whisperModel, profile, customPrompt) => {
        currentProviderMode = 'local';
        const success = await getLocalAi().initializeLocalSession(ollamaHost, ollamaModel, whisperModel, profile, customPrompt);
        if (!success) {
            currentProviderMode = 'byok';
        }
        return success;
    });

    ipcMain.handle('send-audio-content', async (event, { data, mimeType }) => {
        if (currentProviderMode === 'cloud') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                sendCloudAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending cloud audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (currentProviderMode === 'local') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                getLocalAi().processLocalAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending local audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (useGroqDirect) {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                processAudioWithVAD(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error processing audio in Groq direct mode:', error);
                return { success: false, error: error.message };
            }
        }
        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };
        try {
            process.stdout.write('.');
            await geminiSessionRef.current.sendRealtimeInput({
                audio: { data: data, mimeType: mimeType },
            });
            return { success: true };
        } catch (error) {
            console.error('Error sending system audio:', error);
            return { success: false, error: error.message };
        }
    });

    // Handle microphone audio on a separate channel
    ipcMain.handle('send-mic-audio-content', async (event, { data, mimeType }) => {
        if (currentProviderMode === 'cloud') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                sendCloudAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending cloud mic audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (currentProviderMode === 'local') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                getLocalAi().processLocalAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending local mic audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (useGroqDirect) {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                processAudioWithVAD(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error processing mic audio in Groq direct mode:', error);
                return { success: false, error: error.message };
            }
        }
        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };
        try {
            process.stdout.write(',');
            await geminiSessionRef.current.sendRealtimeInput({
                audio: { data: data, mimeType: mimeType },
            });
            return { success: true };
        } catch (error) {
            console.error('Error sending mic audio:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-image-content', async (event, { data, prompt }) => {
        try {
            if (!data || typeof data !== 'string') {
                console.error('Invalid image data received');
                return { success: false, error: 'Invalid image data' };
            }

            const buffer = Buffer.from(data, 'base64');

            if (buffer.length < 1000) {
                console.error(`Image buffer too small: ${buffer.length} bytes`);
                return { success: false, error: 'Image buffer too small' };
            }

            process.stdout.write('!');

            if (currentProviderMode === 'cloud') {
                const sent = sendCloudImage(data);
                if (!sent) {
                    return { success: false, error: 'Cloud connection not active' };
                }
                return { success: true, model: 'cloud' };
            }

            if (currentProviderMode === 'local') {
                const result = await getLocalAi().sendLocalImage(data, prompt);
                return result;
            }

            // GPT-5 vision → Claude vision → Gemini
            if (hasGptKey()) {
                const result = await sendImageToGPT(data, prompt);
                if (result.success) return result;
                console.log('GPT image analysis failed, falling back to Claude/Gemini');
            }
            if (hasClaudeKey()) {
                const result = await sendImageToClaude(data, prompt);
                if (result.success) return result;
                console.log('Claude image analysis failed, falling back to Gemini');
            }
            const result = await sendImageToGeminiHttp(data, prompt);
            return result;
        } catch (error) {
            console.error('Error sending image:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('reset-tse-history', async () => {
        tseScreenHistory = [];
        console.log('TSE screen history cleared — new incident started');
        sendToRenderer('update-status', 'New incident started');
        return { success: true };
    });

    ipcMain.handle('send-text-message', async (event, text) => {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return { success: false, error: 'Invalid text message' };
        }

        if (currentProviderMode === 'cloud') {
            try {
                console.log('Sending text to cloud:', text);
                sendCloudText(text.trim());
                return { success: true };
            } catch (error) {
                console.error('Error sending cloud text:', error);
                return { success: false, error: error.message };
            }
        }

        if (currentProviderMode === 'local') {
            try {
                console.log('Sending text to local Ollama:', text);
                return await getLocalAi().sendLocalText(text.trim());
            } catch (error) {
                console.error('Error sending local text:', error);
                return { success: false, error: error.message };
            }
        }

        // Direct Mode — route: GPT → Claude → Gemini → Groq
        if (useGroqDirect) {
            try {
                if (hasGptKey()) {
                    console.log('Sending text to GPT-5.1 (direct mode):', text);
                    await sendToGPT(text.trim());
                } else if (hasClaudeKey()) {
                    console.log('Sending text to Claude (direct mode):', text);
                    await sendToClaude(text.trim());
                } else {
                    console.log('Sending text to Groq (direct mode):', text);
                    await sendToGroq(text.trim());
                }
                return { success: true };
            } catch (error) {
                console.error('Error sending text in direct mode:', error);
                return { success: false, error: error.message };
            }
        }

        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };

        try {
            console.log('Sending text message:', text);

            if (hasGroqKey()) {
                sendToGroq(text.trim());
            } else {
                sendToGemma(text.trim());
            }

            await geminiSessionRef.current.sendRealtimeInput({ text: text.trim() });
            return { success: true };
        } catch (error) {
            console.error('Error sending text:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-macos-audio', async event => {
        if (process.platform !== 'darwin') {
            return {
                success: false,
                error: 'macOS audio capture only available on macOS',
            };
        }

        try {
            const success = await startMacOSAudioCapture(geminiSessionRef);
            return { success };
        } catch (error) {
            console.error('Error starting macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stop-macos-audio', async event => {
        try {
            stopMacOSAudioCapture();
            return { success: true };
        } catch (error) {
            console.error('Error stopping macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('close-session', async event => {
        try {
            stopMacOSAudioCapture();

            if (currentProviderMode === 'cloud') {
                closeCloud();
                currentProviderMode = 'byok';
                return { success: true };
            }

            if (currentProviderMode === 'local') {
                getLocalAi().closeLocalSession();
                currentProviderMode = 'byok';
                return { success: true };
            }

            // Clean up Direct Mode state
            if (useGroqDirect) {
                resetVadState();
                useGroqDirect = false;
                sessionParams = null;
                claudeConversationHistory = [];
                gptConversationHistory = [];
                return { success: true };
            }

            // Set flag to prevent reconnection attempts
            isUserClosing = true;
            sessionParams = null;

            // Cleanup session
            if (geminiSessionRef.current) {
                await geminiSessionRef.current.close();
                geminiSessionRef.current = null;
            }

            return { success: true };
        } catch (error) {
            console.error('Error closing session:', error);
            return { success: false, error: error.message };
        }
    });

    // Conversation history IPC handlers
    ipcMain.handle('get-current-session', async event => {
        try {
            return { success: true, data: getCurrentSessionData() };
        } catch (error) {
            console.error('Error getting current session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-new-session', async event => {
        try {
            initializeNewSession();
            return { success: true, sessionId: currentSessionId };
        } catch (error) {
            console.error('Error starting new session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-google-search-setting', async (event, enabled) => {
        try {
            console.log('Google Search setting updated to:', enabled);
            // The setting is already saved in localStorage by the renderer
            // This is just for logging/confirmation
            return { success: true };
        } catch (error) {
            console.error('Error updating Google Search setting:', error);
            return { success: false, error: error.message };
        }
    });
}

function getSessionStats() {
    return { ...session, analyze: { ...analyzeSession } };
}

function resetAnalyzeSession() {
    analyzeSession = { input: 0, output: 0, calls: 0, cacheHits: 0, cacheWrites: 0, freshTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

function resetSession() {
    session = { input: 0, output: 0, calls: 0, freshTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, cacheHits: 0 };
    resetAnalyzeSession();
}

module.exports = {
    initializeGeminiSession,
    getEnabledTools,
    getStoredSetting,
    sendToRenderer,
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    killExistingSystemAudioDump,
    startMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture,
    sendAudioToGemini,
    sendImageToGeminiHttp,
    setupGeminiIpcHandlers,
    formatSpeakerResults,
    getSessionStats,
    resetAnalyzeSession,
    resetSession,
    TOKEN_CONFIG,
};
