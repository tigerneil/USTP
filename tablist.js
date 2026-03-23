document.addEventListener('DOMContentLoaded', async () => {
    const elements = {
        tabList: document.getElementById('tabList'),
        apiKeyInput: document.getElementById('apiKeyInput'),
        searchInput: document.getElementById('searchInput'),
        clearSearchButton: document.getElementById('clearSearchButton'),
        summarizeAllButton: document.getElementById('summarizeAllButton'),
        themeToggle: document.getElementById('themeToggle'),
        statusBar: document.getElementById('statusBar'),
        statusText: document.getElementById('statusText'),
        totalTabsStat: document.getElementById('totalTabsStat'),
        visibleTabsStat: document.getElementById('visibleTabsStat'),
        summarizedTabsStat: document.getElementById('summarizedTabsStat'),
        skilledTabsStat: document.getElementById('skilledTabsStat'),
        filterMeta: document.getElementById('filterMeta'),
        emptyState: document.getElementById('emptyState'),
        emptyStateTitle: document.getElementById('emptyStateTitle'),
        emptyStateBody: document.getElementById('emptyStateBody'),
        summaryPanel: document.getElementById('summaryPanel'),
        summaryHeading: document.getElementById('summaryHeading'),
        summaryMeta: document.getElementById('summaryMeta'),
        summaryOutput: document.getElementById('summary'),
        skillPanel: document.getElementById('skillPanel'),
        skillHeading: document.getElementById('skillHeading'),
        skillMeta: document.getElementById('skillMeta'),
        skillOutput: document.getElementById('skillOutput'),
        downloadSkillButton: document.getElementById('downloadSkillButton')
    };

    const STORAGE_KEYS = {
        apiKey: 'apiKey',
        savedTabs: 'savedTabs'
    };
    const THEME_KEY = 'ustp-theme';
    const MAX_PAGE_CHARS = 32000;
    const MAX_PDF_BYTES = 50 * 1024 * 1024;
    const GEMINI_MODEL = 'gemini-3-pro-preview';
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const MAX_CONTINUATION_PASSES = 6;

    const state = {
        savedTabs: [],
        filterQuery: '',
        actionStates: {},
        activeSkillExport: null
    };

    marked.setOptions({
        breaks: true,
        gfm: true
    });

    function getStorage(keys) {
        return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
    }

    function setStorage(items) {
        return new Promise((resolve) => chrome.storage.local.set(items, resolve));
    }

    function setStatus(message, tone = 'neutral') {
        elements.statusBar.dataset.tone = tone;
        elements.statusText.textContent = message;
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

    function normalizeText(content) {
        return String(content || '')
            .replace(/\r/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function prepareContentForModel(content, maxChars = MAX_PAGE_CHARS) {
        const normalizedContent = normalizeText(content);
        if (normalizedContent.length <= maxChars) {
            return {
                content: normalizedContent,
                truncated: false
            };
        }

        return {
            content: normalizedContent.slice(0, maxChars),
            truncated: true
        };
    }

    function isPdfUrl(url) {
        return /\.pdf(?:$|[?#])/i.test(String(url || ''));
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

    function getTabKey(tab) {
        return `${tab.url}::${tab.title || ''}`;
    }

    function setActionState(tab, actionName, isActive) {
        const tabKey = getTabKey(tab);
        if (!state.actionStates[tabKey]) {
            state.actionStates[tabKey] = {};
        }

        state.actionStates[tabKey][actionName] = isActive;
    }

    function isActionActive(tab, actionName) {
        return Boolean(state.actionStates[getTabKey(tab)]?.[actionName]);
    }

    function getFilteredTabs() {
        const query = state.filterQuery.trim().toLowerCase();
        if (!query) {
            return state.savedTabs.map((tab, index) => ({ tab, index }));
        }

        return state.savedTabs
            .map((tab, index) => ({ tab, index }))
            .filter(({ tab }) => {
                const title = String(tab.title || '').toLowerCase();
                const url = String(tab.url || '').toLowerCase();
                return title.includes(query) || url.includes(query);
            });
    }

    function formatDomain(url) {
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch (error) {
            return 'local page';
        }
    }

    function formatTimestamp(timestamp) {
        if (!timestamp) {
            return '';
        }

        try {
            return new Date(timestamp).toLocaleString();
        } catch (error) {
            return '';
        }
    }

    function renderMarkdown(target, markdown) {
        target.classList.remove('is-placeholder');
        target.innerHTML = marked.parse(markdown);
    }

    function setPlaceholder(target, text) {
        target.classList.add('is-placeholder');
        target.textContent = text;
    }

    function showSummaryPanel(title, meta, markdown) {
        elements.summaryHeading.textContent = title;
        elements.summaryMeta.textContent = meta;
        renderMarkdown(elements.summaryOutput, markdown);
    }

    function resetSummaryPanel() {
        elements.summaryHeading.textContent = 'Workspace Summary';
        elements.summaryMeta.textContent = 'Generate a rollup after the individual page summaries are ready.';
        setPlaceholder(
            elements.summaryOutput,
            'Run a summary action to build a cleaner view of what your captured pages say.'
        );
    }

    function renderSkillPreview(skill) {
        if (!skill || !skill.markdown) {
            return;
        }

        state.activeSkillExport = skill;
        elements.skillPanel.hidden = false;
        elements.skillHeading.textContent = skill.skillName || 'Generated Skill';
        elements.skillMeta.textContent = skill.generatedAt
            ? `Generated ${formatTimestamp(skill.generatedAt)}`
            : 'Preview the generated skill and export it as a SKILL.md file.';
        elements.skillOutput.textContent = skill.markdown;
        elements.downloadSkillButton.disabled = false;
        setStatus(`Loaded skill preview for ${skill.skillName || 'selected page'}.`, 'info');
    }

    function clearSkillPreview() {
        state.activeSkillExport = null;
        elements.skillOutput.textContent = '';
        elements.downloadSkillButton.disabled = true;
        elements.skillPanel.hidden = true;
    }

    function downloadActiveSkill() {
        if (!state.activeSkillExport) {
            return;
        }

        const blob = new Blob([state.activeSkillExport.markdown], { type: 'text/markdown;charset=utf-8' });
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = state.activeSkillExport.fileName || 'webpage-skill-SKILL.md';
        link.click();
        URL.revokeObjectURL(objectUrl);
    }

    function updateStats() {
        const filteredTabs = getFilteredTabs();
        const summarizedCount = state.savedTabs.filter((tab) => Boolean(tab.summary)).length;
        const skillCount = state.savedTabs.filter((tab) => Boolean(tab.skill)).length;

        elements.totalTabsStat.textContent = String(state.savedTabs.length);
        elements.visibleTabsStat.textContent = String(filteredTabs.length);
        elements.summarizedTabsStat.textContent = String(summarizedCount);
        elements.skilledTabsStat.textContent = String(skillCount);
        elements.filterMeta.textContent = state.filterQuery
            ? `Showing ${filteredTabs.length} of ${state.savedTabs.length} captured tabs`
            : `${state.savedTabs.length} captured tabs`;
    }

    function createButton(label, className, onClick, options = {}) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.disabled = Boolean(options.disabled);
        button.addEventListener('click', onClick);
        return button;
    }

    function createBadge(label, className = '') {
        const badge = document.createElement('span');
        badge.className = className ? `badge ${className}` : 'badge';
        badge.textContent = label;
        return badge;
    }

    function createSummaryPreview(tab) {
        if (!tab.summary) {
            return null;
        }

        const details = document.createElement('details');
        details.className = 'preview-block';

        const summary = document.createElement('summary');
        const summaryLabel = document.createElement('span');
        summaryLabel.textContent = 'Summary preview';
        const icon = document.createElement('span');
        icon.className = 'preview-icon';
        icon.textContent = '+';
        summary.appendChild(summaryLabel);
        summary.appendChild(icon);
        details.appendChild(summary);

        const content = document.createElement('div');
        content.className = 'preview-content markdown-body';
        content.innerHTML = marked.parse(tab.summary);
        details.appendChild(content);
        return details;
    }

    function renderTabs() {
        const filteredTabs = getFilteredTabs();
        elements.tabList.innerHTML = '';
        elements.emptyState.hidden = filteredTabs.length > 0;

        if (!state.savedTabs.length) {
            elements.emptyStateTitle.textContent = 'No captured tabs yet.';
            elements.emptyStateBody.textContent = 'Use the popup to gather the current window, then return here to summarize, chat, or build a skill.';
        } else if (!filteredTabs.length) {
            elements.emptyStateTitle.textContent = 'No tabs match the current filter.';
            elements.emptyStateBody.textContent = 'Clear the filter or adjust the search query to reveal the captured pages again.';
        }

        if (!filteredTabs.length) {
            updateStats();
            return;
        }

        filteredTabs.forEach(({ tab, index }, visibleIndex) => {
            const card = document.createElement('li');
            card.className = 'tab-card';
            card.style.setProperty('--card-index', String(visibleIndex));

            const topLine = document.createElement('div');
            topLine.className = 'tab-topline';

            const titleGroup = document.createElement('div');
            const title = document.createElement('h3');
            title.className = 'tab-title';
            title.textContent = tab.title || tab.url;
            titleGroup.appendChild(title);

            const link = document.createElement('a');
            link.className = 'tab-link';
            link.href = tab.url;
            link.target = '_blank';
            link.rel = 'noreferrer';
            link.textContent = tab.url;
            titleGroup.appendChild(link);

            topLine.appendChild(titleGroup);
            topLine.appendChild(createBadge(formatDomain(tab.url)));
            card.appendChild(topLine);

            const badgeRow = document.createElement('div');
            badgeRow.className = 'badge-row';
            badgeRow.appendChild(createBadge('Captured page'));
            if (tab.summary) {
                badgeRow.appendChild(createBadge('Summary ready', 'success'));
            }
            if (tab.skill) {
                badgeRow.appendChild(createBadge('Skill ready', 'skill'));
            }
            card.appendChild(badgeRow);

            const actionRow = document.createElement('div');
            actionRow.className = 'action-row';

            const summarizeButtonLabel = isActionActive(tab, 'summarizing') ? 'Summarizing…' : 'Summarize';
            actionRow.appendChild(
                createButton(
                    summarizeButtonLabel,
                    'card-button',
                    () => summarizeTab(index),
                    { disabled: isActionActive(tab, 'summarizing') || isActionActive(tab, 'skilling') }
                )
            );

            actionRow.appendChild(
                createButton('Chat', 'card-button-secondary', () => openChatbot(index))
            );

            const skillLabel = isActionActive(tab, 'skilling')
                ? 'Building Skill…'
                : (tab.skill ? 'Regenerate Skill' : 'Create Skill');
            actionRow.appendChild(
                createButton(
                    skillLabel,
                    'card-button-secondary',
                    () => generateSkillForTab(index),
                    { disabled: isActionActive(tab, 'skilling') || isActionActive(tab, 'summarizing') }
                )
            );

            if (tab.skill) {
                actionRow.appendChild(
                    createButton('View Skill', 'card-button-secondary', () => renderSkillPreview(tab.skill))
                );
            }

            actionRow.appendChild(
                createButton('Delete', 'card-button-danger', () => deleteTab(index))
            );
            card.appendChild(actionRow);

            if (tab.summary) {
                const preview = createSummaryPreview(tab);
                if (preview) {
                    card.appendChild(preview);
                }
            }

            if (tab.skill?.generatedAt) {
                const metaRow = document.createElement('div');
                metaRow.className = 'meta-row';
                metaRow.appendChild(createBadge(`Skill updated ${formatTimestamp(tab.skill.generatedAt)}`));
                card.appendChild(metaRow);
            }

            elements.tabList.appendChild(card);
        });

        updateStats();
    }

    async function persistTabs() {
        await setStorage({ [STORAGE_KEYS.savedTabs]: state.savedTabs });
    }

    async function fetchContent(url) {
        if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
            throw new Error(`Unable to fetch content from ${url} due to browser restrictions.`);
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Unable to fetch ${url}. HTTP ${response.status}.`);
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const isPdf = contentType.includes('application/pdf') || isPdfUrl(url);

        if (isPdf) {
            const pdfBytes = await response.arrayBuffer();

            if (!pdfBytes.byteLength) {
                throw new Error(`The PDF at ${url} was empty.`);
            }

            if (pdfBytes.byteLength > MAX_PDF_BYTES) {
                throw new Error(`The PDF at ${url} exceeds Gemini's 50 MB PDF input limit.`);
            }

            return {
                kind: 'pdf',
                mimeType: 'application/pdf',
                data: arrayBufferToBase64(pdfBytes),
                sizeBytes: pdfBytes.byteLength,
                url: url
            };
        }

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        doc.querySelectorAll('script, style, noscript, svg, img, video, audio, iframe').forEach((node) => {
            node.remove();
        });

        const title = doc.querySelector('title')?.textContent || '';
        const bodyText = doc.body?.innerText || doc.documentElement?.innerText || '';
        const combinedText = normalizeText(`${title}\n\n${bodyText}`);

        if (!combinedText) {
            throw new Error(`No readable content found at ${url}.`);
        }

        return {
            kind: 'text',
            text: combinedText,
            url: url
        };
    }

    async function callGeminiWithContents(contents, apiKey, options = {}) {
        const retries = options.retries || 6;
        const generationConfig = {
            temperature: options.temperature ?? 0.55,
            topK: options.topK ?? 32,
            topP: options.topP ?? 0.92,
            maxOutputTokens: options.maxOutputTokens ?? 900
        };

        for (let attempt = 0; attempt < retries; attempt += 1) {
            const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: contents,
                    generationConfig
                })
            });

            if (response.status === 429 && attempt < retries - 1) {
                await new Promise((resolve) => setTimeout(resolve, (2 ** attempt) * 1000));
                continue;
            }

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Gemini request failed (${response.status}): ${errorBody}`);
            }

            const data = await response.json();
            const candidate = data.candidates?.[0];
            const text = candidate?.content?.parts?.map((part) => part.text || '').join('') || '';

            if (!text.trim()) {
                throw new Error('Gemini returned an empty response.');
            }

            return {
                text: text,
                finishReason: candidate?.finishReason || 'STOP'
            };
        }

        throw new Error('Gemini rate limit persisted after several retries.');
    }

    async function requestCompleteGeminiWithContents(initialContents, apiKey, options = {}) {
        const contents = initialContents.slice();
        let combinedText = '';
        const continuationPrompt = options.continuationPrompt
            || 'Continue the same markdown summary from the exact point you stopped. Do not repeat any previous text. Output only the remaining summary.';

        for (let pass = 0; pass < MAX_CONTINUATION_PASSES; pass += 1) {
            const result = await callGeminiWithContents(contents, apiKey, options);
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
                    text: continuationPrompt
                }]
            });
        }

        throw new Error('Gemini kept truncating the summary after multiple continuation attempts.');
    }

    async function callGemini(prompt, apiKey, options = {}) {
        return requestCompleteGeminiWithContents([{
            parts: [{
                text: prompt
            }]
        }], apiKey, options);
    }

    async function generateSummary(source, apiKey) {
        if (source.kind === 'pdf') {
            const prompt = [
                'Summarize this PDF for a research workspace.',
                'Use markdown.',
                'Be concise, structured, and practical.',
                'Prefer short sections and bullet points.',
                `Source URL: ${source.url}`,
                `PDF size: ${formatByteSize(source.sizeBytes)}`
            ].join('\n');

            return requestCompleteGeminiWithContents([{
                parts: [
                    {
                        inline_data: {
                            mime_type: source.mimeType || 'application/pdf',
                            data: source.data
                        }
                    },
                    {
                        text: prompt
                    }
                ]
            }], apiKey, {
                maxOutputTokens: 1800,
                temperature: 0.5,
                continuationPrompt: 'Continue the same PDF summary from the exact point you stopped. Do not repeat any previous text. Output only the remaining markdown summary.'
            });
        }

        const prepared = prepareContentForModel(source.text);
        const prompt = [
            'Summarize the following webpage content for a research workspace.',
            'Be concise, structured, and practical.',
            'Use markdown.',
            'Prefer short sections and bullet points.',
            prepared.truncated ? 'The source content was truncated. Note uncertainty if needed.' : 'The source content is complete.',
            '',
            prepared.content
        ].join('\n');

        return callGemini(prompt, apiKey, {
            maxOutputTokens: 1800,
            temperature: 0.5,
            continuationPrompt: 'Continue the same webpage summary from the exact point you stopped. Do not repeat any previous text. Output only the remaining markdown summary.'
        });
    }

    async function generateWorkspaceSummary(summaries, apiKey) {
        const prompt = [
            'Synthesize these page summaries into one workspace brief.',
            'Use markdown.',
            'Include these sections in order:',
            '1. Overall Theme',
            '2. Key Findings',
            '3. Tensions or Open Questions',
            '4. Suggested Next Actions',
            '',
            summaries.join('\n\n---\n\n')
        ].join('\n');

        return callGemini(prompt, apiKey, {
            maxOutputTokens: 2200,
            temperature: 0.45,
            continuationPrompt: 'Continue the same workspace brief from the exact point you stopped. Do not repeat any previous text. Output only the remaining markdown.'
        });
    }

    function requireApiKey() {
        const apiKey = elements.apiKeyInput.value.trim();
        if (!apiKey) {
            alert('Please enter your Google API key.');
            throw new Error('Missing Gemini API key.');
        }
        return apiKey;
    }

    async function summarizeTab(index) {
        const tab = state.savedTabs[index];
        setActionState(tab, 'summarizing', true);
        renderTabs();

        try {
            const apiKey = requireApiKey();
            setStatus(`Summarizing ${tab.title || tab.url}…`, 'info');
            const content = await fetchContent(tab.url);
            const summary = await generateSummary(content, apiKey);
            state.savedTabs[index].summary = summary;
            await persistTabs();
            showSummaryPanel(
                tab.title || 'Page Summary',
                content.kind === 'pdf' ? `PDF • ${formatByteSize(content.sizeBytes)}` : formatDomain(tab.url),
                summary
            );
            setStatus(`Summary ready for ${tab.title || tab.url}.`, 'success');
        } catch (error) {
            console.error('Error summarizing tab:', error);
            if (error.message !== 'Missing Gemini API key.') {
                setStatus(`Unable to summarize ${tab.title || tab.url}: ${error.message}`, 'error');
            }
        } finally {
            setActionState(tab, 'summarizing', false);
            renderTabs();
        }
    }

    async function summarizeAllTabs() {
        let apiKey;
        try {
            apiKey = requireApiKey();
        } catch (error) {
            return;
        }

        if (!state.savedTabs.length) {
            setStatus('No captured tabs available. Gather a window first.', 'warning');
            return;
        }

        elements.summarizeAllButton.disabled = true;
        const collectedSummaries = [];
        const failures = [];

        try {
            for (let index = 0; index < state.savedTabs.length; index += 1) {
                const tab = state.savedTabs[index];
                setActionState(tab, 'summarizing', true);
                renderTabs();
                setStatus(`Summarizing ${index + 1} of ${state.savedTabs.length}: ${tab.title || tab.url}`, 'info');

                try {
                    if (!tab.summary) {
                        const content = await fetchContent(tab.url);
                        state.savedTabs[index].summary = await generateSummary(content, apiKey);
                        await persistTabs();
                    }
                    collectedSummaries.push(state.savedTabs[index].summary);
                } catch (error) {
                    console.error('Skipping tab during summarize all:', error);
                    failures.push(tab.title || tab.url);
                } finally {
                    setActionState(tab, 'summarizing', false);
                    renderTabs();
                }
            }

            if (!collectedSummaries.length) {
                throw new Error('No page summaries could be generated.');
            }

            setStatus('Building the workspace summary…', 'info');
            const workspaceSummary = await generateWorkspaceSummary(collectedSummaries, apiKey);
            const meta = failures.length
                ? `Generated from ${collectedSummaries.length} pages, skipped ${failures.length}.`
                : `Generated from ${collectedSummaries.length} captured pages.`;
            showSummaryPanel('Workspace Summary', meta, workspaceSummary);
            setStatus(
                failures.length
                    ? `Workspace summary ready. Skipped ${failures.length} page${failures.length === 1 ? '' : 's'}.`
                    : 'Workspace summary ready.',
                failures.length ? 'warning' : 'success'
            );
        } catch (error) {
            console.error('Error during summarize all:', error);
            setStatus(`Unable to build the workspace summary: ${error.message}`, 'error');
        } finally {
            elements.summarizeAllButton.disabled = false;
            renderTabs();
        }
    }

    async function generateSkillForTab(index) {
        const tab = state.savedTabs[index];
        setActionState(tab, 'skilling', true);
        renderTabs();

        try {
            const apiKey = requireApiKey();
            if (!window.USTPPageSkillModule) {
                throw new Error('Skill generation module failed to load.');
            }

            setStatus(`Generating a skill from ${tab.title || tab.url}…`, 'info');
            const content = await fetchContent(tab.url);
            const generatedSkill = await window.USTPPageSkillModule.generateSkillFromPage({
                title: tab.title,
                url: tab.url,
                content: content.kind === 'text' ? content.text : '',
                documentSource: content,
                apiKey
            });

            const storedSkill = {
                fileName: generatedSkill.fileName,
                skillName: generatedSkill.skillName,
                markdown: generatedSkill.markdown,
                generatedAt: new Date().toISOString()
            };

            state.savedTabs[index].skill = storedSkill;
            await persistTabs();
            renderSkillPreview(storedSkill);
            setStatus(`Skill ready for ${tab.title || tab.url}.`, 'success');
        } catch (error) {
            console.error('Error generating skill:', error);
            if (error.message !== 'Missing Gemini API key.') {
                setStatus(`Unable to generate a skill: ${error.message}`, 'error');
            }
        } finally {
            setActionState(tab, 'skilling', false);
            renderTabs();
        }
    }

    function openChatbot(index) {
        const tab = state.savedTabs[index];
        const chatUrl = `${chrome.runtime.getURL('chatbot.html')}?summary=${encodeURIComponent(tab.summary || '')}&url=${encodeURIComponent(tab.url)}`;
        chrome.tabs.create({ url: chatUrl });
    }

    async function deleteTab(index) {
        const deletedTab = state.savedTabs[index];
        state.savedTabs.splice(index, 1);
        await persistTabs();

        if (
            deletedTab?.skill &&
            state.activeSkillExport &&
            deletedTab.skill.generatedAt === state.activeSkillExport.generatedAt
        ) {
            clearSkillPreview();
        }

        if (!state.savedTabs.length) {
            resetSummaryPanel();
            clearSkillPreview();
            setStatus('Workspace is empty. Gather a new window from the popup to continue.', 'warning');
        } else {
            setStatus(`Removed ${deletedTab.title || deletedTab.url} from the workspace.`, 'info');
        }

        renderTabs();
    }

    function bindEvents() {
        elements.themeToggle.addEventListener('click', toggleTheme);
        elements.searchInput.addEventListener('input', (event) => {
            state.filterQuery = event.target.value;
            renderTabs();
        });
        elements.clearSearchButton.addEventListener('click', () => {
            state.filterQuery = '';
            elements.searchInput.value = '';
            renderTabs();
            setStatus('Filter cleared. Showing all captured tabs.', 'info');
        });
        elements.summarizeAllButton.addEventListener('click', summarizeAllTabs);
        elements.downloadSkillButton.addEventListener('click', downloadActiveSkill);
        elements.apiKeyInput.addEventListener('change', async () => {
            await setStorage({ [STORAGE_KEYS.apiKey]: elements.apiKeyInput.value.trim() });
            setStatus('Gemini API key saved for this extension.', 'success');
        });
    }

    async function initialize() {
        bindEvents();
        applyTheme(getTheme());

        const storageData = await getStorage([STORAGE_KEYS.savedTabs, STORAGE_KEYS.apiKey]);
        state.savedTabs = Array.isArray(storageData.savedTabs) ? storageData.savedTabs : [];
        elements.apiKeyInput.value = storageData.apiKey || '';

        if (!state.savedTabs.length) {
            setStatus('No captured tabs yet. Use the popup to gather your current window.', 'warning');
        } else {
            setStatus(`Loaded ${state.savedTabs.length} captured tab${state.savedTabs.length === 1 ? '' : 's'}.`, 'success');
        }

        renderTabs();
    }

    try {
        await initialize();
    } catch (error) {
        console.error('Unable to initialize the workspace:', error);
        setStatus(`Unable to initialize the workspace: ${error.message}`, 'error');
    }
});
