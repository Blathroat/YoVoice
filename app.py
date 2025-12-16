from flask import Flask, render_template, request, jsonify, Response
from openai import OpenAI
import json
import random
from typing import Any, Dict
import dashscope

# 读取配置文件
with open('config.json', 'r', encoding='utf-8') as f:
    config = json.load(f)

app = Flask(__name__)
app.config['WTF_I18N_ENABLED'] = False
app.config['SECRET_KEY'] = config['SECRET_KEY']
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///test.db'

MODEL_API_KEY = config['MODEL_API_KEY']
MODEL_BASE_URL = config['MODEL_BASE_URL']
MODEL_PROMPT = config['MODEL_PROMPT']
CHAT_ASSISTANT_MODEL = config['CHAT_ASSISTANT_MODEL']
TTS_MODEL = config['TTS_MODEL']

# 将 scores 从 dict 改为 list，以便传递多项分数：
# game_state['scores'] = [ {"name": "player1", "score": 10}, ... ]
# 明确类型，避免静态检查器混淆
game_state: Dict[str, Any] = {
    "scores": [],
    "current_roll": None
}


class ChatAssistant:
    def __init__(self, api_key: str = MODEL_API_KEY, base_url: str = MODEL_BASE_URL):
        self.client = OpenAI(api_key=api_key, base_url=base_url)

    def process_game_request(self, user_text: str, current_state: dict, model: str = None, ai_name: str = "你好助手") -> Any:
        # 使用配置文件中的模型名称作为默认值
        if model is None:
            model = CHAT_ASSISTANT_MODEL
        
        # 将AI名称替换到模型提示中
        prompt = MODEL_PROMPT.replace("{AI_NAME}", ai_name)
        
        context = f"当前游戏状态: {json.dumps(current_state, ensure_ascii=False)}\n用户请求: {user_text}"

        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": context},
        ]

        completion: Any = self.client.chat.completions.create(
            model=model,
            messages=messages,
            response_format={"type": "json_object"},
            stream=True,
            extra_body = {"enable_search": True}
        )

        return completion


chat_assistant = ChatAssistant()


def get_standard_dice_type(lower, upper):
    range_size = upper - lower + 1
    if lower == 1 and range_size in [4, 6, 8, 12, 20]:
        return range_size
    return None


# 辅助函数：设置或更新计分板中的某一项（按 name 唯一）
def set_score(name, score):
    if name is None:
        return
    # 尝试将 score 转为数字（如果合适）
    try:
        # 保持原类型，如果是数字字符串则转为 int
        if isinstance(score, str) and score.isdigit():
            score_cast = int(score)
        else:
            score_cast = score
    except Exception:
        score_cast = score

    # 更新已存在项
    for item in game_state['scores']:
        if item.get('name') == name:
            item['score'] = score_cast
            return
    # 否则追加新项
    game_state['scores'].append({'name': name, 'score': score_cast})


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/process-voice', methods=['POST'])
def process_voice():
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    # 获取用户在请求中提供的唤醒词，或者使用配置中的默认值
    wake_word = data.get('wake_word', config.get('DEFAULT_WAKE_WORD', '你好助手'))

    if not text:
        return jsonify({'response': "抱歉，我没有收到任何内容。"})

    try:
        def generate():
            full_response = ""
            # 使用用户提供的唤醒词作为AI名称
            ai_name = wake_word
            stream = chat_assistant.process_game_request(text, game_state, ai_name=ai_name)

            for chunk in stream:
                if chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    full_response += content
                    yield f"data: {json.dumps({'chunk': content}, ensure_ascii=False)}\n\n"

            try:
                result = json.loads(full_response)
                activity = result.get('activity', 'none')

                if activity == 'roll':
                    lower = result.get('lower', 1)
                    upper = result.get('upper', 6)
                    dice_result = random.randint(lower, upper)
                    game_state['current_roll'] = dice_result

                    dice_type = get_standard_dice_type(lower, upper)
                    if dice_type:
                        result['dice_type'] = dice_type
                        result['dice_result'] = dice_result
                        result['reply'] += f"\n掷出了 {dice_result} 点！"
                    else:
                        result['reply'] += f"\n随机数: {dice_result}"

                elif activity == 'scoreboard':
                    # 支持两种模型返回格式：单条 name/score，或多条 scores 列表
                    if 'scores' in result and isinstance(result['scores'], list):
                        for s in result['scores']:
                            name = s.get('name')
                            score = s.get('score')
                            if name is not None and score is not None:
                                set_score(name, score)
                    else:
                        name = result.get('name', '')
                        score = result.get('score', '')
                        if name:
                            set_score(name, score)

                    # 打印当前计分板（调试用）
                    print(game_state['scores'])

                yield f"data: {json.dumps({'final': result}, ensure_ascii=False)}\n\n"

            except json.JSONDecodeError:
                error_result = {
                    "reply": f"处理您的请求时出现错误: {full_response}",
                    "activity": "none"
                }
                yield f"data: {json.dumps({'final': error_result}, ensure_ascii=False)}\n\n"

        return Response(generate(), mimetype='text/plain')

    except Exception as e:
        return jsonify({
            "reply": f"处理请求时出错: {str(e)}",
            "activity": "none"
        })


