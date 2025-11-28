from flask import Flask, render_template, request, jsonify, Response
from openai import OpenAI
import json
import random

app = Flask(__name__)
app.config['WTF_I18N_ENABLED'] = False
app.config['SECRET_KEY'] = "HU7YUSsBgjec3GdcS621"
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///test.db'

MODEL_API_KEY = "sk-65807fabe7bc4f9a8fb709b2bb4ffbd5"
MODEL_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
MODEL_PROMPT = """你是一个游戏助手，负责处理游戏相关的请求。返回必须是有效的JSON格式。

字段约定：
1. "reply": string - 回复给用户的文本内容
2. "activity": string - 必须是以下值之一：
   - "none": 仅回复，无其他操作
   - "roll": 掷骰子/随机数，需要包含：
        "lower": int - 最小值（默认1）
        "upper": int - 最大值
   - "scoreboard": 更新计分板，需要包含：
        "name": string - 计分板名称
        "score": string - 分数值

游戏规则处理：
- 如果用户询问已有游戏的规则，返回对应游戏规则
- 如果用户询问未知游戏规则，使用搜索引擎查找

当前游戏状态会作为上下文传递。"""

game_state = {
    "scores": {},
    "current_roll": None
}


class ChatAssistant:
    def __init__(self, api_key: str = MODEL_API_KEY, base_url: str = MODEL_BASE_URL):
        self.client = OpenAI(api_key=api_key, base_url=base_url)

    def process_game_request(self, user_text: str, current_state: dict, model: str = "qwen3-max"):
        context = f"当前游戏状态: {json.dumps(current_state, ensure_ascii=False)}\n用户请求: {user_text}"

        messages = [
            {"role": "system", "content": MODEL_PROMPT},
            {"role": "user", "content": context},
        ]

        completion = self.client.chat.completions.create(
            model=model,
            messages=messages,
            response_format={"type": "json_object"},
            stream=True
        )

        return completion


chat_assistant = ChatAssistant()


def get_standard_dice_type(lower, upper):
    range_size = upper - lower + 1
    if lower == 1 and range_size in [4, 6, 8, 12, 20]:
        return range_size
    return None


@app.route('/')
def hello_world():
    return render_template('index.html')


@app.route('/process-voice', methods=['POST'])
def process_voice():
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()

    if not text:
        return jsonify({'response': "抱歉，我没有收到任何内容。"})

    try:
        def generate():
            full_response = ""
            stream = chat_assistant.process_game_request(text, game_state)

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
                    name = result.get('name', '')
                    score = result.get('score', '')
                    if name:
                        game_state['scores'][name] = score

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
    name = data.get('name')
    score = data.get('score')

    if name and score is not None:
        game_state['scores'][name] = score
        return jsonify({'success': True})

    return jsonify({'success': False})


@app.route('/game-rules/<game_name>')
def get_game_rules(game_name):
    rules_db = {
        "dungeons and dragons": "D&D 龙与地下城规则: 使用d20进行技能检定，d6用于武器伤害...",
        "monopoly": "大富翁规则: 掷两个d6决定移动步数，购买地产收取租金...",
        "poker": "扑克规则: 使用一副52张牌，比较牌型大小...",
        "mahjong": "麻将规则: 四人游戏，通过摸牌、打牌组成特定牌型...",
    }

    game_key = game_name.lower()
    rules = rules_db.get(game_key, f"未找到游戏 '{game_name}' 的规则，将通过搜索引擎查找。")

    return jsonify({
        "game": game_name,
        "rules": rules
    })


if __name__ == '__main__':
    app.run(debug=True)