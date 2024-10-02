document.addEventListener('DOMContentLoaded', () => {
    const tabList = document.getElementById('tabList');
    const summarizeButton = document.getElementById('summarizeButton');
    const summaryDiv = document.getElementById('summary');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const themeToggle = document.getElementById('themeToggle');

    
    const summarizeAllButton = document.getElementById('summarizeAllButton');
    summarizeAllButton.addEventListener('click', summarizeAllTabs);

    if (summarizeAllButton) {
        summarizeAllButton.addEventListener('click', summarizeAllTabs);
    } else {
        console.error('Summarize All button not found');
    }

    async function summarizeAllTabs() {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            alert("Please enter your Google API key.");
            return;
        }

        if (summaryDiv) {
            summarizeAllButton.disabled = true;
            summaryDiv.textContent = "Generating summaries...";
        } else {
            console.error('Summary div not found');
            return;
        }

        try {
                    // Step 1: Summarize each page asynchronously
            // const summaryPromises = savedTabs.map(async (tab, index) => {
            //     const content = await fetchContent(tab.url);
            //     const summary = await generateSummary(content, apiKey);
            //     savedTabs[index].summary = summary;
            //     renderTabs(); // Update UI with individual summaries
            //     return summary;
            // });
            const existingSummaries = savedTabs.map(tab => tab.summary).filter(summary => summary);


            // const summaries = await Promise.all(summaryPromises);

            // Step 2: Summarize the summaries
            const finalSummary = await generateSummary(existingSummaries.join("\n\n"), apiKey);
        
            // Render the final summary as Markdown
            summaryDiv.innerHTML = marked.parse(finalSummary);

            // Save the updated tabs with summaries
            chrome.storage.local.set({ savedTabs: savedTabs });
        } catch (error) {
            console.error("Error generating summaries:", error);
            if (summaryDiv) {
                summaryDiv.textContent = "Error generating summaries. Please try again.";
            }
        } finally {
            if (summarizeAllButton) {
                summarizeAllButton.disabled = false;
            }
        }
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-theme');

            // Save the theme preference
            const isDarkTheme = document.body.classList.contains('dark-theme');
            localStorage.setItem('dark-theme', isDarkTheme);

            // Toggle the "Summarize All" button class
            const summarizeAllButton = document.getElementById('summarizeAllButton');
            summarizeAllButton.classList.toggle('dark-theme');
        });

        // Load saved theme preference
        const savedTheme = localStorage.getItem('dark-theme');
        if (savedTheme === 'true') {
            document.body.classList.add('dark-theme');
            const summarizeAllButton = document.getElementById('summarizeAllButton');
            summarizeAllButton.classList.add('dark-theme');
        }
    } else {
        console.error('Theme toggle button not found');
    }

    let savedTabs = [];

    function loadTabs() {
        chrome.storage.local.get("savedTabs", (data) => {
            if (data.savedTabs && data.savedTabs.length > 0) {
                savedTabs = data.savedTabs;
                renderTabs();
            } else {
                const li = document.createElement('li');
                li.textContent = "No tabs gathered.";
                tabList.appendChild(li);
            }
        });
    }

    function renderTabs() {
        tabList.innerHTML = ''; // Clear existing list
        savedTabs.forEach((tab, index) => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = tab.url;
            a.textContent = tab.title || tab.url;
            a.target = "_blank";
            
            const deleteButton = document.createElement('button');
            deleteButton.textContent = 'Delete';
            deleteButton.className = 'deleteButton';
            deleteButton.addEventListener('click', () => deleteTab(index));

            const summarizeButton = document.createElement('button');
            summarizeButton.textContent = 'Summarize';
            summarizeButton.className = 'summarizeButton';
            summarizeButton.addEventListener('click', () => summarizeTab(index));

            const chatButton = document.createElement('button');
            chatButton.textContent = 'Chat';
            chatButton.className = 'chatButton';
            chatButton.addEventListener('click', () => openChatbot(index));

            const summarySpan = document.createElement('span');
            summarySpan.className = 'tabSummary';
            summarySpan.innerHTML = tab.summary ? marked.parse(tab.summary) : '';

            li.appendChild(a);
            li.appendChild(deleteButton);
            li.appendChild(summarizeButton);
            li.appendChild(chatButton);
            li.appendChild(summarySpan);
            tabList.appendChild(li);
        });
    }

    function openChatbot(index) {
        const tab = savedTabs[index];
        const chatUrl = chrome.runtime.getURL('chatbot.html') + 
                        `?summary=${encodeURIComponent(tab.summary || '')}&url=${encodeURIComponent(tab.url)}`;
        chrome.tabs.create({ url: chatUrl });
    }

    function deleteTab(index) {
        savedTabs.splice(index, 1);
        chrome.storage.local.set({ savedTabs: savedTabs }, () => {
            renderTabs();
        });
    }

    async function summarizeTab(index) {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            alert("Please enter your Google API key.");
            return;
        }

        const tab = savedTabs[index];
        const content = await fetchContent(tab.url);
        const summary = await generateSummary(content, apiKey);
        savedTabs[index].summary = summary;
        chrome.storage.local.set({ savedTabs: savedTabs }, () => {
            renderTabs();
        });
    }
    
    loadTabs();

    summarizeButton.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            alert("Please enter your Google API key.");
            return;
        }

        summarizeButton.disabled = true;
        summaryDiv.textContent = "Generating summaries...";

        try {
            // Step 1: Summarize each page asynchronously
            const summaryPromises = savedTabs.map(async (tab, index) => {
                const content = await fetchContent(tab.url);
                const summary = await generateSummary(content, apiKey);
                savedTabs[index].summary = summary;
                renderTabs(); // Update UI with individual summaries
                return summary;
            });

            const summaries = await Promise.all(summaryPromises);

            // Step 2: Summarize the summaries
            const finalSummary = await generateSummary(summaries.join("\n\n"), apiKey);
            summaryDiv.textContent = "Final Summary:\n" + finalSummary;

            // Save the updated tabs with summaries
            chrome.storage.local.set({ savedTabs: savedTabs });
        } catch (error) {
            console.error("Error generating summaries:", error);
            summaryDiv.textContent = "Error generating summaries. Please try again.";
        } finally {
            summarizeButton.disabled = false;
        }
    });
});