@app.route('/get-game-state', methods=['GET'])
def get_game_state():
    return jsonify(game_state)


@app.route('/update-score', methods=['POST'])
def update_score():
    data = request.get_json()
    # 支持单条更新或多条批量更新
    if not data:
        return jsonify({'success': False})

    # 如果传入的是一个列表（批量）
    if isinstance(data, list):
        for entry in data:
            name = entry.get('name')
            score = entry.get('score')
            if name is not None and score is not None:
                set_score(name, score)
        return jsonify({'success': True})

    # 否则按单条处理
    name = data.get('name')
    score = data.get('score')

    if name and score is not None:
        set_score(name, score)
        return jsonify({'success': True})

    return jsonify({'success': False})


@app.route('/game-rules/<game_name>')
def get_game_rules(game_name):
    rules_db = { }

    game_key = game_name.lower()
    rules = rules_db.get(game_key, f"未找到游戏 '{game_name}' 的规则，将通过搜索引擎查找。")

    return jsonify({
        "game": game_name,
        "rules": rules
    })


@app.route('/config')
def get_config():
    """提供配置信息的API端点"""
    return jsonify({
        "SUPPORTED_LANGUAGES": config['SUPPORTED_LANGUAGES'],
        "SUPPORTED_VOICES": config['SUPPORTED_VOICES'],
        "DEFAULT_WAKE_WORD": config['DEFAULT_WAKE_WORD'],
        "DEFAULT_WAKE_TIMEOUT": config['DEFAULT_WAKE_TIMEOUT']
    })


@app.route('/tts', methods=['POST'])
def tts():
    """qwen3-tts-flash 模型的非流式语音合成接口"""
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    language_type = data.get('language_type', 'Chinese')
    voice = data.get('voice', 'Cherry')
    
    if not text:
        return jsonify({'error': '文本不能为空'}), 400
    
    try:
        # 使用dashscope SDK进行非流式TTS调用
        # 配置API密钥
        dashscope.api_key = MODEL_API_KEY
        
        # 非流式调用，直接返回完整结果
        response = dashscope.MultiModalConversation.call(
            model=TTS_MODEL,
            text=text,
            voice=voice,
            language_type=language_type,
            stream=False
        )
        
        # 处理完整响应
        if response.output is not None:
            audio = response.output.audio
            result = {
                "status_code": response.status_code,
                "request_id": response.request_id,
                "output": {
                    "finish_reason": response.output.finish_reason,
                    "audio": {
                        "data": audio.data if audio.data else "",
                        "url": audio.url if audio.url else "",
                        "id": audio.id if audio.id else "",
                        "expires_at": audio.expires_at if audio.expires_at else 0
                    }
                },
                "usage": {
                    "characters": response.usage.characters if response.usage else 0
                }
            }
            return jsonify(result)
        else:
            return jsonify({'error': 'TTS处理失败: 未返回音频数据'}), 500
    
    except Exception as e:
        return jsonify({'error': f'TTS处理失败: {str(e)}'}), 500


if __name__ == '__main__':
    app.run(debug=True)