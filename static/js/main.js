// Frontend voice handling, audio visualization and backend integration
// Moved from template and adapted to call Flask endpoint /process-voice

// 全局变量
let recognition;
let isWakeUp = false;
let isListening = false;
let audioContext;
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

// DOM元素 (will be assigned after DOM is ready)
let statusIndicator;
let statusText;
let voiceWaveContainer;
let recognitionResult;
let assistantResponse;
let manualWakeupBtn;
let clearBtn;
let historyContainer;

// Single DOM-ready initialization
document.addEventListener('DOMContentLoaded', () => {
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
        if (lsWake) wakeWord = lsWake;
        else if (appEl && appEl.dataset && appEl.dataset.wakeWord) wakeWord = appEl.dataset.wakeWord;
        if (lsTimeout) wakeTimeout = parseInt(lsTimeout, 10) || wakeTimeout;
        if (lsQuick) quickWake = lsQuick === 'true';
        if (lsManualDebug) manualDebugEnabled = lsManualDebug === 'true';
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
            processCommand(cmd);
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
            wakeWord = newWake;
            wakeTimeout = newTimeout;
            quickWake = newQuick;
            manualDebugEnabled = newManualDebug;
            if (currentWakeWordDisplay) currentWakeWordDisplay.textContent = wakeWord;

            // persist
            try {
                localStorage.setItem('yv_wake_word', wakeWord);
                localStorage.setItem('yv_wake_timeout', String(wakeTimeout));
                localStorage.setItem('yv_quick_wake', String(quickWake));
                localStorage.setItem('yv_manual_debug', String(manualDebugEnabled));
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
        setTimeout(() => {
            try {
                if (!isListening) startListening();
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
    // short delay to allow user to see the reply
    wakeTimer = setTimeout(() => {
        resetAssistant();
    }, 800);
}

// Update processCommand to call scheduleResetAfterReply after updating assistant response
async function processCommand(command) {
    if (!command) return;
    addToHistory(command, 'user');
    updateAssistantResponse('正在处理您的请求...', false);

    try {
        const resp = await fetch(backendApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: command })
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
