// Frontend voice handling, audio visualization and backend integration
// Moved from template and adapted to call Flask endpoint /process-voice

// 全局变量
let recognition;
let isWakeUp = false;
let isListening = false;
let analyser;
let microphone;
let animationId;
let backendApiUrl = "/process-voice"; // local Flask endpoint

// Global settings (will be initialized on DOMContentLoaded)
let wakeWord = '你好助手';
let wakeTimeout = 5; // seconds
let quickWake = false;
let wakeTimer = null;
let manualDebugEnabled = false; // new: whether manual debug input is visible
let isProcessingManualCommand = false; // new: whether we're processing a manual command
// TTS settings - constants extracted from model documentation
// Will be populated from API
let SUPPORTED_LANGUAGES = [];

// Will be populated from API
let SUPPORTED_VOICES = [];

// Configuration object to store settings from API
let appConfig = null;

// TTS settings
let ttsEnabled = false; // whether qwen3-tts-flash is enabled
let ttsLanguage = 'Chinese'; // TTS language type
let ttsVoice = 'Cherry'; // TTS voice

// Audio streaming variables
let audioContext = null; // Global audio context for both visualization and TTS
let audioQueue = [];
let isPlaying = false;
let isStreaming = false; // Track if qwen3-tts-flash is streaming
let currentAudioSource = null;
let audioBuffer = [];
let audioChunks = []; // Store audio chunks for qwen3-tts-flash
let audioSources = []; // Track all audio sources for stopping
let audioBlobParts = []; // 用于存储音频块，合并后播放
let isAudioPlaying = false; // 标记是否正在播放合并后的音频
let currentAudioElement = null; // Track the current Audio element for immediate stop
let isUserStoppingAudio = false; // 标记是否是用户主动停止音频

// DOM元素 (will be assigned after DOM is ready)
let statusIndicator;
let statusText;
let voiceWaveContainer;
let recognitionResult;
let assistantResponse;
let manualWakeupBtn;
let clearBtn;
let historyContainer;

// Function to fetch configuration from API
async function fetchConfig() {
    try {
        console.log('Fetching configuration from API...');
        const response = await fetch('/config');
        if (!response.ok) {
            throw new Error(`Failed to fetch config: ${response.status}`);
        }
        appConfig = await response.json();
        
        // Populate supported languages and voices from API
        SUPPORTED_LANGUAGES = appConfig.SUPPORTED_LANGUAGES || [];
        SUPPORTED_VOICES = appConfig.SUPPORTED_VOICES || [];
        
        // Update default settings from API
        if (appConfig.DEFAULT_WAKE_WORD) {
            wakeWord = appConfig.DEFAULT_WAKE_WORD;
        }
        if (appConfig.DEFAULT_WAKE_TIMEOUT) {
            wakeTimeout = appConfig.DEFAULT_WAKE_TIMEOUT;
        }
        
        console.log('Configuration fetched successfully:', {
            languages: SUPPORTED_LANGUAGES.length,
            voices: SUPPORTED_VOICES.length,
            defaultWakeWord: wakeWord,
            defaultWakeTimeout: wakeTimeout
        });
        
        return true;
    } catch (error) {
        console.error('Error fetching configuration:', error);
        // Use default values if API fails
        console.log('Using default configuration values');
        return false;
    }
}

