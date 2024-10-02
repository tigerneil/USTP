document.addEventListener('DOMContentLoaded', () => {
    const chatbox = document.getElementById('chatbox');
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const themeToggle = document.getElementById('themeToggle');
    const generateAudioButton = document.getElementById('generateAudioButton');
    const audioLinkContainer = document.getElementById('audioLinkContainer');
    const audioControls = document.getElementById('audioControls');
    const progressBar = document.getElementById('progress');
    const playPauseButton = document.getElementById('playPauseButton');
    const stopButton = document.getElementById('stopButton');
    const restartButton = document.getElementById('restartButton');

    const urlParams = new URLSearchParams(window.location.search);
    const summary = urlParams.get('summary');
    const url = urlParams.get('url');

    let conversationHistory = [];
    let audioBlob = null;
    let audioElement = null;
    let isCancelled = false;

    // Load API key from storage
    chrome.storage.local.get(['apiKey'], function(result) {
        if (result.apiKey) {
            apiKeyInput.value = result.apiKey;
        }
    });

    // Save API key when it changes
    apiKeyInput.addEventListener('change', function() {
        const apiKey = apiKeyInput.value.trim();
        chrome.storage.local.set({apiKey: apiKey}, function() {
            console.log('API key saved');
        });
    });

    // Theme toggle functionality
    themeToggle.addEventListener('click', () => {
        document.documentElement.setAttribute('data-theme', 
            document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
        );
    });

    // Initialize chat with summary
    if (summary) {
        const initialMessage = `Here's a summary of the content from ${url}:\n\n${summary}\n\nHow can I assist you with this content?`;
        appendMessage('Bot', initialMessage, 'bot-message');
        conversationHistory.push({role: "model", parts: [{text: initialMessage}]});
    } else {
        appendMessage('Bot', `Welcome! I'm here to chat about the content from: ${url}. How can I assist you?`, 'bot-message');
    }

    sendButton.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    generateAudioButton.addEventListener('click', generateAudio);
    generateAudioButton.addEventListener('click', handleGenerateAudio);
    playPauseButton.addEventListener('click', togglePlayPause);
    stopButton.addEventListener('click', stopAudio);
    restartButton.addEventListener('click', restartAudio);

    async function sendMessage() {
        const message = userInput.value.trim();
        const apiKey = apiKeyInput.value.trim();
        if (message && apiKey) {
            appendMessage('You', message, 'user-message');
            userInput.value = '';
            conversationHistory.push({role: "user", parts: [{text: message}]});
            
            try {
                appendMessage('Bot', 'Thinking...', 'bot-message');
                const response = await generateResponse(apiKey, conversationHistory);
                // Remove the "Thinking..." message
                chatbox.removeChild(chatbox.lastChild);
                appendMessage('Bot', response, 'bot-message');
                conversationHistory.push({role: "model", parts: [{text: response}]});
            } catch (error) {
                console.error('Error generating response:', error);
                // Remove the "Thinking..." message
                chatbox.removeChild(chatbox.lastChild);
                appendMessage('Bot', `Sorry, I encountered an error: ${error.message}`, 'bot-message');
            }
        } else if (!apiKey) {
            alert("Please enter your Google API key.");
        }
    }

    async function handleGenerateAudio() {
        if (generateAudioButton.textContent === 'Generate Podcast') {
            isCancelled = false;
            generateAudioButton.textContent = 'Cancel Generation';
            audioLinkContainer.innerHTML = `
                <div id="progressBarContainer" style="width: 100%; background-color: #ddd; margin-bottom: 10px;">
                    <div id="progressBar" style="width: 0%; height: 20px; background-color: #4CAF50;"></div>
                </div>
                <div id="progressText">Generating podcast... 0% (Estimated time: calculating...)</div>
            `;
            try {
                await generateAudio();
            } catch (error) {
                if (!isCancelled) {
                    console.error('Error generating audio:', error);
                    audioLinkContainer.textContent = 'Error generating audio. Please try again.';
                }
            }
            generateAudioButton.textContent = 'Generate Podcast';
        } else {
            isCancelled = true;
            generateAudioButton.textContent = 'Generate Podcast';
            audioLinkContainer.textContent = 'Generation cancelled.';
        }
    }

    async function generateAudio() {
        const fullText = conversationHistory.map(entry => 
            `${entry.role === 'user' ? 'You' : 'Bot'}: ${entry.parts[0].text}`
        ).join('\n\n');

        const totalChars = fullText.length;
        const charsPerSecond = 15; // Adjust this based on your observed speech rate
        const estimatedTotalSeconds = totalChars / charsPerSecond;

        const utterance = new SpeechSynthesisUtterance(fullText);
        let startTime;
        let processedChars = 0;

        utterance.onstart = () => {
            startTime = Date.now();
        };

        utterance.onboundary = (event) => {
            if (isCancelled) {
                speechSynthesis.cancel();
                throw new Error('Generation cancelled');
            }

            processedChars = event.charIndex;
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            const progress = (processedChars / totalChars) * 100;
            const remainingSeconds = estimatedTotalSeconds - elapsedSeconds;

            updateProgress(progress, remainingSeconds);
        };

        await new Promise((resolve, reject) => {
            utterance.onend = resolve;
            utterance.onerror = reject;
            speechSynthesis.speak(utterance);
        });

        if (isCancelled) throw new Error('Generation cancelled');

        // Here you would implement the logic to convert the speech to an audio file
        // For demonstration, we'll create a dummy audio blob
        const audioBlob = new Blob([new ArrayBuffer(1000)], { type: 'audio/mp3' });
        
        const audioUrl = URL.createObjectURL(audioBlob);
        const downloadLink = document.createElement('a');
        downloadLink.href = audioUrl;
        downloadLink.download = 'chat_podcast.mp3';
        downloadLink.textContent = 'Download Podcast (MP3)';
        
        audioLinkContainer.innerHTML = '';
        audioLinkContainer.appendChild(downloadLink);
    }

    function updateProgress(progress, remainingSeconds) {
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        
        progressBar.style.width = `${progress}%`;
        
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = Math.floor(remainingSeconds % 60);
        const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        progressText.textContent = `Generating podcast... ${Math.round(progress)}% (Estimated time remaining: ${timeString})`;
    }

    function textToAudioBuffer(audioContext, utterance) {
        return new Promise((resolve) => {
            const audioChunks = [];
            const sampleRate = audioContext.sampleRate;
            const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (event) => {
                const channel = event.outputBuffer.getChannelData(0);
                audioChunks.push(new Float32Array(channel));
            };

            utterance.onend = () => {
                scriptProcessor.disconnect();
                const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const audioBuffer = audioContext.createBuffer(1, totalLength, sampleRate);
                let offset = 0;
                for (const chunk of audioChunks) {
                    audioBuffer.copyToChannel(chunk, 0, offset);
                    offset += chunk.length;
                }
                resolve(audioBuffer);
            };

            const dummySource = audioContext.createBufferSource();
            dummySource.connect(scriptProcessor).connect(audioContext.destination);
            dummySource.start();

            speechSynthesis.speak(utterance);
        });
    }

    function concatenateAudioBuffers(audioContext, buffers) {
        const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
        const finalBuffer = audioContext.createBuffer(
            1,
            totalLength,
            audioContext.sampleRate
        );

        let offset = 0;
        for (const buffer of buffers) {
            finalBuffer.copyToChannel(buffer.getChannelData(0), 0, offset);
            offset += buffer.length;
        }

        return finalBuffer;
    }

    function audioBufferToWav(buffer) {
        const numOfChan = buffer.numberOfChannels;
        const length = buffer.length * numOfChan * 2 + 44;
        const arrayBuffer = new ArrayBuffer(length);
        const view = new DataView(arrayBuffer);
        const channels = [];
        let sample;
        let offset = 0;
        let pos = 0;

        // Write WAV header
        setUint32(0x46464952);  // "RIFF"
        setUint32(length - 8);  // file length - 8
        setUint32(0x45564157);  // "WAVE"
        setUint32(0x20746d66);  // "fmt " chunk
        setUint32(16);          // length = 16
        setUint16(1);           // PCM (uncompressed)
        setUint16(numOfChan);
        setUint32(buffer.sampleRate);
        setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
        setUint16(numOfChan * 2);  // block-align
        setUint16(16);          // 16-bit
        setUint32(0x61746164);  // "data" chunk
        setUint32(length - pos - 4);  // chunk length

        for (let i = 0; i < buffer.numberOfChannels; i++) {
            channels.push(buffer.getChannelData(i));
        }

        while (pos < length) {
            for (let i = 0; i < numOfChan; i++) {
                sample = Math.max(-1, Math.min(1, channels[i][offset]));
                sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
                view.setInt16(pos, sample, true);
                pos += 2;
            }
            offset++;
        }

        return new Blob([arrayBuffer], { type: "audio/wav" });

        function setUint16(data) {
            view.setUint16(pos, data, true);
            pos += 2;
        }

        function setUint32(data) {
            view.setUint32(pos, data, true);
            pos += 4;
        }
    }

    function togglePlayPause() {
        if (audioElement) {
            if (audioElement.paused) {
                audioElement.play();
                playPauseButton.textContent = 'Pause';
            } else {
                audioElement.pause();
                playPauseButton.textContent = 'Play';
            }
        }
    }

    function stopAudio() {
        if (audioElement) {
            audioElement.pause();
            audioElement.currentTime = 0;
            playPauseButton.textContent = 'Play';
            updateProgressBar();
        }
    }

    function restartAudio() {
        if (audioElement) {
            audioElement.currentTime = 0;
            audioElement.play();
            playPauseButton.textContent = 'Pause';
        }
    }

    function updateProgressBar() {
        if (audioElement) {
            const progress = (audioElement.currentTime / audioElement.duration) * 100;
            progressBar.style.width = `${progress}%`;
        }
    }

    function resetAudio() {
        playPauseButton.textContent = 'Play';
        progressBar.style.width = '0%';
    }

    function appendMessage(sender, message, className) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${className}`;
        
        const senderElement = document.createElement('strong');
        senderElement.textContent = `${sender}:`;
        messageElement.appendChild(senderElement);

        const contentElement = document.createElement('div');
        contentElement.className = 'message-content';
        contentElement.innerHTML = marked.parse(message);
        messageElement.appendChild(contentElement);

        chatbox.appendChild(messageElement);
        chatbox.scrollTop = chatbox.scrollHeight;
        
        // Apply syntax highlighting to code blocks
        messageElement.querySelectorAll('pre code').forEach((block) => {
            Prism.highlightElement(block);
        });
    }

    async function generateResponse(apiKey, history) {
        const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';
        
        console.log('Sending request to Gemini Pro API...');
        console.log('Conversation history:', history);

        const response = await fetch(`${apiUrl}?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: history,
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 1000,
                },
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API response:', response.status, errorText);
            throw new Error(`HTTP error! status: ${response.status}. ${errorText}`);
        }

        const data = await response.json();
        console.log('API response data:', data);

        if (!data.candidates || data.candidates.length === 0) {
            throw new Error('No response generated by the model.');
        }

        return data.candidates[0].content.parts[0].text;
    }

    // Configure marked options
    marked.setOptions({
        breaks: true,
        gfm: true,
        highlight: function (code, lang) {
            if (Prism.languages[lang]) {
                return Prism.highlight(code, Prism.languages[lang], lang);
            }
            return code;
        }
    });
});