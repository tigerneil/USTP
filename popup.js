// popup.js
console.log("Popup script loaded");

document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM content loaded');

    // Function to safely add event listener
    function addClickListener(id, callback) {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('click', callback);
            console.log(`Event listener added to ${id}`);
        } else {
            console.error(`Element with id "${id}" not found`);
        }
    }

    // Gather Tabs functionality
    addClickListener('gatherButton', function() {
        chrome.tabs.query({currentWindow: true}, function(tabs) {
            var tabsToSave = tabs.map(function(tab) {
                return {url: tab.url, title: tab.title};
            });
            chrome.storage.local.set({savedTabs: tabsToSave}, function() {
                console.log('Tabs saved');
                chrome.tabs.create({url: 'tablist.html'});
            });
        });
    });

    // Open Saved Tabs functionality
    addClickListener('openTablistButton', function() {
        chrome.tabs.create({url: 'tablist.html'});
    });

    console.log('Popup script finished executing');
});