// Single DOM-ready initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Fetch configuration from API first
    await fetchConfig();
    
    // assign DOM elements after DOMContentLoaded to avoid nulls
    statusIndicator = document.getElementById('status-indicator');
    statusText = document.getElementById('status-text');
    voiceWaveContainer = document.querySelector('#voice-wave-container .flex');
    recognitionResult = document.getElementById('recognition-result');
    assistantResponse = document.getElementById('assistant-response');
    manualWakeupBtn = document.getElementById('manual-wakeup-btn');
    clearBtn = document.getElementById('clear-btn');
    historyContainer = document.getElementById('history-container');

    // settings UI elements
    const settingsToggle = document.getElementById('settings-toggle');
    const settingsSidebar = document.getElementById('settings-sidebar');
    const settingsClose = document.getElementById('settings-close');
    const wakeWordInput = document.getElementById('wake-word-input');
    const wakeTimeoutInput = document.getElementById('wake-timeout-input');
    const quickWakeToggle = document.getElementById('quick-wake-toggle');
    const wakeWordSave = document.getElementById('wake-word-save');
    const wakeWordMessage = document.getElementById('wake-word-message');
    const currentWakeWordDisplay = document.getElementById('current-wake-word');
    const appEl = document.getElementById('app');

    // manual debug elements
    const debugManualToggle = document.getElementById('debug-manual-toggle');
    const manualDebugArea = document.getElementById('manual-debug-area');
    const manualCommandInput = document.getElementById('manual-command-input');
    const manualCommandSend = document.getElementById('manual-command-send');

    // load persisted settings or fallback to dataset or defaults
    try {
        const lsWake = localStorage.getItem('yv_wake_word');
        const lsTimeout = localStorage.getItem('yv_wake_timeout');
        const lsQuick = localStorage.getItem('yv_quick_wake');
        const lsManualDebug = localStorage.getItem('yv_manual_debug');
        // TTS settings
        const lsTtsEnabled = localStorage.getItem('yv_tts_enabled');
        const lsTtsLanguage = localStorage.getItem('yv_tts_language');
        const lsTtsVoice = localStorage.getItem('yv_tts_voice');
        
        if (lsWake) wakeWord = lsWake;
        else if (appEl && appEl.dataset && appEl.dataset.wakeWord) wakeWord = appEl.dataset.wakeWord;
        if (lsTimeout) wakeTimeout = parseInt(lsTimeout, 10) || wakeTimeout;
        if (lsQuick) quickWake = lsQuick === 'true';
        if (lsManualDebug) manualDebugEnabled = lsManualDebug === 'true';
        if (lsTtsEnabled) ttsEnabled = lsTtsEnabled === 'true';
        if (lsTtsLanguage) ttsLanguage = lsTtsLanguage;
        if (lsTtsVoice) ttsVoice = lsTtsVoice;
    } catch (e) {
        console.warn('localStorage unavailable:', e);
    }

    // populate settings UI
    if (wakeWordInput) wakeWordInput.value = wakeWord;
    if (wakeTimeoutInput) wakeTimeoutInput.value = wakeTimeout;
    if (quickWakeToggle) quickWakeToggle.checked = quickWake;
    if (currentWakeWordDisplay) currentWakeWordDisplay.textContent = wakeWord;
    if (debugManualToggle) debugManualToggle.checked = manualDebugEnabled;
    if (manualDebugArea) {
        if (manualDebugEnabled) manualDebugArea.classList.remove('hidden');
        else manualDebugArea.classList.add('hidden');
    }
    
    // TTS settings UI
    const ttsEnabledToggle = document.getElementById('tts-enabled-toggle');
    const ttsLanguageSelect = document.getElementById('tts-language-select');
    const ttsVoiceSelect = document.getElementById('tts-voice-select');
    
    // Populate language options dynamically from SUPPORTED_LANGUAGES constant
    if (ttsLanguageSelect) {
        ttsLanguageSelect.innerHTML = '';
        SUPPORTED_LANGUAGES.forEach(lang => {
            const option = document.createElement('option');
            option.value = lang.value;
            option.textContent = lang.label;
            ttsLanguageSelect.appendChild(option);
        });
        // Set current value
        ttsLanguageSelect.value = ttsLanguage;
    }
    
    // Populate voice options dynamically from SUPPORTED_VOICES constant
    if (ttsVoiceSelect) {
        ttsVoiceSelect.innerHTML = '';
        SUPPORTED_VOICES.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.value;
            option.textContent = `${voice.name} - ${voice.description}`;
            ttsVoiceSelect.appendChild(option);
        });
        // Set current value
        ttsVoiceSelect.value = ttsVoice;
    }
    
    if (ttsEnabledToggle) ttsEnabledToggle.checked = ttsEnabled;

    // ensure sidebar initial transform is set if not defined
    if (settingsSidebar && !settingsSidebar.style.transform) {
        settingsSidebar.style.transform = 'translateX(100%)';
    }

    // settings open/close handlers - use style.transform to avoid Tailwind class mismatch
    if (settingsToggle && settingsSidebar) {
        settingsToggle.addEventListener('click', () => {
            settingsSidebar.style.transform = 'translateX(0)';
        });
    }
    if (settingsClose && settingsSidebar) {
        settingsClose.addEventListener('click', () => {
            settingsSidebar.style.transform = 'translateX(100%)';
        });
    }

    // manual debug toggle handler
    if (debugManualToggle && manualDebugArea) {
        debugManualToggle.addEventListener('change', () => {
            manualDebugEnabled = !!debugManualToggle.checked;
            if (manualDebugEnabled) {
                manualDebugArea.classList.remove('hidden');
            } else {
                manualDebugArea.classList.add('hidden');
            }
            try {
                localStorage.setItem('yv_manual_debug', String(manualDebugEnabled));
            } catch (e) {
                console.warn('localStorage unavailable:', e);
            }
        });
    }

    // manual send handler
    if (manualCommandSend && manualCommandInput) {
        manualCommandSend.addEventListener('click', () => {
            const raw = (manualCommandInput.value || '').trim();
            const cmd = sanitizeCommand(raw);
            if (!cmd) {
                // show small feedback
                updateRecognitionResult('请输入有效的指令再发送。', false);
                return;
            }
            // wake assistant for visibility and then process
            wakeUpAssistant();
            isProcessingManualCommand = true;
            processCommand(cmd).finally(() => {
                isProcessingManualCommand = false;
            });
            manualCommandInput.value = '';
        });

        // also allow Enter key to send
        manualCommandInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                manualCommandSend.click();
            }
        });
    }

    // save settings
    if (wakeWordSave) {
        wakeWordSave.addEventListener('click', () => {
            const newWake = (wakeWordInput && wakeWordInput.value.trim()) || wakeWord;
            const newTimeout = Math.max(1, parseInt((wakeTimeoutInput && wakeTimeoutInput.value), 10) || wakeTimeout);
            const newQuick = !!(quickWakeToggle && quickWakeToggle.checked);
            const newManualDebug = !!(debugManualToggle && debugManualToggle.checked);
            
            // TTS settings
            const ttsEnabledToggle = document.getElementById('tts-enabled-toggle');
            const ttsLanguageSelect = document.getElementById('tts-language-select');
            const ttsVoiceSelect = document.getElementById('tts-voice-select');
            
            const newTtsEnabled = !!(ttsEnabledToggle && ttsEnabledToggle.checked);
            const newTtsLanguage = (ttsLanguageSelect && ttsLanguageSelect.value) || ttsLanguage;
            const newTtsVoice = (ttsVoiceSelect && ttsVoiceSelect.value) || ttsVoice;
            
            wakeWord = newWake;
            wakeTimeout = newTimeout;
            quickWake = newQuick;
            manualDebugEnabled = newManualDebug;
            // Update TTS settings
            ttsEnabled = newTtsEnabled;
            ttsLanguage = newTtsLanguage;
            ttsVoice = newTtsVoice;
            
            if (currentWakeWordDisplay) currentWakeWordDisplay.textContent = wakeWord;

            // persist
            try {
                localStorage.setItem('yv_wake_word', wakeWord);
                localStorage.setItem('yv_wake_timeout', String(wakeTimeout));
                localStorage.setItem('yv_quick_wake', String(quickWake));
                localStorage.setItem('yv_manual_debug', String(manualDebugEnabled));
                // Persist TTS settings
                localStorage.setItem('yv_tts_enabled', String(ttsEnabled));
                localStorage.setItem('yv_tts_language', ttsLanguage);
                localStorage.setItem('yv_tts_voice', ttsVoice);
            } catch (e) {
                console.warn('localStorage unavailable:', e);
            }

            // feedback
            if (wakeWordMessage) {
                wakeWordMessage.classList.remove('hidden');
                wakeWordMessage.textContent = '已保存';
                setTimeout(() => {
                    wakeWordMessage.classList.add('hidden');
                }, 1500);
            }
        });
    }

    initSpeechSynthesis();
    initVoiceRecognition();
    initAudioVisualization();
    createWaveBars();
    setupEventListeners();
});

