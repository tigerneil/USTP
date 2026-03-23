document.addEventListener('DOMContentLoaded', async () => {
    const elements = {
        gatherButton: document.getElementById('gatherButton'),
        openTablistButton: document.getElementById('openTablistButton'),
        windowTabCount: document.getElementById('windowTabCount'),
        savedTabCount: document.getElementById('savedTabCount'),
        apiKeyState: document.getElementById('apiKeyState'),
        popupStatus: document.getElementById('popupStatus'),
        popupFootnote: document.getElementById('popupFootnote'),
        readinessBadge: document.getElementById('readinessBadge'),
        readinessMeterFill: document.getElementById('readinessMeterFill'),
        captureState: document.getElementById('captureState'),
        workspaceState: document.getElementById('workspaceState'),
        intelligenceState: document.getElementById('intelligenceState'),
        nextActionHeading: document.getElementById('nextActionHeading'),
        nextActionBody: document.getElementById('nextActionBody')
    };

    const STORAGE_KEYS = {
        apiKey: 'apiKey',
        savedTabs: 'savedTabs',
        lastCapturedAt: 'lastCapturedAt'
    };

    function getStorage(keys) {
        return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
    }

    function setStorage(items) {
        return new Promise((resolve) => chrome.storage.local.set(items, resolve));
    }

    function queryCurrentWindowTabs() {
        return new Promise((resolve, reject) => {
            chrome.tabs.query({ currentWindow: true }, (tabs) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                resolve(tabs);
            });
        });
    }

    function formatTimestamp(timestamp) {
        if (!timestamp) {
            return 'No capture yet';
        }

        try {
            return `Last capture ${new Date(timestamp).toLocaleString()}`;
        } catch (error) {
            return 'Last capture unavailable';
        }
    }

    function setFlowState(element, label, tone) {
        element.textContent = label;
        element.dataset.tone = tone;
    }

    function setReadinessState(readinessScore, hasWorkspace, hasApiKey) {
        const readinessPercent = Math.max(0, Math.min(100, (readinessScore / 3) * 100));
        elements.readinessMeterFill.style.width = `${readinessPercent}%`;

        if (hasWorkspace && hasApiKey) {
            elements.readinessBadge.textContent = 'Workspace Ready';
            elements.readinessBadge.dataset.tone = 'ready';
            return;
        }

        if (hasWorkspace || hasApiKey) {
            elements.readinessBadge.textContent = 'Partially Ready';
            elements.readinessBadge.dataset.tone = 'partial';
            return;
        }

        elements.readinessBadge.textContent = 'Needs Setup';
        elements.readinessBadge.dataset.tone = 'setup';
    }

    function updateNextAction(savedTabsCount, hasApiKey, currentWindowCount) {
        if (!currentWindowCount) {
            elements.nextActionHeading.textContent = 'Open tabs first';
            elements.nextActionBody.textContent = 'There are no tabs in the current window to capture yet.';
            return;
        }

        if (!savedTabsCount) {
            elements.nextActionHeading.textContent = 'Capture this window';
            elements.nextActionBody.textContent = 'Start by saving the current window into a focused workspace, then review it in the workspace view.';
            return;
        }

        if (!hasApiKey) {
            elements.nextActionHeading.textContent = 'Connect Gemini';
            elements.nextActionBody.textContent = 'Open the workspace and add your Gemini API key to unlock summaries, live article chat, PDF analysis, and skill generation.';
            return;
        }

        elements.nextActionHeading.textContent = 'Open the cockpit';
        elements.nextActionBody.textContent = 'Your workspace is ready. Jump into summaries, live source chat, or turn the strongest page into a reusable SKILL.md.';
    }

    function updateActionCopy(isBusy) {
        const gatherTitle = elements.gatherButton.querySelector('.action-copy strong');
        const gatherBody = elements.gatherButton.querySelector('.action-copy span');
        const openTitle = elements.openTablistButton.querySelector('.action-copy strong');
        const openBody = elements.openTablistButton.querySelector('.action-copy span');

        gatherTitle.textContent = isBusy ? 'Gathering Tabs…' : 'Gather This Window';
        gatherBody.textContent = isBusy
            ? 'Saving the current window and preparing the workspace.'
            : 'Capture the current tabs and jump into a focused workspace.';
        openTitle.textContent = 'Open Workspace';
        openBody.textContent = 'Review saved tabs, summarize content, and build page skills.';
    }

    function setBusyState(isBusy, message) {
        elements.gatherButton.disabled = isBusy;
        updateActionCopy(isBusy);
        elements.popupStatus.textContent = message;
    }

    async function refreshPopupStats() {
        const [storageData, tabs] = await Promise.all([
            getStorage([STORAGE_KEYS.savedTabs, STORAGE_KEYS.apiKey, STORAGE_KEYS.lastCapturedAt]),
            queryCurrentWindowTabs()
        ]);

        const savedTabs = Array.isArray(storageData.savedTabs) ? storageData.savedTabs : [];
        const hasApiKey = Boolean(storageData.apiKey);
        const savedTabsCount = savedTabs.length;
        const currentWindowCount = tabs.length;
        const readinessScore = Number(currentWindowCount > 0) + Number(savedTabsCount > 0) + Number(hasApiKey);

        elements.windowTabCount.textContent = String(currentWindowCount);
        elements.savedTabCount.textContent = String(savedTabsCount);
        elements.apiKeyState.textContent = hasApiKey ? 'Ready' : 'No';
        elements.popupFootnote.textContent = formatTimestamp(storageData.lastCapturedAt);

        setReadinessState(readinessScore, savedTabsCount > 0, hasApiKey);
        setFlowState(
            elements.captureState,
            currentWindowCount ? `${currentWindowCount} tabs visible` : 'No tabs found',
            currentWindowCount ? 'ready' : 'warning'
        );
        setFlowState(
            elements.workspaceState,
            savedTabsCount ? `${savedTabsCount} pages saved` : 'Waiting for capture',
            savedTabsCount ? 'ready' : 'warning'
        );
        setFlowState(
            elements.intelligenceState,
            hasApiKey ? 'Gemini ready' : 'API key missing',
            hasApiKey ? 'ready' : 'warning'
        );
        updateNextAction(savedTabsCount, hasApiKey, currentWindowCount);

        if (!savedTabsCount) {
            elements.popupStatus.textContent = currentWindowCount
                ? 'No workspace captured yet. Save this window to start turning tabs into a working brief.'
                : 'Open a few tabs, then capture the window to start a workspace.';
            return;
        }

        if (!hasApiKey) {
            elements.popupStatus.textContent = `Workspace ready with ${savedTabsCount} captured page${savedTabsCount === 1 ? '' : 's'}. Add a Gemini API key in the workspace to unlock analysis.`;
            return;
        }

        elements.popupStatus.textContent = `Workspace ready with ${savedTabsCount} captured page${savedTabsCount === 1 ? '' : 's'} and Gemini connected.`;
    }

    elements.gatherButton.addEventListener('click', async () => {
        try {
            setBusyState(true, 'Capturing your current window and opening the workspace…');
            const tabs = await queryCurrentWindowTabs();
            const tabsToSave = tabs
                .filter((tab) => Boolean(tab.url))
                .map((tab) => ({
                    url: tab.url,
                    title: tab.title
                }));

            await setStorage({
                [STORAGE_KEYS.savedTabs]: tabsToSave,
                [STORAGE_KEYS.lastCapturedAt]: new Date().toISOString()
            });
            await refreshPopupStats();
            chrome.tabs.create({ url: 'tablist.html' });
            setBusyState(false, 'Workspace captured. Opening the saved tabs view…');
        } catch (error) {
            console.error('Unable to gather tabs:', error);
            setBusyState(false, `Unable to gather tabs: ${error.message}`);
        }
    });

    elements.openTablistButton.addEventListener('click', () => {
        elements.popupStatus.textContent = 'Opening the workspace view…';
        chrome.tabs.create({ url: 'tablist.html' });
    });

    try {
        updateActionCopy(false);
        await refreshPopupStats();
    } catch (error) {
        console.error('Unable to load popup stats:', error);
        elements.popupStatus.textContent = `Unable to load workspace stats: ${error.message}`;
        elements.popupFootnote.textContent = 'Status unavailable';
    }
});
