// 前端语音处理、音频可视化和后端集成
// 从模板迁移并适配调用Flask端点 /process-voice

// 全局变量
let recognition;
let isWakeUp = false;
let isListening = false;
let analyser;
let microphone;
let animationId;
let backendApiUrl = "/process-voice"; // 本地Flask端点

// 全局设置（将在DOM加载完成后初始化）
let wakeWord = '你好助手';
let wakeTimeout = 5; // 秒
let quickWake = false;
let wakeTimer = null;
let manualDebugEnabled = false; // 新：是否显示手动调试输入
let isProcessingManualCommand = false; // 新：是否正在处理手动命令
// TTS设置 - 从模型文档中提取的常量
// 将从API获取
let SUPPORTED_LANGUAGES = [];

// 将从API获取
let SUPPORTED_VOICES = [];

// 配置对象，用于存储来自API的设置
let appConfig = null;

// TTS设置
let ttsEnabled = false; // 是否启用qwen3-tts-flash
let ttsLanguage = 'Chinese'; // TTS语言类型
let ttsVoice = 'Cherry'; // TTS音色

// 音频变量
let audioContext = null; // 用于可视化和TTS的全局音频上下文
let isAudioPlaying = false; // 标记是否正在播放合并后的音频
let currentAudioElement = null; // 跟踪当前音频元素，用于立即停止
let isUserStoppingAudio = false; // 标记是否是用户主动停止音频

// DOM元素（将在DOM准备就绪后分配）
let statusIndicator;
let statusText;
let voiceWaveContainer;
let recognitionResult;
let assistantResponse;
let manualWakeupBtn;
let clearBtn;
let historyContainer;

// 从API获取配置的函数
async function fetchConfig() {
    try {
        console.log('从API获取配置...');
        const response = await fetch('/config');
        if (!response.ok) {
            throw new Error(`获取配置失败: ${response.status}`);
        }
        appConfig = await response.json();
        
        // 从API填充支持的语言和音色
        SUPPORTED_LANGUAGES = appConfig.SUPPORTED_LANGUAGES || [];
        SUPPORTED_VOICES = appConfig.SUPPORTED_VOICES || [];
        
        // 从API更新默认设置
        if (appConfig.DEFAULT_WAKE_WORD) {
            wakeWord = appConfig.DEFAULT_WAKE_WORD;
        }
        if (appConfig.DEFAULT_WAKE_TIMEOUT) {
            wakeTimeout = appConfig.DEFAULT_WAKE_TIMEOUT;
        }
        
        console.log('配置获取成功:', {
            languages: SUPPORTED_LANGUAGES.length,
            voices: SUPPORTED_VOICES.length,
            defaultWakeWord: wakeWord,
            defaultWakeTimeout: wakeTimeout
        });
        
        return true;
    } catch (error) {
        console.error('获取配置错误:', error);
        // 如果API失败，使用默认值
        console.log('使用默认配置值');
        return false;
    }
}