// 初始化语音识别
function initVoiceRecognition() {
    // 检查浏览器是否支持Web Speech API
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.warn('Web Speech API 不受支持');
        updateRecognitionResult('当前浏览器不支持语音识别', false);
        return;
    }

    // 创建语音识别实例
    recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;

    // 语音识别结果处理
    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        // 遍历所有结果
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        // 更新UI显示
        if (finalTranscript) {
            handleFinalTranscript(finalTranscript);
        } else if (interimTranscript) {
            updateRecognitionResult(interimTranscript, true);
        }
    };

    // 语音识别错误处理：对于network等错误，尝试重启识别
    recognition.onerror = (event) => {
        console.error('语音识别错误:', event.error);
        updateStatus('识别错误: ' + event.error, 'error');
        if (event.error === 'not-allowed') {
            updateRecognitionResult('请允许浏览器访问麦克风权限以使用语音识别功能。', false);
        }
        // 尝试在短暂延迟后重启识别（防抖）
        setTimeout(() => {
            try {
                if (!isListening) startListening();
            } catch (e) {
                console.warn('重启识别失败:', e);
            }
        }, 500);
    };

    // 语音识别结束处理：始终尝试重启识别，保证后台持续监听唤醒词
    recognition.onend = () => {
        isListening = false;
        stopAudioVisualization();
        // 确保持续监听（无论当前是否唤醒），以便唤醒词仍可被检测
        // 但如果正在处理手动命令，则不自动重启识别
        setTimeout(() => {
            try {
                if (!isListening && !isProcessingManualCommand) startListening();
            } catch (e) {
                console.warn('重启识别失败(onend):', e);
            }
        }, 200);

        // 更新状态文本
        if (isWakeUp) {
            updateStatus('已唤醒，正在聆听...', 'active');
        } else {
            updateStatus('等待唤醒...', 'idle');
        }
    };

    // 开始初始监听(用于唤醒词检测)
    startListening();
}

// 初始化音频可视化
function initAudioVisualization() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
    } catch (error) {
        console.error('无法初始化音频可视化:', error);
    }
}

// 请求麦克风权限并连接到音频分析器
async function connectMicrophone() {
    try {
        if (!audioContext) return false;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);
        return true;
    } catch (error) {
        console.error('无法访问麦克风:', error);
        return false;
    }
}

// 开始音频可视化
async function startAudioVisualization() {
    if (!analyser) return;
    if (!microphone && !(await connectMicrophone())) {
        return;
    }
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }
    visualizeAudio();
}

// 停止音频可视化
function stopAudioVisualization() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    const waveBars = document.querySelectorAll('.wave-bar');
    waveBars.forEach(bar => {
        bar.style.height = '20%';
    });
}

// 音频可视化动画
function visualizeAudio() {
    if (!analyser) return;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const waveBars = document.querySelectorAll('.wave-bar');
    const barCount = Math.min(waveBars.length, bufferLength);

    function animate() {
        animationId = requestAnimationFrame(animate);
        analyser.getByteFrequencyData(dataArray);
        for (let i = 0; i < barCount; i++) {
            const value = dataArray[i];
            const height = Math.max(20, (value / 255) * 100); // 最小高度20%
            waveBars[i].style.height = `${height}%`;
        }
    }

    animate();
}

// 创建波形条
function createWaveBars() {
    if (!voiceWaveContainer) return;
    voiceWaveContainer.innerHTML = '';
    for (let i = 0; i < 20; i++) {
        const bar = document.createElement('div');
        bar.className = 'wave-bar';
        bar.style.setProperty('--speed', `${1 + Math.random() * 0.5}s`);
        bar.style.setProperty('--delay', `${i * 0.05}s`);
        voiceWaveContainer.appendChild(bar);
    }
}