async function fetchContent(url) {
    if (url.startsWith('chrome://')) {
        return `Unable to fetch content from ${url} due to browser restrictions.`;
    }
    try {
        const response = await fetch(url);
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        return doc.body.innerText;
    } catch (error) {
        console.error(`Error fetching content from ${url}:`, error);
        return `Error fetching content from ${url}`;
    }
}

async function generateSummary(content, apiKey, retries = 10) {
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';
    
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(`${apiUrl}?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `Summarize the following content like an expert in the field and make it concise and step by step using solid logic structure and format:\n\n${content}`
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 500,
                    },
                })
            });

            if (response.status === 429) {
                console.log(`Rate limit hit, retrying in ${2 ** i} seconds...`);
                await delay(2 ** i * 1000); // Exponential backoff
                continue;
            }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data.candidates[0].content.parts[0].text;
        } catch (error) {
            if (i === retries - 1) throw error; // Throw on last retry
            console.error("Error calling Gemini API:", error);
        }
    }
    throw new Error("Max retries reached. Please try again later.");
}

// async function summarizeAllTabs() {
//     const apiKey = apiKeyInput.value.trim();
//     if (!apiKey) {
//         alert("Please enter your Google API key.");
//         return;
//     }

//     if (summaryDiv) {
//         summarizeAllButton.disabled = true;
//         summaryDiv.textContent = "Generating summaries...";
//     } else {
//         console.error('Summary div not found');
//         return;
//     }

//     try {
//         // Step 1: Summarize each page asynchronously
//         const summaryPromises = savedTabs.map(async (tab, index) => {
//             const content = await fetchContent(tab.url);
//             const summary = await generateSummary(content, apiKey);
//             savedTabs[index].summary = summary;
//             renderTabs(); // Update UI with individual summaries
//             return summary;
//         });

//         const summaries = await Promise.all(summaryPromises);

//         // Step 2: Summarize the summaries
//         const finalSummary = await generateSummary(summaries.join("\n\n"), apiKey);

//         // Render the final summary as Markdown
//         summaryDiv.innerHTML = marked.parse(finalSummary);

//         // Save the updated tabs with summaries
//         chrome.storage.local.set({ savedTabs: savedTabs });
//     } catch (error) {
//         console.error("Error generating summaries:", error);
//         if (summaryDiv) {
//             summaryDiv.textContent = "Error generating summaries. Please try again.";
//         }
//     } finally {
//         if (summarizeAllButton) {
//             summarizeAllButton.disabled = false;
//         }
//     }
// }