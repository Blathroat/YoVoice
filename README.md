# YoVoice - 智能语音助手

YoVoice是一个基于Flask和大语言模型的智能语音助手，支持语音唤醒、语音识别、自然语言处理和语音合成等功能。

## 功能特性

### 语音交互
- 支持自定义唤醒词
- 语音识别和实时转写
- 流式响应生成
- 支持手动输入命令

### 智能处理
- 基于大语言模型的对话生成
- 游戏支持（掷骰子、计分板等）
- 多语言支持

### 语音合成
- 集成qwen3-tts-flash模型
- 支持多种语言和音色选择
- 非流式语音合成
- 支持音频URL播放

### 可视化
- 实时音频波形可视化
- 响应状态显示
- 历史记录管理

## 技术栈

### 后端
- Python 3.8+
- Flask 2.2.5
- OpenAI SDK
- (DashScope SDK)[https://bailian.console.aliyun.com/#/home]
- JSON数据格式

### 前端
- HTML5
- CSS3
- JavaScript (ES6+)
- Web Speech API
- Web Audio API

## 安装和运行

### 1. 克隆项目
```bash
git clone <repository-url>
cd YoVoice
```

### 2. 安装依赖
```bash
pip install flask dashscope requests openai
```

### 3. 配置项目
- 复制 `config-example.json` 为 `config.json`
- 修改 `config.json` 中的配置项，特别是 `SECRET_KEY` 和 `MODEL_API_KEY`

### 4. 运行应用
```bash
python app.py
```

### 5. 访问应用
在浏览器中访问 `http://localhost:5000`

## 配置说明

### config.json 配置项

| 配置项 | 类型 | 说明 |
|--------|------|------|
| SECRET_KEY | string | Flask应用的密钥 |
| MODEL_API_KEY | string | 大语言模型的API密钥 |
| MODEL_BASE_URL | string | 模型API的基础URL |
| MODEL_PROMPT | string | 模型的系统提示词 |
| DEFAULT_WAKE_WORD | string | 默认唤醒词 |
| DEFAULT_WAKE_TIMEOUT | number | 唤醒超时时间（秒） |
| CHAT_ASSISTANT_MODEL | string | 对话模型名称 |
| TTS_MODEL | string | 语音合成模型名称 |
| SUPPORTED_LANGUAGES | array | 支持的语言列表 |
| SUPPORTED_VOICES | array | 支持的音色列表 |

## 项目结构

```
YoVoice/
├── static/
│   ├── css/
│   │   └── main.css          # 主样式文件
│   └── js/
│       └── main.js           # 主JavaScript文件
├── templates/
│   └── index.html            # 主页面模板
├── .gitignore                # Git忽略文件
├── app.py                    # Flask应用主文件
├── config.json               # 配置文件
├── config-example.json       # 配置示例文件
├── requirements.txt          # 依赖列表
└── README.md                 # 项目说明文档
```

## API端点

### 1. 主页
- **URL**: `/`
- **方法**: GET
- **描述**: 返回主页面

### 2. 语音处理
- **URL**: `/process-voice`
- **方法**: POST
- **描述**: 处理语音命令，返回流式响应
- **请求体**: `{"text": "命令文本", "wake_word": "唤醒词"}`

### 3. 配置信息
- **URL**: `/config`
- **方法**: GET
- **描述**: 返回配置信息，包括支持的语言和音色

### 4. 语音合成
- **URL**: `/tts`
- **方法**: POST
- **描述**: 生成语音，返回音频URL
- **请求体**: `{"text": "文本内容", "language_type": "语言类型", "voice": "音色"}`

### 5. 游戏状态
- **URL**: `/get-game-state`
- **方法**: GET
- **描述**: 获取游戏状态

### 6. 更新分数
- **URL**: `/update-score`
- **方法**: POST
- **描述**: 更新游戏分数

### 7. 游戏规则
- **URL**: `/game-rules/<game_name>`
- **方法**: GET
- **描述**: 获取游戏规则

## 前端功能

### 唤醒功能
- 支持语音唤醒和手动唤醒
- 可配置唤醒词和超时时间
- 支持快速唤醒模式

### 设置面板
- 唤醒词设置
- 唤醒超时设置
- 快速唤醒开关
- TTS开关和配置
- 语言和音色选择

### 手动调试
- 支持手动输入命令
- 实时显示识别结果
- 响应历史记录

### 语音控制
- 播放/停止语音响应
- 支持多种语音合成方式

## 开发说明

### 代码优化
- 前端代码已优化，移除冗余代码
- 注释已转为中文
- 代码结构清晰，便于维护

### 扩展建议
- 添加更多游戏支持
- 集成更多语音合成模型
- 支持更多语言
- 添加用户认证功能
- 实现多轮对话支持


## 贡献

欢迎提交Issue和Pull Request！