// 设置事件监听器
function setupEventListeners() {
    if (manualWakeupBtn) {
        manualWakeupBtn.addEventListener('click', () => {
            if (!isWakeUp) {
                wakeUpAssistant();
            } else {
                resetAssistant();
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', clearAll);
    }
    
    // Voice control button setup
    const voiceControlBtn = document.getElementById('voice-control-btn');
    if (voiceControlBtn) {
        voiceControlBtn.addEventListener('click', function() {
            // Check if either native speech or streaming or audio is active
            if (speechSynthesis.speaking || isStreaming || isAudioPlaying || audioSources.length > 0) {
                // Stop all speech synthesis (native and streaming)
                stopAllSpeech();
                this.textContent = '🔊 播放语音';
            } else {
                const responseText = document.getElementById('assistant-response').textContent;
                if (responseText && !responseText.includes('助手将在这里回复')) {
                    speakText(responseText);
                    this.textContent = '⏹️ 停止语音';
                }
            }
        });
    }
}

// 开始监听
function startListening() {
    if (isListening || !recognition) return;
    try {
        recognition.start();
        isListening = true;
        if (isWakeUp) {
            startAudioVisualization();
        }
    } catch (error) {
        console.error('无法开始识别:', error);
        // 有些情况下需要延迟后重试
        setTimeout(() => {
            startListening();
        }, 500);
    }
}

// 停止监听
function stopListening() {
    if (!isListening || !recognition) return;
    try {
        recognition.stop();
        isListening = false;
        stopAudioVisualization();
    } catch (error) {
        console.error('无法停止识别:', error);
    }
}

// Utility: remove surrounding punctuation and whitespace from candidate commands
function sanitizeCommand(text) {
    if (!text) return '';
    // Remove surrounding whitespace and common punctuation (English + Chinese)
    let result = text.replace(/^[\s\.\,\!\?\;\:\-\u2014\u3000\u2014\uff0c\u3002\uff01\uff1f\u3001\uff1b\uff1a\-|"'\u201c\u201d\u2018\u2019]+|[\s\.\,\!\?\;\:\-\u2014\u3000\u2014\uff0c\u3002\uff01\uff1f\u3001\uff1b\uff1a\-|"'\u201c\u201d\u2018\u2019]+$/g, '').trim();
    // If the remaining string contains no letters or digits, treat as empty (prevents single punctuation like '.' being used)
    try {
        if (!/[\p{L}\p{N}]/u.test(result)) return '';
    } catch (e) {
        // In case the environment doesn't support Unicode property escapes, fall back to a basic test
        if (!/[A-Za-z0-9\u4e00-\u9fa5]/.test(result)) return '';
    }
    return result;
}

// Modified handleFinalTranscript to support quick-wake and ignore punctuation-only remainders
function handleFinalTranscript(transcript) {
    transcript = transcript.trim();
    if (!transcript) return;

    const lowerTranscript = transcript.toLowerCase();
    const lowerWake = wakeWord.toLowerCase();

    // Quick-wake: if enabled and the sentence starts with wake word, treat remainder as command (if meaningful)
    if (!isWakeUp && quickWake && lowerTranscript.startsWith(lowerWake)) {
        let command = transcript.substring(lowerWake.length).trim();
        command = sanitizeCommand(command);
        wakeUpAssistant();
        if (command) {
            processCommand(command);
        }
        return;
    }

    // If not quick-wake: normal wake word detection anywhere in sentence
    if (!isWakeUp && !quickWake) {
        const idxFound = lowerTranscript.indexOf(lowerWake);
        if (idxFound !== -1) {
            wakeUpAssistant();
            const idx = idxFound + lowerWake.length;
            let remainder = transcript.substring(idx).trim();
            remainder = sanitizeCommand(remainder);
            if (remainder) {
                processCommand(remainder);
            }
            // If remainder is empty we just stay awake and wait for next user speech
            return;
        }
    }

    // If already awakened, treat all final transcripts as commands
    if (isWakeUp) {
        const cmd = sanitizeCommand(transcript);
        if (cmd) {
            processCommand(cmd);
        }
    }
}

// Update wakeUpAssistant/start/reset logic to include timeout handling
function wakeUpAssistant() {
    isWakeUp = true;
    updateStatus('已唤醒，正在聆听...', 'active');
    updateRecognitionResult('助手已唤醒，请说出您的指令...', false);
    updateAssistantResponse('您好，我能帮您做什么？', false);
    startAudioVisualization();
    // update UI button
    if (manualWakeupBtn) {
        manualWakeupBtn.innerHTML = '<i class="fa fa-power-off mr-2"></i><span>关闭助手</span>';
        manualWakeupBtn.classList.remove('bg-primary', 'hover:bg-dark');
        manualWakeupBtn.classList.add('bg-red-500', 'hover:bg-red-600');
    }

    // start timeout to auto-reset if no reply/interaction
    if (wakeTimer) {
        clearTimeout(wakeTimer);
        wakeTimer = null;
    }
    wakeTimer = setTimeout(() => {
        updateRecognitionResult('唤醒超时，已返回未唤醒状态。', false);
        resetAssistant();
    }, wakeTimeout * 1000);
}

function resetAssistant() {
    isWakeUp = false;
    updateStatus('等待唤醒...', 'idle');
    updateRecognitionResult('请唤醒助手并开始说话...', false);
    updateAssistantResponse('助手已关闭，说"' + wakeWord + '"重新唤醒...', false);
    stopAudioVisualization();
    // keep recognition running in background to detect wake word
    if (manualWakeupBtn) {
        manualWakeupBtn.innerHTML = '<i class="fa fa-microphone mr-2"></i><span>手动唤醒</span>';
        manualWakeupBtn.classList.remove('bg-red-500', 'hover:bg-red-600');
        manualWakeupBtn.classList.add('bg-primary', 'hover:bg-dark');
    }
    // clear timeout
    if (wakeTimer) {
        clearTimeout(wakeTimer);
        wakeTimer = null;
    }

    // ensure recognition restarts if it was stopped
    setTimeout(() => {
        try {
            if (!isListening) startListening();
        } catch (e) {
            console.warn('重启识别失败(resetAssistant):', e);
        }
    }, 200);
}

// After assistant replies once, schedule a quick reset
function scheduleResetAfterReply() {
    if (wakeTimer) {
        clearTimeout(wakeTimer);
        wakeTimer = null;
    }
    // short delay to allow user to see the reply and finish playing audio
    wakeTimer = setTimeout(() => {
        // 检查是否正在播放语音，如果是则不重置助手
        if (!speechSynthesis.speaking && !isAudioPlaying && !isStreaming) {
            resetAssistant();
        }
    }, 1500);
}

// Update processCommand to call scheduleResetAfterReply after updating assistant response
async function processCommand(command) {
    if (!command) return;
    addToHistory(command, 'user');
    updateAssistantResponse('正在处理您的请求...', false);
    
    // 停止语音识别，避免在处理命令期间继续接收语音输入
    stopListening();

    try {
        const resp = await fetch(backendApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: command, wake_word: wakeWord })
        });

        if (resp.ok) {
            const data = await resp.json();
            const responseText = data.response || '助手未返回内容';
            updateAssistantResponse(responseText, false);
            addToHistory(responseText, 'assistant');
            // after assistant replies once, return to idle
            scheduleResetAfterReply();
            return;
        }

        // fallback to local simulation when backend fails
        const fallback = await simulateApiCall(command);
        updateAssistantResponse(fallback, false);
        addToHistory(fallback, 'assistant');
        scheduleResetAfterReply();
    } catch (error) {
        console.error('API请求错误:', error);
        const fallback = await simulateApiCall(command);
        updateAssistantResponse('抱歉，处理您的请求时出错。' + fallback, false);
        scheduleResetAfterReply();
    }
}

// 模拟API调用（后备）
function simulateApiCall(command) {
    return new Promise((resolve) => {
        setTimeout(() => {
            if (command.includes('天气')) {
                resolve('今天天气晴朗，气温25°C，适合户外活动。');
            } else if (command.includes('时间')) {
                const now = new Date();
                resolve(`现在是${now.getHours()}点${now.getMinutes()}分。`);
            } else if (command.includes('你好') || command.includes('您好')) {
                resolve('您好！有什么我可以帮您的吗？');
            } else if (command.includes('再见') || command.includes('拜拜')) {
                resolve('再见！如果您还有其他问题，随时可以唤醒我。');
            } else {
                resolve(`您说的是："${command}"。这是一个模拟回复，实际应用中会根据您的指令调用相应的服务。`);
            }
        }, 1000);
    });
}

// 更新状态显示
function updateStatus(text, status) {
    if (!statusText || !statusIndicator) return;
    statusText.textContent = text;
    statusIndicator.className = 'w-4 h-4 rounded-full mr-2';
    switch (status) {
        case 'active':
            statusIndicator.classList.add('bg-green-500', 'animate-pulse');
            break;
        case 'idle':
            statusIndicator.classList.add('bg-gray-300');
            break;
        case 'error':
            statusIndicator.classList.add('bg-red-500');
            break;
        default:
            statusIndicator.classList.add('bg-blue-500');
    }
}

// 更新识别结果
function updateRecognitionResult(text, isInterim) {
    if (!recognitionResult) return;
    recognitionResult.innerHTML = isInterim ? `<p class="text-gray-500">${text}</p>` : `<p>${text}</p>`;
}

// 更新助手响应
function updateAssistantResponse(text, isInterim) {
    if (!assistantResponse) return;
    assistantResponse.innerHTML = isInterim ? `<p class="text-gray-500">${text}</p>` : `<p>${text}</p>`;
}

// 添加到历史记录
function addToHistory(text, type) {
    if (!historyContainer) return;
    if (historyContainer.querySelector('.text-gray-400')) {
        historyContainer.innerHTML = '';
    }
    const historyItem = document.createElement('div');
    historyItem.className = `p-3 rounded-lg ${type === 'user' ? 'bg-blue-50 text-blue-800' : 'bg-gray-100 text-gray-800'}`;
    const icon = document.createElement('i');
    icon.className = `fa ${type === 'user' ? 'fa-user' : 'fa-robot'} mr-2`;
    const content = document.createElement('p');
    content.textContent = text;
    const itemHeader = document.createElement('div');
    itemHeader.className = 'flex items-center mb-1 text-sm font-medium';
    itemHeader.appendChild(icon);
    itemHeader.appendChild(document.createTextNode(type === 'user' ? '你' : '助手'));
    historyItem.appendChild(itemHeader);
    historyItem.appendChild(content);
    historyContainer.appendChild(historyItem);
    historyContainer.scrollTop = historyContainer.scrollHeight;
}

// 清空所有内容
function clearAll() {
    if (recognitionResult) recognitionResult.innerHTML = '<p class="text-gray-400 italic">请唤醒助手并开始说话...</p>';
    if (assistantResponse) assistantResponse.innerHTML = '<p class="text-gray-400 italic">助手将在这里回复您的问题...</p>';
    if (historyContainer) historyContainer.innerHTML = '<p class="text-gray-400 italic text-center">暂无历史记录</p>';
}
let speechSynthesis = window.speechSynthesis;
let currentSpeechUtterance = null;
let streamBuffer = '';

// Initialize AudioContext for streaming audio playback
function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}

// Initialize SpeechSynthesis for fallback TTS
function initSpeechSynthesis() {
    console.log('Initializing speech synthesis...');
    if (!('speechSynthesis' in window)) {
        console.warn('浏览器不支持语音合成');
        return;
    }
    console.log('Speech synthesis initialized successfully.');
}

// Play audio chunks as they arrive from the server
async function playAudioChunk(chunkData) {
    console.log('playAudioChunk called with chunk size:', chunkData.length);
    if (!isStreaming) {
        console.log('Streaming is stopped, skipping audio chunk');
        return;
    }
    
    try {
        // 直接使用Audio对象播放base64音频数据，避免AudioContext的解码问题
        console.log('Creating audio element for playback...');
        
        // 将base64数据转换为Blob URL
        const binaryString = atob(chunkData);
        const len = binaryString.length;
        const arrayBuffer = new ArrayBuffer(len);
        const view = new Uint8Array(arrayBuffer);
        for (let i = 0; i < len; i++) {
            view[i] = binaryString.charCodeAt(i);
        }
        
        // 假设返回的是wav格式的音频数据
        const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(blob);
        
        // 创建并播放音频
        const audio = new Audio(audioUrl);
        
        audio.onloadedmetadata = () => {
            console.log('Audio loaded, duration:', audio.duration);
        };
        
        audio.onplay = () => {
            console.log('Audio playback started');
        };
        
        audio.onended = () => {
            console.log('Audio playback ended');
            // 释放Blob URL
            URL.revokeObjectURL(audioUrl);
        };
        
        audio.onerror = (error) => {
            console.error('Audio playback error:', error);
            // 释放Blob URL
            URL.revokeObjectURL(audioUrl);
        };
        
        // 播放音频
        await audio.play();
        console.log('Audio play() called successfully');
        
    } catch (error) {
        console.error('Error playing audio chunk:', error);
        console.error('Error stack:', error.stack);
    }
}

// Call qwen3-tts-flash API for non-streaming TTS
async function qwen3TtsFlash(text) {
    console.log('qwen3TtsFlash called with text:', text);
    if (!text) return;
    
    try {
        // Set streaming status to false since we're using non-streaming
        isStreaming = false;
        console.log('TTS started, language:', ttsLanguage, 'voice:', ttsVoice);
        updateVoiceStatus('正在生成语音...', 'active');
        
        const response = await fetch('/tts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                language_type: ttsLanguage, // Updated parameter name from model documentation
                voice: ttsVoice
            })
        });
        
        if (!response.ok) {
            throw new Error(`TTS API请求失败: ${response.status}`);
        }
        
        console.log('TTS API response received successfully');
        const result = await response.json();
        
        console.log('TTS result:', JSON.stringify(result, null, 2));
        
        if (result.output && result.output.audio) {
            // 优先使用音频URL进行播放
            if (result.output.audio.url) {
                console.log('Found audio URL:', result.output.audio.url);
                await playCompleteAudio(result.output.audio.url, false);
            } else if (result.output.audio.data) {
                // 备选方案：使用base64数据
                console.log('Found complete audio data, length:', result.output.audio.data.length);
                await playCompleteAudio(result.output.audio.data, true);
            } else {
                console.error('No audio URL or data found in response');
                // 回退到原生TTS
                speakTextNative(text);
            }
        } else {
            console.error('No audio information found in response');
            // 回退到原生TTS
            speakTextNative(text);
        }
        
        updateVoiceStatus('语音播放完成', 'idle');
        
    } catch (error) {
        console.error('TTS处理失败:', error);
        console.error('Error stack:', error.stack);
        updateVoiceStatus('语音生成失败，使用备选方案', 'error');
        // Fallback to native TTS if qwen3-tts-flash fails
        speakTextNative(text);
    } finally {
        // Reset streaming status
        isStreaming = false;
        console.log('TTS ended, resources cleaned up');
    }
}

