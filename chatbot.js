document.addEventListener('DOMContentLoaded', async () => {
    const elements = {
        chatbox: document.getElementById('chatbox'),
        userInput: document.getElementById('userInput'),
        sendButton: document.getElementById('sendButton'),
        apiKeyInput: document.getElementById('apiKeyInput'),
        themeToggle: document.getElementById('themeToggle'),
        generateAudioButton: document.getElementById('generateAudioButton'),
        audioLinkContainer: document.getElementById('audioLinkContainer'),
        audioControls: document.getElementById('audioControls'),
        progress: document.getElementById('progress'),
        playPauseButton: document.getElementById('playPauseButton'),
        stopButton: document.getElementById('stopButton'),
        restartButton: document.getElementById('restartButton'),
        quickPrompts: document.getElementById('quickPrompts'),
        conversationCount: document.getElementById('conversationCount'),
        sourceMeta: document.getElementById('sourceMeta'),
        sourceLink: document.getElementById('sourceLink'),
        sourcePill: document.getElementById('sourcePill'),
        heroDescription: document.getElementById('heroDescription'),
        contextLabel: document.getElementById('contextLabel'),
        contextSummary: document.getElementById('contextSummary'),
        audioStatus: document.getElementById('audioStatus'),
        refreshContextButton: document.getElementById('refreshContextButton'),
        liveArticleStatus: document.getElementById('liveArticleStatus'),
        articleStats: document.getElementById('articleStats'),
        liveArticlePreview: document.getElementById('liveArticlePreview'),
        liveArticleContent: document.getElementById('liveArticleContent')
    };

    const THEME_KEY = 'ustp-theme';
    const API_KEY_STORAGE = 'apiKey';
    const GEMINI_MODEL = 'gemini-3-pro-preview';
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const MAX_LIVE_ARTICLE_CHARS = 28000;
    const LIVE_ARTICLE_PREVIEW_CHARS = 2400;
    const MAX_PDF_BYTES = 50 * 1024 * 1024;
    const MAX_CHAT_RESPONSE_TOKENS = 2200;
    const MAX_CHAT_CONTINUATION_PASSES = 6;
    const MAX_CHAT_HISTORY_ENTRIES = 16;
    const ARTICLE_SELECTORS = [
        'article',
        'main article',
        'main',
        '[role="main"]',
        '.article-content',
        '.article-body',
        '.post-content',
        '.post-body',
        '.entry-content',
        '.story-body',
        '.story-content'
    ];

    const urlParams = new URLSearchParams(window.location.search);
    const summary = urlParams.get('summary');
    const url = urlParams.get('url') || 'Unknown source';

    const state = {
        conversationHistory: [],
        messageCount: 0,
        narrationText: '',
        currentUtterance: null,
        narrationPaused: false,
        narrationActive: false,
        liveArticle: {
            loading: false,
            kind: 'text',
            title: '',
            text: '',
            truncated: false,
            wordCount: 0,
            mimeType: '',
            data: '',
            sizeBytes: 0,
            syncedAt: '',
            error: ''
        }
    };

    marked.setOptions({
        breaks: true,
        gfm: true,
        highlight(code, lang) {
            if (Prism.languages[lang]) {
                return Prism.highlight(code, Prism.languages[lang], lang);
            }
            return code;
        }
    });

    function getStorage(keys) {
        return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
    }

    function setStorage(items) {
        return new Promise((resolve) => chrome.storage.local.set(items, resolve));
    }

    function getTheme() {
        return localStorage.getItem(THEME_KEY) || 'light';
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        elements.themeToggle.textContent = theme === 'dark' ? 'Use Light Theme' : 'Use Dark Theme';
    }

    function toggleTheme() {
        const nextTheme = getTheme() === 'dark' ? 'light' : 'dark';
        localStorage.setItem(THEME_KEY, nextTheme);
        applyTheme(nextTheme);
    }

    function requireApiKey() {
        const apiKey = elements.apiKeyInput.value.trim();
        if (!apiKey) {
            alert('Please enter your Google API key.');
            throw new Error('Missing Gemini API key.');
        }
        return apiKey;
    }

    function updateConversationCount() {
        elements.conversationCount.textContent = `${state.messageCount} ${state.messageCount === 1 ? 'turn' : 'turns'}`;
    }

    function scrollChatToBottom() {
        elements.chatbox.scrollTop = elements.chatbox.scrollHeight;
    }

    function normalizeFetchedText(content) {
        return String(content || '')
            .replace(/\r/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function isPdfUrl(sourceUrl) {
        return /\.pdf(?:$|[?#])/i.test(String(sourceUrl || ''));
    }

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        let binary = '';

        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            const chunk = bytes.subarray(offset, offset + chunkSize);
            binary += String.fromCharCode(...chunk);
        }

        return btoa(binary);
    }

    function formatByteSize(byteCount) {
        if (!byteCount) {
            return '0 B';
        }

        const units = ['B', 'KB', 'MB', 'GB'];
        let size = byteCount;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex += 1;
        }

        return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
    }

    function truncateText(content, maxChars) {
        if (content.length <= maxChars) {
            return {
                text: content,
                truncated: false
            };
        }

        return {
            text: content.slice(0, maxChars),
            truncated: true
        };
    }

    function extractLiveArticleText(doc) {
        const root = (doc.body || doc.documentElement);
        if (!root) {
            throw new Error('No readable document body was found.');
        }

        const workingRoot = root.cloneNode(true);
        workingRoot.querySelectorAll(
            'script, style, noscript, nav, header, footer, aside, form, button, svg, img, figure, video, audio, iframe, .sidebar, .advertisement, .ads'
        ).forEach((node) => node.remove());

        const candidates = [];
        const seen = new Set();

        ARTICLE_SELECTORS.forEach((selector) => {
            workingRoot.querySelectorAll(selector).forEach((node) => {
                if (!seen.has(node)) {
                    seen.add(node);
                    candidates.push(node);
                }
            });
        });

        if (!seen.has(workingRoot)) {
            candidates.push(workingRoot);
        }

        const bestNode = candidates.reduce((best, current) => {
            const bestTextLength = normalizeFetchedText(best.innerText || best.textContent || '').length;
            const currentTextLength = normalizeFetchedText(current.innerText || current.textContent || '').length;
            const bestScore = bestTextLength + (best.querySelectorAll('p').length * 120);
            const currentScore = currentTextLength + (current.querySelectorAll('p').length * 120);
            return currentScore > bestScore ? current : best;
        }, candidates[0]);

        const rawTitle = doc.querySelector('title')?.textContent || bestNode.querySelector('h1')?.textContent || 'Untitled article';
        const rawText = normalizeFetchedText(bestNode.innerText || bestNode.textContent || '');

        if (!rawText) {
            throw new Error('The source page did not expose readable article text.');
        }

        const preparedText = truncateText(rawText, MAX_LIVE_ARTICLE_CHARS);

        return {
            kind: 'text',
            title: normalizeFetchedText(rawTitle) || 'Untitled article',
            text: preparedText.text,
            truncated: preparedText.truncated,
            wordCount: rawText.split(/\s+/).filter(Boolean).length,
            mimeType: 'text/html',
            data: '',
            sizeBytes: 0,
            syncedAt: new Date().toISOString()
        };
    }

    async function fetchLiveArticle(sourceUrl) {
        if (sourceUrl.startsWith('chrome://') || sourceUrl.startsWith('chrome-extension://')) {
            throw new Error(`Unable to read live content from ${sourceUrl} due to browser restrictions.`);
        }

        const response = await fetch(sourceUrl);
        if (!response.ok) {
            throw new Error(`Unable to fetch the live webpage. HTTP ${response.status}.`);
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const isPdf = contentType.includes('application/pdf') || isPdfUrl(sourceUrl);

        if (isPdf) {
            const pdfBytes = await response.arrayBuffer();

            if (!pdfBytes.byteLength) {
                throw new Error('The PDF file was empty.');
            }

            if (pdfBytes.byteLength > MAX_PDF_BYTES) {
                throw new Error('The PDF exceeds Gemini\'s 50 MB PDF input limit.');
            }

            return {
                kind: 'pdf',
                title: sourceUrl.split('/').pop()?.split(/[?#]/)[0] || 'Source PDF',
                text: '',
                truncated: false,
                wordCount: 0,
                mimeType: 'application/pdf',
                data: arrayBufferToBase64(pdfBytes),
                sizeBytes: pdfBytes.byteLength,
                syncedAt: new Date().toISOString()
            };
        }

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        return extractLiveArticleText(doc);
    }

    function renderLiveArticleState() {
        const liveArticle = state.liveArticle;
        elements.refreshContextButton.disabled = liveArticle.loading;
        elements.refreshContextButton.textContent = liveArticle.loading ? 'Syncing…' : 'Refresh Live Article';

        if (liveArticle.loading) {
            elements.liveArticleStatus.textContent = 'Syncing';
            elements.articleStats.textContent = 'Fetching the source page and extracting the article…';
            elements.contextSummary.textContent = 'Syncing live article content from the source page so chat can reference the actual webpage text.';
            elements.liveArticlePreview.open = false;
            elements.liveArticleContent.textContent = '';
            elements.liveArticlePreview.hidden = true;
            return;
        }

        if (liveArticle.kind === 'pdf' && liveArticle.data) {
            elements.liveArticleStatus.textContent = 'PDF';
            elements.articleStats.textContent = `${formatByteSize(liveArticle.sizeBytes)} synced as a native PDF input${liveArticle.syncedAt ? ` • ${new Date(liveArticle.syncedAt).toLocaleTimeString()}` : ''}`;
            elements.contextSummary.textContent = 'A live PDF was synced from the source link. Chat answers can analyze the PDF directly through Gemini document understanding.';
            elements.liveArticlePreview.open = false;
            elements.liveArticleContent.textContent = '';
            elements.liveArticlePreview.hidden = true;
            return;
        }

        if (liveArticle.text) {
            elements.liveArticleStatus.textContent = 'Live';
            elements.articleStats.textContent = `${liveArticle.wordCount.toLocaleString()} words synced${liveArticle.truncated ? ' (trimmed for context size)' : ''}${liveArticle.syncedAt ? ` • ${new Date(liveArticle.syncedAt).toLocaleTimeString()}` : ''}`;
            elements.contextSummary.textContent = 'Live article content is now loaded. Chat answers can use the fetched webpage text as primary context.';
            elements.liveArticleContent.textContent = liveArticle.text.length > LIVE_ARTICLE_PREVIEW_CHARS
                ? `${liveArticle.text.slice(0, LIVE_ARTICLE_PREVIEW_CHARS)}\n\n…`
                : liveArticle.text;
            elements.liveArticlePreview.hidden = false;
            return;
        }

        if (liveArticle.error) {
            elements.liveArticleStatus.textContent = 'Unavailable';
            elements.articleStats.textContent = liveArticle.error;
            elements.contextSummary.textContent = summary
                ? 'Live article sync failed, so chat will fall back to the saved summary and conversation history.'
                : 'Live article sync failed, so chat is limited to the current conversation context.';
            elements.liveArticlePreview.open = false;
            elements.liveArticleContent.textContent = '';
            elements.liveArticlePreview.hidden = true;
            return;
        }

        elements.liveArticleStatus.textContent = 'Idle';
        elements.articleStats.textContent = 'No live article synced yet.';
        elements.contextSummary.textContent = summary
            ? 'This chat uses the selected page, the saved summary, and any synced live article content as working context.'
            : 'This chat uses the selected page and any synced live article content as working context.';
        elements.liveArticlePreview.open = false;
        elements.liveArticleContent.textContent = '';
        elements.liveArticlePreview.hidden = true;
    }

    async function loadLiveArticleContext() {
        state.liveArticle.loading = true;
        state.liveArticle.error = '';
        renderLiveArticleState();

        try {
            state.liveArticle = {
                ...state.liveArticle,
                ...await fetchLiveArticle(url),
                loading: false,
                error: ''
            };
        } catch (error) {
            console.error('Unable to sync live article:', error);
            state.liveArticle = {
                ...state.liveArticle,
                loading: false,
                kind: 'text',
                title: '',
                text: '',
                truncated: false,
                wordCount: 0,
                mimeType: '',
                data: '',
                sizeBytes: 0,
                syncedAt: '',
                error: error.message
            };
        }

        renderLiveArticleState();
    }

    function buildLiveArticleContextContent() {
        if (state.liveArticle.kind === 'pdf' && state.liveArticle.data) {
            return {
                role: 'user',
                parts: [
                    {
                        inline_data: {
                            mime_type: state.liveArticle.mimeType || 'application/pdf',
                            data: state.liveArticle.data
                        }
                    },
                    {
                        text: [
                            'Use this live PDF as the primary source of truth for questions about this page.',
                            'Prefer the PDF over the saved summary if they differ.',
                            `Source URL: ${url}`,
                            `PDF title: ${state.liveArticle.title || 'Source PDF'}`,
                            `PDF size: ${formatByteSize(state.liveArticle.sizeBytes)}`
                        ].join('\n')
                    }
                ]
            };
        }

        if (!state.liveArticle.text) {
            return null;
        }

        const contextParts = [
            'Use the live article content below as the primary source of truth for questions about this page.',
            'Prefer the live article over the saved summary if they differ.',
            state.liveArticle.truncated
                ? 'The live article content was truncated to fit the model context window. Say when details may be missing.'
                : 'The fetched live article content is complete as captured by the extension.',
            `Source URL: ${url}`,
            `Article title: ${state.liveArticle.title || 'Untitled article'}`,
            '',
            state.liveArticle.text
        ];

        return {
            role: 'user',
            parts: [{
                text: contextParts.join('\n')
            }]
        };
    }

    function buildAssistantInstructionContent() {
        return {
            role: 'user',
            parts: [{
                text: [
                    'You are the analysis assistant for a browser research workspace.',
                    'Answer the user\'s latest request directly and stay tightly anchored to the provided page context.',
                    'Use source priority in this order: live PDF or live article, then saved summary, then prior conversation.',
                    'If the context is incomplete, stale, or conflicting, say that clearly instead of guessing.',
                    'Do not waste space repeating long source material unless the user asks for a full recap.',
                    'For analytical requests, prefer short markdown sections or bullets.'
                ].join('\n')
            }]
        };
    }

    function buildSummaryContextContent() {
        if (!summary) {
            return null;
        }

        const shouldUseFallbackSummary = state.liveArticle.error
            || (!state.liveArticle.text && !state.liveArticle.data)
            || state.liveArticle.truncated;

        if (shouldUseFallbackSummary) {
            return {
                role: 'user',
                parts: [{
                    text: [
                        'Fallback saved summary for the source page:',
                        `Source URL: ${url}`,
                        '',
                        summary,
                        '',
                        'Use this summary only as fallback context when the live source is unavailable.'
                    ].join('\n')
                }]
            };
        }

        return null;
    }

    function getConversationWindow(history) {
        return history.slice(-MAX_CHAT_HISTORY_ENTRIES);
    }

    function buildRequestHistory(history) {
        return [
            buildAssistantInstructionContent(),
            buildSummaryContextContent(),
            buildLiveArticleContextContent()
        ].filter(Boolean).concat(getConversationWindow(history));
    }

    function syncComposerHeight() {
        elements.userInput.style.height = 'auto';
        elements.userInput.style.height = `${Math.min(elements.userInput.scrollHeight, 220)}px`;
    }

    function createMessageElement(sender, className, options = {}) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${className}${options.pending ? ' is-pending' : ''}`;

        const senderElement = document.createElement('strong');
        senderElement.textContent = sender;
        messageElement.appendChild(senderElement);

        const contentElement = document.createElement('div');
        contentElement.className = 'message-content';
        contentElement.innerHTML = options.pending ? '<p>Reading the source and drafting a grounded answer…</p>' : '';
        messageElement.appendChild(contentElement);

        elements.chatbox.appendChild(messageElement);
        scrollChatToBottom();
        return messageElement;
    }

    function setMessageContent(messageElement, markdown) {
        const contentElement = messageElement.querySelector('.message-content');
        contentElement.innerHTML = marked.parse(markdown);
        messageElement.classList.remove('is-pending');
        messageElement.querySelectorAll('pre code').forEach((block) => {
            Prism.highlightElement(block);
        });
        scrollChatToBottom();
    }

    function appendMessage(sender, markdown, className) {
        const senderLabel = sender === 'You' ? 'You' : 'Assistant';
        const messageElement = createMessageElement(senderLabel, className);
        setMessageContent(messageElement, markdown);
        state.messageCount += 1;
        updateConversationCount();
        return messageElement;
    }

    function createQuickPrompt(label, prompt) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chip-button';
        button.textContent = label;
        button.addEventListener('click', () => {
            elements.userInput.value = prompt;
            elements.userInput.focus();
        });
        return button;
    }

    function renderQuickPrompts() {
        const prompts = summary
            ? [
                ['Key takeaways', 'Give me the most important takeaways from this page.'],
                ['Critical gaps', 'What is weak, missing, or questionable in this page?'],
                ['Action checklist', 'Turn this page into a practical checklist I can execute.'],
                ['Skill angle', 'How would you turn this page into a reusable AI agent skill?']
            ]
            : [
                ['Explain the page', 'Explain what this page is about and what matters most.'],
                ['Find the risks', 'What are the main risks or weak assumptions on this page?'],
                ['Implementation plan', 'Turn this page into an implementation plan with concrete steps.']
            ];

        elements.quickPrompts.innerHTML = '';
        prompts.forEach(([label, prompt]) => {
            elements.quickPrompts.appendChild(createQuickPrompt(label, prompt));
        });
    }

    function buildInitialMessage() {
        if (summary) {
            return [
                'This page context is loaded.',
                'A saved summary is available as fallback context, and live sync will use the current source page when possible.',
                'Ask for analysis, objections, implementation steps, comparisons, or a skill draft.'
            ].join('\n');
        }

        return 'No saved summary was passed in. I can still work from the live source when it is available and from the conversation itself.';
    }

    function updateSourceContext() {
        const sourceHost = (() => {
            try {
                return new URL(url).hostname.replace(/^www\./, '');
            } catch (error) {
                return 'Captured page';
            }
        })();

        elements.sourceMeta.textContent = `Attached to ${sourceHost}. Open the source page or keep the discussion focused here.`;
        elements.sourcePill.textContent = sourceHost;
        elements.sourceLink.href = url;
        elements.sourceLink.textContent = `Open ${sourceHost}`;
        elements.heroDescription.textContent = summary
            ? 'The saved summary is already in context, and the chat can also sync the live article directly from the source page.'
            : 'No saved summary was passed in, so the chat will rely on live article sync and conversation history.';
        elements.contextLabel.textContent = summary ? 'Summary + live article conversation' : 'Live article conversation';
        renderLiveArticleState();
    }

    function resetNarrationUi() {
        state.narrationActive = false;
        state.narrationPaused = false;
        elements.audioControls.hidden = true;
        elements.generateAudioButton.textContent = 'Narrate Chat';
        elements.playPauseButton.textContent = 'Pause';
    }

    function updateNarrationStatus(message) {
        elements.audioStatus.textContent = message;
    }

    function stopNarration(resetProgress = false) {
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        state.currentUtterance = null;
        resetNarrationUi();

        if (resetProgress) {
            elements.progress.style.width = '0%';
        }
    }

    function buildNarrationText() {
        return state.conversationHistory
            .map((entry) => {
                const speaker = entry.role === 'user' ? 'User' : 'Assistant';
                const text = entry.parts?.[0]?.text || '';
                return `${speaker}: ${text}`;
            })
            .join('\n\n');
    }

    function attachTranscriptDownloadLink(text) {
        const transcriptBlob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const transcriptUrl = URL.createObjectURL(transcriptBlob);
        const link = document.createElement('a');
        link.href = transcriptUrl;
        link.download = 'ustp-chat-transcript.txt';
        link.textContent = 'Download transcript';

        elements.audioLinkContainer.innerHTML = '';
        const note = document.createElement('p');
        note.textContent = 'Narration finished in-browser. Download the current transcript if you want an offline handoff.';
        elements.audioLinkContainer.appendChild(note);
        elements.audioLinkContainer.appendChild(link);
    }

    function startNarration() {
        if (!('speechSynthesis' in window)) {
            updateNarrationStatus('Unsupported');
            elements.audioLinkContainer.textContent = 'This browser does not support speech synthesis.';
            return;
        }

        const narrationText = buildNarrationText();
        if (!narrationText.trim()) {
            updateNarrationStatus('Idle');
            elements.audioLinkContainer.textContent = 'The conversation is empty, so there is nothing to narrate yet.';
            return;
        }

        stopNarration(true);
        state.narrationText = narrationText;

        const utterance = new SpeechSynthesisUtterance(narrationText);
        state.currentUtterance = utterance;

        utterance.onstart = () => {
            if (state.currentUtterance !== utterance) {
                return;
            }
            state.narrationActive = true;
            elements.audioControls.hidden = false;
            elements.progress.style.width = '0%';
            elements.generateAudioButton.textContent = 'Stop Narration';
            elements.playPauseButton.textContent = 'Pause';
            updateNarrationStatus('Playing');
            elements.audioLinkContainer.textContent = 'Narration is playing in your browser.';
        };

        utterance.onboundary = (event) => {
            if (state.currentUtterance !== utterance) {
                return;
            }
            const progress = Math.min((event.charIndex / narrationText.length) * 100, 100);
            elements.progress.style.width = `${progress}%`;
        };

        utterance.onend = () => {
            if (state.currentUtterance !== utterance) {
                return;
            }
            state.currentUtterance = null;
            elements.progress.style.width = '100%';
            updateNarrationStatus('Finished');
            attachTranscriptDownloadLink(narrationText);
            resetNarrationUi();
        };

        utterance.onerror = (event) => {
            if (state.currentUtterance !== utterance) {
                return;
            }
            state.currentUtterance = null;
            console.error('Narration error:', event);
            updateNarrationStatus('Error');
            elements.audioLinkContainer.textContent = 'Narration failed in this browser session.';
            resetNarrationUi();
        };

        window.speechSynthesis.speak(utterance);
    }

    function toggleNarrationPlayback() {
        if (!('speechSynthesis' in window) || !state.narrationActive) {
            return;
        }

        if (window.speechSynthesis.paused || state.narrationPaused) {
            window.speechSynthesis.resume();
            state.narrationPaused = false;
            elements.playPauseButton.textContent = 'Pause';
            updateNarrationStatus('Playing');
            return;
        }

        window.speechSynthesis.pause();
        state.narrationPaused = true;
        elements.playPauseButton.textContent = 'Resume';
        updateNarrationStatus('Paused');
    }

    function restartNarration() {
        if (!state.narrationText) {
            return;
        }
        startNarration();
    }

    async function requestChatResponse(contents, apiKey) {
        for (let attempt = 0; attempt < 6; attempt += 1) {
            const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: contents,
                    generationConfig: {
                        temperature: 0.35,
                        topK: 32,
                        topP: 0.9,
                        maxOutputTokens: MAX_CHAT_RESPONSE_TOKENS
                    }
                })
            });

            if (response.status === 429 && attempt < 5) {
                await new Promise((resolve) => setTimeout(resolve, (2 ** attempt) * 1000));
                continue;
            }

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            const candidate = data.candidates?.[0];
            const text = candidate?.content?.parts?.map((part) => part.text || '').join('') || '';

            if (!text.trim()) {
                throw new Error('No response generated by the model.');
            }

            return {
                text: text,
                finishReason: candidate?.finishReason || 'STOP'
            };
        }

        throw new Error('Gemini rate limit persisted after several retries.');
    }

    async function generateResponse(apiKey, history) {
        const contents = history.slice();
        let combinedText = '';

        for (let pass = 0; pass < MAX_CHAT_CONTINUATION_PASSES; pass += 1) {
            const result = await requestChatResponse(contents, apiKey);
            combinedText += result.text;
            contents.push({
                role: 'model',
                parts: [{
                    text: result.text
                }]
            });

            if (result.finishReason !== 'MAX_TOKENS') {
                return combinedText.trim();
            }

            contents.push({
                role: 'user',
                parts: [{
                    text: 'Continue the same answer from the exact point you stopped. Do not restart, summarize, or repeat any previous text. Output only the remaining answer.'
                }]
            });
        }

        throw new Error('The chat response kept truncating after multiple continuation attempts.');
    }

    async function sendMessage(prefilledMessage = '') {
        let apiKey;
        try {
            apiKey = requireApiKey();
        } catch (error) {
            return;
        }

        const message = (prefilledMessage || elements.userInput.value).trim();
        if (!message) {
            return;
        }

        appendMessage('You', message, 'user-message');
        state.conversationHistory.push({ role: 'user', parts: [{ text: message }] });

        elements.userInput.value = '';
        syncComposerHeight();
        elements.userInput.focus();
        elements.sendButton.disabled = true;
        const pendingMessage = createMessageElement('Assistant', 'bot-message', { pending: true });

        try {
            const response = await generateResponse(apiKey, buildRequestHistory(state.conversationHistory));
            setMessageContent(pendingMessage, response);
            state.conversationHistory.push({ role: 'model', parts: [{ text: response }] });
            state.messageCount += 1;
            updateConversationCount();
        } catch (error) {
            console.error('Error generating response:', error);
            setMessageContent(pendingMessage, `Sorry, I ran into an error:\n\n${error.message}`);
            state.messageCount += 1;
            updateConversationCount();
        } finally {
            elements.sendButton.disabled = false;
        }
    }

    function bindEvents() {
        elements.themeToggle.addEventListener('click', toggleTheme);
        elements.sendButton.addEventListener('click', () => sendMessage());
        elements.userInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        });
        elements.userInput.addEventListener('input', syncComposerHeight);
        elements.apiKeyInput.addEventListener('change', async () => {
            await setStorage({ [API_KEY_STORAGE]: elements.apiKeyInput.value.trim() });
        });
        elements.refreshContextButton.addEventListener('click', loadLiveArticleContext);
        elements.generateAudioButton.addEventListener('click', () => {
            if (state.narrationActive) {
                stopNarration(true);
                updateNarrationStatus('Stopped');
                elements.audioLinkContainer.textContent = 'Narration stopped.';
                return;
            }
            startNarration();
        });
        elements.playPauseButton.addEventListener('click', toggleNarrationPlayback);
        elements.stopButton.addEventListener('click', () => {
            stopNarration(true);
            updateNarrationStatus('Stopped');
            elements.audioLinkContainer.textContent = 'Narration stopped.';
        });
        elements.restartButton.addEventListener('click', restartNarration);
    }

    async function initialize() {
        bindEvents();
        applyTheme(getTheme());
        renderQuickPrompts();
        updateSourceContext();
        updateConversationCount();
        updateNarrationStatus('Idle');
        syncComposerHeight();
        renderLiveArticleState();
        loadLiveArticleContext();

        const storageData = await getStorage([API_KEY_STORAGE]);
        elements.apiKeyInput.value = storageData.apiKey || '';

        const initialMessage = buildInitialMessage();
        appendMessage('Assistant', initialMessage, 'bot-message');
    }

    try {
        await initialize();
    } catch (error) {
        console.error('Unable to initialize chat:', error);
        appendMessage('Assistant', `Unable to initialize chat:\n\n${error.message}`, 'bot-message');
    }

    window.addEventListener('beforeunload', () => {
        stopNarration(false);
    });
});
