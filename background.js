// background.js
console.log("Background script loaded");

function gatherTabs() {
    console.log("Gathering tabs...");
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
            console.error("Error querying tabs:", chrome.runtime.lastError);
            return;
        }

        const tabUrls = tabs.map(t => ({ url: t.url, title: t.title }));
        console.log("Tabs found:", tabUrls.length);

        chrome.storage.local.set({ savedTabs: tabUrls }, () => {
            if (chrome.runtime.lastError) {
                console.error("Error saving tabs:", chrome.runtime.lastError);
            } else {
                console.log("Tabs saved successfully. Count:", tabUrls.length);
                // Close all tabs except the first one
                const tabIdsToClose = tabs.slice(1).map(tab => tab.id);
                chrome.tabs.remove(tabIdsToClose, () => {
                    // Update the first tab with the list of saved tabs
                    chrome.tabs.update(tabs[0].id, { url: chrome.runtime.getURL("tablist.html") });
                });
            }
        });
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Message received:", request.action);
    if (request.action === "getSavedTabs") {
        chrome.storage.local.get("savedTabs", (data) => {
            console.log("Retrieving saved tabs:", data.savedTabs ? data.savedTabs.length : "undefined");
            sendResponse({ savedTabs: data.savedTabs || [] });
        });
        return true;
    } else if (request.action === "gatherTabs") {
        gatherTabs();
        sendResponse({ status: "Gathering tabs initiated" });
        return true;
    }
});

chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.create({url: 'tablist.html'});
});