// Native TTS fallback function
function speakTextNative(text) {
    if (!text || !speechSynthesis) return;

    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }

    currentSpeechUtterance = new SpeechSynthesisUtterance(text);
    currentSpeechUtterance.lang = 'zh-CN';
    currentSpeechUtterance.rate = 0.9;
    currentSpeechUtterance.pitch = 1.0;

    currentSpeechUtterance.onstart = () => {
        updateVoiceStatus('语音播放中...', 'active');
        // Update voice control button
        const voiceControlBtn = document.getElementById('voice-control-btn');
        if (voiceControlBtn) {
            voiceControlBtn.textContent = '⏹️ 停止语音';
        }
    };

    currentSpeechUtterance.onend = () => {
        updateVoiceStatus('语音播放完成', 'idle');
        // Reset voice control button
        const voiceControlBtn = document.getElementById('voice-control-btn');
        if (voiceControlBtn) {
            voiceControlBtn.textContent = '🔊 播放语音';
        }
    };

    currentSpeechUtterance.onerror = (event) => {
        console.error('语音合成错误:', event);
        updateVoiceStatus('语音播放错误', 'error');
        // Reset voice control button
        const voiceControlBtn = document.getElementById('voice-control-btn');
        if (voiceControlBtn) {
            voiceControlBtn.textContent = '🔊 播放语音';
        }
    };

    speechSynthesis.speak(currentSpeechUtterance);
}