// 单个DOM加载完成初始化
window.addEventListener('DOMContentLoaded', async () => {
    // 首先从API获取配置
    await fetchConfig();
    
    // 分配DOM元素，避免null引用
    statusIndicator = document.getElementById('status-indicator');
    statusText = document.getElementById('status-text');
    voiceWaveContainer = document.querySelector('#voice-wave-container .flex');
    recognitionResult = document.getElementById('recognition-result');
    assistantResponse = document.getElementById('assistant-response');
    manualWakeupBtn = document.getElementById('manual-wakeup-btn');
    clearBtn = document.getElementById('clear-btn');
    historyContainer = document.getElementById('history-container');

    // 设置UI元素
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

    // 手动调试元素
    const debugManualToggle = document.getElementById('debug-manual-toggle');
    const manualDebugArea = document.getElementById('manual-debug-area');
    const manualCommandInput = document.getElementById('manual-command-input');
    const manualCommandSend = document.getElementById('manual-command-send');

    // 加载持久化设置或回退到数据集或默认值
    try {
        const lsWake = localStorage.getItem('yv_wake_word');
        const lsTimeout = localStorage.getItem('yv_wake_timeout');
        const lsQuick = localStorage.getItem('yv_quick_wake');
        const lsManualDebug = localStorage.getItem('yv_manual_debug');
        // TTS设置
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
        console.warn('localStorage不可用:', e);
    }

    // 填充设置UI
    if (wakeWordInput) wakeWordInput.value = wakeWord;
    if (wakeTimeoutInput) wakeTimeoutInput.value = wakeTimeout;
    if (quickWakeToggle) quickWakeToggle.checked = quickWake;
    if (currentWakeWordDisplay) currentWakeWordDisplay.textContent = wakeWord;
    if (debugManualToggle) debugManualToggle.checked = manualDebugEnabled;
    if (manualDebugArea) {
        if (manualDebugEnabled) manualDebugArea.classList.remove('hidden');
        else manualDebugArea.classList.add('hidden');
    }
    
    // TTS设置UI
    const ttsEnabledToggle = document.getElementById('tts-enabled-toggle');
    const ttsLanguageSelect = document.getElementById('tts-language-select');
    const ttsVoiceSelect = document.getElementById('tts-voice-select');
    
    // 从SUPPORTED_LANGUAGES常量动态填充语言选项
    if (ttsLanguageSelect) {
        ttsLanguageSelect.innerHTML = '';
        SUPPORTED_LANGUAGES.forEach(lang => {
            const option = document.createElement('option');
            option.value = lang.value;
            option.textContent = lang.label;
            ttsLanguageSelect.appendChild(option);
        });
        // 设置当前值
        ttsLanguageSelect.value = ttsLanguage;
    }
    
    // 从SUPPORTED_VOICES常量动态填充音色选项
    if (ttsVoiceSelect) {
        ttsVoiceSelect.innerHTML = '';
        SUPPORTED_VOICES.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.value;
            option.textContent = `${voice.name} - ${voice.description}`;
            ttsVoiceSelect.appendChild(option);
        });
        // 设置当前值
        ttsVoiceSelect.value = ttsVoice;
    }
    
    if (ttsEnabledToggle) ttsEnabledToggle.checked = ttsEnabled;

    // 确保侧边栏初始transform已设置
    if (settingsSidebar && !settingsSidebar.style.transform) {
        settingsSidebar.style.transform = 'translateX(100%)';
    }

    // 设置打开/关闭处理程序 - 使用style.transform避免Tailwind类不匹配
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

    // 手动调试切换处理程序
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
                console.warn('localStorage不可用:', e);
            }
        });
    }

    // 手动发送处理程序
    if (manualCommandSend && manualCommandInput) {
        manualCommandSend.addEventListener('click', () => {
            const raw = (manualCommandInput.value || '').trim();
            const cmd = sanitizeCommand(raw);
            if (!cmd) {
                // 显示小提示
                updateRecognitionResult('请输入有效的指令再发送。', false);
                return;
            }
            // 唤醒助手以便可见，然后处理
            wakeUpAssistant();
            isProcessingManualCommand = true;
            processCommand(cmd).finally(() => {
                isProcessingManualCommand = false;
            });
            manualCommandInput.value = '';
        });

        // 允许Enter键发送
        manualCommandInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                manualCommandSend.click();
            }
        });
    }

    // 保存设置
    if (wakeWordSave) {
        wakeWordSave.addEventListener('click', () => {
            const newWake = (wakeWordInput && wakeWordInput.value.trim()) || wakeWord;
            const newTimeout = Math.max(1, parseInt((wakeTimeoutInput && wakeTimeoutInput.value), 10) || wakeTimeout);
            const newQuick = !!(quickWakeToggle && quickWakeToggle.checked);
            const newManualDebug = !!(debugManualToggle && debugManualToggle.checked);
            
            // TTS设置
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
            // 更新TTS设置
            ttsEnabled = newTtsEnabled;
            ttsLanguage = newTtsLanguage;
            ttsVoice = newTtsVoice;
            
            if (currentWakeWordDisplay) currentWakeWordDisplay.textContent = wakeWord;

            // 持久化
            try {
                localStorage.setItem('yv_wake_word', wakeWord);
                localStorage.setItem('yv_wake_timeout', String(wakeTimeout));
                localStorage.setItem('yv_quick_wake', String(quickWake));
                localStorage.setItem('yv_manual_debug', String(manualDebugEnabled));
                // 持久化TTS设置
                localStorage.setItem('yv_tts_enabled', String(ttsEnabled));
                localStorage.setItem('yv_tts_language', ttsLanguage);
                localStorage.setItem('yv_tts_voice', ttsVoice);
            } catch (e) {
                console.warn('localStorage不可用:', e);
            }

            // 反馈
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
    
    // 语音控制按钮设置
    const voiceControlBtn = document.getElementById('voice-control-btn');
    if (voiceControlBtn) {
        voiceControlBtn.addEventListener('click', function() {
            // 检查是否有活动的语音合成
            if (speechSynthesis.speaking || isAudioPlaying) {
                // 停止所有语音合成（原生和非流式）
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

// 工具函数：从候选命令中移除周围的标点和空白
function sanitizeCommand(text) {
    if (!text) return '';
    // 移除周围的空白和常见标点（英文 + 中文）
    let result = text.replace(/^[\s\.\,\!\?\;\:\-\u2014\u3000\u2014\uff0c\u3002\uff01\uff1f\u3001\uff1b\uff1a\-|"'\u201c\u201d\u2018\u2019]+|[\s\.\,\!\?\;\:\-\u2014\u3000\u2014\uff0c\u3002\uff01\uff1f\u3001\uff1b\uff1a\-|"'\u201c\u201d\u2018\u2019]+$/g, '').trim();
    // 如果剩余字符串不包含字母或数字，则视为空（防止使用单个标点符号如'.'）
    try {
        if (!/[\p{L}\p{N}]/u.test(result)) return '';
    } catch (e) {
        // 如果环境不支持Unicode属性转义，则回退到基本测试
        if (!/[A-Za-z0-9\u4e00-\u9fa5]/.test(result)) return '';
    }
    return result;
}

// 处理最终转录结果，支持快速唤醒和忽略仅标点符号的余数
function handleFinalTranscript(transcript) {
    transcript = transcript.trim();
    if (!transcript) return;

    const lowerTranscript = transcript.toLowerCase();
    const lowerWake = wakeWord.toLowerCase();

    // 快速唤醒：如果启用且句子以唤醒词开头，则将余数视为命令（如果有意义）
    if (!isWakeUp && quickWake && lowerTranscript.startsWith(lowerWake)) {
        let command = transcript.substring(lowerWake.length).trim();
        command = sanitizeCommand(command);
        wakeUpAssistant();
        if (command) {
            processCommand(command);
        }
        return;
    }

    // 如果不是快速唤醒：在句子中任何位置进行正常唤醒词检测
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
            // 如果余数为空，我们只是保持唤醒状态并等待下一次用户语音
            return;
        }
    }

    // 如果已经唤醒，将所有最终转录结果视为命令
    if (isWakeUp) {
        const cmd = sanitizeCommand(transcript);
        if (cmd) {
            processCommand(cmd);
        }
    }
}

// 唤醒助手
function wakeUpAssistant() {
    isWakeUp = true;
    updateStatus('已唤醒，正在聆听...', 'active');
    updateRecognitionResult('助手已唤醒，请说出您的指令...', false);
    updateAssistantResponse('您好，我能帮您做什么？', false);
    startAudioVisualization();
    // 更新UI按钮
    if (manualWakeupBtn) {
        manualWakeupBtn.innerHTML = '<i class="fa fa-power-off mr-2"></i><span>关闭助手</span>';
        manualWakeupBtn.classList.remove('bg-primary', 'hover:bg-dark');
        manualWakeupBtn.classList.add('bg-red-500', 'hover:bg-red-600');
    }

    // 启动超时以在无回复/交互时自动重置
    if (wakeTimer) {
        clearTimeout(wakeTimer);
        wakeTimer = null;
    }
    wakeTimer = setTimeout(() => {
        updateRecognitionResult('唤醒超时，已返回未唤醒状态。', false);
        resetAssistant();
    }, wakeTimeout * 1000);
}

// 重置助手
function resetAssistant() {
    isWakeUp = false;
    updateStatus('等待唤醒...', 'idle');
    updateRecognitionResult('请唤醒助手并开始说话...', false);
    updateAssistantResponse('助手已关闭，说"' + wakeWord + '"重新唤醒...', false);
    stopAudioVisualization();
    // 保持识别在后台运行以检测唤醒词
    if (manualWakeupBtn) {
        manualWakeupBtn.innerHTML = '<i class="fa fa-microphone mr-2"></i><span>手动唤醒</span>';
        manualWakeupBtn.classList.remove('bg-red-500', 'hover:bg-red-600');
        manualWakeupBtn.classList.add('bg-primary', 'hover:bg-dark');
    }
    // 清除超时
    if (wakeTimer) {
        clearTimeout(wakeTimer);
        wakeTimer = null;
    }

    // 确保识别在停止后重启
    setTimeout(() => {
        try {
            if (!isListening) startListening();
        } catch (e) {
            console.warn('重启识别失败(resetAssistant):', e);
        }
    }, 200);
}

// 助手回复后安排快速重置
function scheduleResetAfterReply() {
    if (wakeTimer) {
        clearTimeout(wakeTimer);
        wakeTimer = null;
    }
    // 短暂延迟，允许用户查看回复并完成播放音频
    wakeTimer = setTimeout(() => {
        // 检查是否正在播放语音，如果是则不重置助手
        if (!speechSynthesis.speaking && !isAudioPlaying) {
            resetAssistant();
        }
    }, 1500);
}

// 处理命令
async function processCommand(command) {
    if (!command) return;
    addToHistory(command, 'user');
    updateAssistantResponse('正在处理您的请求...', false);
    
    // 停止语音识别，避免在处理命令期间继续接收语音输入
    stopListening();

    try {
        const response = await fetch('/process-voice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: command, wake_word: wakeWord })
        });

        if (!response.ok) throw new Error('网络请求失败');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let streamBuffer = '';

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
        updateAssistantResponse('抱歉，处理您的请求时出错。', false);
        speakText('抱歉，处理您的请求时出错。');
        scheduleResetAfterReply();
    }
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

// 语音合成相关
let speechSynthesis = window.speechSynthesis;
let currentSpeechUtterance = null;

// 初始化SpeechSynthesis用于备用TTS
function initSpeechSynthesis() {
    console.log('初始化语音合成...');
    if (!('speechSynthesis' in window)) {
        console.warn('浏览器不支持语音合成');
        return;
    }
    console.log('语音合成初始化成功。');
}

// 调用qwen3-tts-flash API进行非流式TTS
async function qwen3TtsFlash(text) {
    console.log('qwen3TtsFlash被调用，文本:', text);
    if (!text) return;
    
    try {
        console.log('TTS开始，语言:', ttsLanguage, '音色:', ttsVoice);
        updateVoiceStatus('正在生成语音...', 'active');
        
        const response = await fetch('/tts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                language_type: ttsLanguage, // 从模型文档更新的参数名称
                voice: ttsVoice
            })
        });
        
        if (!response.ok) {
            throw new Error(`TTS API请求失败: ${response.status}`);
        }
        
        console.log('TTS API响应成功接收');
        const result = await response.json();
        
        console.log('TTS结果:', JSON.stringify(result, null, 2));
        
        if (result.output && result.output.audio) {
            // 优先使用音频URL进行播放
            if (result.output.audio.url) {
                console.log('找到音频URL:', result.output.audio.url);
                await playCompleteAudio(result.output.audio.url);
            } else {
                console.error('响应中未找到音频URL');
                // 回退到原生TTS
                speakTextNative(text);
            }
        } else {
            console.error('响应中未找到音频信息');
            // 回退到原生TTS
            speakTextNative(text);
        }
        
        updateVoiceStatus('语音播放完成', 'idle');
        
    } catch (error) {
        console.error('TTS处理失败:', error);
        updateVoiceStatus('语音生成失败，使用备选方案', 'error');
        // 如果qwen3-tts-flash失败，回退到原生TTS
        speakTextNative(text);
    }
}

// 原生TTS备用函数
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
        // 更新语音控制按钮
        const voiceControlBtn = document.getElementById('voice-control-btn');
        if (voiceControlBtn) {
            voiceControlBtn.textContent = '⏹️ 停止语音';
        }
    };

    currentSpeechUtterance.onend = () => {
        updateVoiceStatus('语音播放完成', 'idle');
        // 重置语音控制按钮
        const voiceControlBtn = document.getElementById('voice-control-btn');
        if (voiceControlBtn) {
            voiceControlBtn.textContent = '🔊 播放语音';
        }
    };

    currentSpeechUtterance.onerror = (event) => {
        console.error('语音合成错误:', event);
        updateVoiceStatus('语音播放错误', 'error');
        // 重置语音控制按钮
        const voiceControlBtn = document.getElementById('voice-control-btn');
        if (voiceControlBtn) {
            voiceControlBtn.textContent = '🔊 播放语音';
        }
    };

    speechSynthesis.speak(currentSpeechUtterance);
}

// 停止所有语音
function stopAllSpeech() {
    // 设置标志，表示是用户主动停止音频
    isUserStoppingAudio = true;
    
    // 停止原生语音合成
    if (speechSynthesis && speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
    
    // 停止当前Audio元素（如果存在）
    if (currentAudioElement) {
        console.log('停止当前音频元素...');
        try {
            currentAudioElement.pause();
            currentAudioElement.src = ''; // 清空音频源，确保立即停止
        } catch (error) {
            console.error('停止音频元素时出错:', error);
        } finally {
            currentAudioElement = null;
            isAudioPlaying = false;
        }
    }
    
    // 重置语音控制按钮
    const voiceControlBtn = document.getElementById('voice-control-btn');
    if (voiceControlBtn) {
        voiceControlBtn.textContent = '🔊 播放语音';
    }
    
    // 重置标志
    setTimeout(() => {
        isUserStoppingAudio = false;
    }, 100);
}

// 播放完整音频（从URL）
async function playCompleteAudio(audioUrl) {
    console.log('playCompleteAudio被调用，URL:', audioUrl);
    if (!audioUrl) {
        console.warn('没有音频源可播放');
        return;
    }
    
    try {
        // 创建并播放音频
        const audio = new Audio();
        // 保存当前Audio对象，以便在stopAllSpeech中停止
        currentAudioElement = audio;
        
        console.log('创建音频元素，URL:', audioUrl);
        audio.src = audioUrl;
        
        audio.onloadedmetadata = () => {
            console.log('音频加载完成，时长:', audio.duration);
        };
        
        audio.onplay = () => {
            console.log('音频播放开始');
            isAudioPlaying = true;
            // 更新语音控制按钮
            const voiceControlBtn = document.getElementById('voice-control-btn');
            if (voiceControlBtn) {
                voiceControlBtn.textContent = '⏹️ 停止语音';
            }
        };
        
        audio.onended = () => {
            console.log('音频播放结束');
            isAudioPlaying = false;
            // 重置语音控制按钮
            const voiceControlBtn = document.getElementById('voice-control-btn');
            if (voiceControlBtn) {
                voiceControlBtn.textContent = '🔊 播放语音';
            }
            // 重置currentAudioElement以释放资源
            if (currentAudioElement === audio) {
                currentAudioElement = null;
            }
        };
        
        audio.onerror = (error) => {
            console.error('音频播放错误:', error);
            isAudioPlaying = false;
            // 重置currentAudioElement以释放资源
            if (currentAudioElement === audio) {
                currentAudioElement = null;
            }
            // 只有在不是用户主动停止的情况下才回退到原生TTS
            if (!isUserStoppingAudio) {
                // 回退到原生TTS
                const text = document.getElementById('assistant-response').textContent;
                if (text) {
                    console.log('回退到原生TTS');
                    speakTextNative(text);
                }
            }
        };
        
        console.log('完整音频播放开始');
        await audio.play();
        console.log('audio.play()调用成功');
        
    } catch (error) {
        console.error('playCompleteAudio中的错误:', error);
        // 回退到原生TTS
        const text = document.getElementById('assistant-response').textContent;
        if (text) {
            console.log('回退到原生TTS');
            speakTextNative(text);
        }
    }
}

// 执行语音合成
function speakText(text) {
    console.log('speakText被调用，文本:', text, 'ttsEnabled:', ttsEnabled);
    if (!text) return;
    
    // 根据ttsEnabled状态决定使用哪种TTS方案
    if (ttsEnabled) {
        // 使用qwen3-tts-flash模型进行非流式语音合成
        qwen3TtsFlash(text);
        
        // 更新语音控制按钮
        const voiceControlBtn = document.getElementById('voice-control-btn');
        if (voiceControlBtn) {
            voiceControlBtn.textContent = '⏹️ 停止语音';
        }
    } else {
        // 使用备选的原生TTS方案
        speakTextNative(text);
    }
}

// 更新语音状态
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

// 显示骰子动画
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

// 更新分数显示
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