function stopAllSpeech() {
    // 设置标志，表示是用户主动停止音频
    isUserStoppingAudio = true;
    
    // Stop native speech synthesis
    if (speechSynthesis && speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
    
    // Stop the current Audio element if it exists
    if (currentAudioElement) {
        console.log('Stopping current audio element...');
        try {
            currentAudioElement.pause();
            currentAudioElement.src = ''; // 清空音频源，确保立即停止
        } catch (error) {
            console.error('Error stopping audio element:', error);
        } finally {
            currentAudioElement = null;
            isAudioPlaying = false;
        }
    }
    
    // Stop qwen3-tts-flash (both streaming and non-streaming)
    isStreaming = false;
    
    // Reset voice control button
    const voiceControlBtn = document.getElementById('voice-control-btn');
    if (voiceControlBtn) {
        voiceControlBtn.textContent = '🔊 播放语音';
    }
    
    // 移除停止后的语音提示，只在播放开始和结束时更新状态
    
    // 重置标志
    setTimeout(() => {
        isUserStoppingAudio = false;
    }, 100);
}

// Play complete audio from URL or base64 data
async function playCompleteAudio(audioSource, isBase64 = false) {
    console.log('playCompleteAudio called, isBase64:', isBase64);
    if (!audioSource) {
        console.warn('No audio source to play');
        return;
    }
    
    try {
        // 创建并播放音频
        const audio = new Audio();
        // 保存当前Audio对象，以便在stopAllSpeech中停止
        currentAudioElement = audio;
        
        // 根据传入的是URL还是base64数据设置音频源
        if (isBase64) {
            console.log('Creating audio element with base64 data URL...');
            audio.src = `data:audio/mp3;base64,${audioSource}`;
        } else {
            console.log('Creating audio element with URL:', audioSource);
            audio.src = audioSource;
        }
        
        audio.onloadedmetadata = () => {
            console.log('Audio loaded, duration:', audio.duration);
        };
        
        audio.onplay = () => {
            console.log('Audio playback started');
            isAudioPlaying = true;
            // Update voice control button
            const voiceControlBtn = document.getElementById('voice-control-btn');
            if (voiceControlBtn) {
                voiceControlBtn.textContent = '⏹️ 停止语音';
            }
        };
        
        audio.onended = () => {
            console.log('Audio playback ended');
            isAudioPlaying = false;
            // Reset voice control button
            const voiceControlBtn = document.getElementById('voice-control-btn');
            if (voiceControlBtn) {
                voiceControlBtn.textContent = '🔊 播放语音';
            }
            // Reset currentAudioElement to release resources
            if (currentAudioElement === audio) {
                currentAudioElement = null;
            }
        };
        
        audio.onerror = (error) => {
            console.error('Audio playback error:', error);
            isAudioPlaying = false;
            // Reset currentAudioElement to release resources
            if (currentAudioElement === audio) {
                currentAudioElement = null;
            }
            // 只有在不是用户主动停止的情况下才回退到原生TTS
            if (!isUserStoppingAudio) {
                // 回退到原生TTS
                const text = document.getElementById('assistant-response').textContent;
                if (text) {
                    console.log('Falling back to native TTS');
                    speakTextNative(text);
                }
            }
        };
        
        console.log('Complete audio playback started');
        await audio.play();
        console.log('Audio play() called successfully');
        
    } catch (error) {
        console.error('Error in playCompleteAudio:', error);
        console.error('Error stack:', error.stack);
        // 回退到原生TTS
        const text = document.getElementById('assistant-response').textContent;
        if (text) {
            console.log('Falling back to native TTS');
            speakTextNative(text);
        }
    }
}

// Helper function to play audio with a specific format
async function playAudioWithFormat(arrayBuffer, format) {
    // 这个函数已经不再使用，但保留以确保兼容性
    return Promise.reject(new Error('This function is deprecated'));
}

function speakText(text) {
    console.log('speakText called with:', text, 'ttsEnabled:', ttsEnabled);
    if (!text) return;
    
    // 确保AudioContext被激活（Web Audio API需要用户交互才能激活）
    initAudioContext();
    if (audioContext && audioContext.state === 'suspended') {
        console.log('Resuming AudioContext...');
        audioContext.resume().then(() => {
            console.log('AudioContext resumed successfully');
            // 在AudioContext激活后执行TTS
            doSpeakText(text);
        }).catch(error => {
            console.error('Failed to resume AudioContext:', error);
            // 回退到原生TTS
            speakTextNative(text);
        });
    } else {
        // AudioContext已经激活，直接执行TTS
        doSpeakText(text);
    }
}

// Helper function to actually perform speech synthesis after AudioContext is ready
function doSpeakText(text) {
    console.log('doSpeakText called with:', text);
    // 根据ttsEnabled状态决定使用哪种TTS方案
    if (ttsEnabled) {
        // 使用qwen3-tts-flash模型进行流式语音合成
        qwen3TtsFlash(text);
        
        // Update voice control button
        const voiceControlBtn = document.getElementById('voice-control-btn');
        if (voiceControlBtn) {
            voiceControlBtn.textContent = '⏹️ 停止语音';
        }
    } else {
        // 使用备选的原生TTS方案
        speakTextNative(text);
    }
}

function updateVoiceStatus(text, status) {
    const statusEl = document.getElementById('voice-status');
    if (!statusEl) return;

    statusEl.textContent = text;
    statusEl.className = 'voice-status';

    switch (status) {
        case 'active':
            statusEl.classList.add('status-active');
            break;
        case 'error':
            statusEl.classList.add('status-error');
            break;
        default:
            statusEl.classList.add('status-idle');
    }
}

function showDiceAnimation(diceType, result) {
    const diceContainer = document.getElementById('dice-animation-container');
    if (!diceContainer) return;

    diceContainer.innerHTML = '';
    diceContainer.style.display = 'block';

    const diceElement = document.createElement('div');
    diceElement.className = `dice dice-${diceType}`;
    diceElement.textContent = result;

    diceContainer.appendChild(diceElement);

    setTimeout(() => {
        diceElement.classList.add('dice-roll');
    }, 100);

    setTimeout(() => {
        diceContainer.style.display = 'none';
    }, 3000);
}

function updateScoreDisplay(scores) {
    const scoreContainer = document.getElementById('score-display');
    if (!scoreContainer) return;

    scoreContainer.innerHTML = '';

    // 检查scores是否为数组（新格式）
    if (Array.isArray(scores)) {
        scores.forEach(item => {
            const name = item.name;
            const score = item.score;
            if (name && score !== undefined) {
                const scoreElement = document.createElement('div');
                scoreElement.className = 'score-item';
                scoreElement.innerHTML = `
                    <span class="score-name">${name}</span>
                    <span class="score-value">${score}</span>
                `;
                scoreContainer.appendChild(scoreElement);
            }
        });
    } else if (typeof scores === 'object' && scores !== null) {
        // 兼容旧的对象格式
        Object.entries(scores).forEach(([name, score]) => {
            const scoreElement = document.createElement('div');
            scoreElement.className = 'score-item';
            scoreElement.innerHTML = `
                <span class="score-name">${name}</span>
                <span class="score-value">${score}</span>
            `;
            scoreContainer.appendChild(scoreElement);
        });
    }
}

async function processCommand(command) {
    if (!command) return;
    addToHistory(command, 'user');
    updateAssistantResponse('正在处理您的请求...', false);

    try {
        const response = await fetch('/process-voice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: command })
        });

        if (!response.ok) throw new Error('网络请求失败');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        streamBuffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));

                        if (data.chunk) {
                            streamBuffer += data.chunk;
                            updateAssistantResponse(streamBuffer + '▊', true);
                        }

                        if (data.final) {
                            const finalData = data.final;
                            fullResponse = finalData.reply || '';

                            updateAssistantResponse(fullResponse, false);
                            addToHistory(fullResponse, 'assistant');

                            speakText(fullResponse);

                            if (finalData.activity === 'roll' && finalData.dice_type) {
                                showDiceAnimation(finalData.dice_type, finalData.dice_result);
                            }

                            if (finalData.activity === 'scoreboard') {
                                const gameStateResponse = await fetch('/get-game-state');
                                const gameState = await gameStateResponse.json();
                                updateScoreDisplay(gameState.scores);
                            }

                            scheduleResetAfterReply();
                        }
                    } catch (e) {
                        console.warn('解析流数据失败:', e);
                    }
                }
            }
        }

    } catch (error) {
        console.error('API请求错误:', error);
        const fallback = await simulateApiCall(command);
        updateAssistantResponse('抱歉，处理您的请求时出错。' + fallback, false);
        speakText('抱歉，处理您的请求时出错。');
        scheduleResetAfterReply();
    }
}

function simulateApiCall(command) {
    return new Promise((resolve) => {
        setTimeout(() => {
            if (command.includes('天气')) {
                resolve('今天天气晴朗，气温25°C，适合户外活动。');
            } else if (command.includes('时间')) {
                const now = new Date();
                resolve(`现在是${now.getHours()}点${now.getMinutes()}分。`);
            } else if (command.includes('你好') || command.includes('您好')) {
                resolve('您好！有什么我可以帮您的吗？');
            } else if (command.includes('再见') || command.includes('拜拜')) {
                resolve('再见！如果您还有其他问题，随时可以唤醒我。');
            } else {
                resolve(`您说的是："${command}"。这是一个模拟回复，实际应用中会根据您的指令调用相应的服务。`);
            }
        }, 1000);
    });
}

// Voice control button setup - moved to setupEventListeners function
// This replaces the second DOMContentLoaded listener
