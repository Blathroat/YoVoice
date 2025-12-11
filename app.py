from flask import Flask, render_template, request, jsonify, Response
from openai import OpenAI
import json
import random
from typing import Any, Dict

app = Flask(__name__)
app.config['WTF_I18N_ENABLED'] = False
app.config['SECRET_KEY'] = "HU7YUSsBgjec3GdcS621"
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///test.db'

MODEL_API_KEY = "sk-65807fabe7bc4f9a8fb709b2bb4ffbd5"
MODEL_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
MODEL_PROMPT = """你是一个游戏助手，负责处理游戏相关的请求。返回必须是有效的JSON格式。

字段约定：
1. "reply": string - 回复给用户的文本内容（自然语言）
2. "activity": string - 必须是以下值之一：
   - "none": 仅回复，无其他操作
   - "roll": 掷骰子/随机数，需要包含：
        "lower": int - 最小值（默认1）
        "upper": int - 最大值
   - "scoreboard": 更新计分板，需要包含：
        当更新单条计分时可以返回：
            { "name": string, "score": string }
        当需要返回或更新多条计分时，请使用列表字段：
            "scores": [ {"name": string, "score": string}, ... ]

说明与约束：
- 计分板的传输格式优先使用 "scores" 列表；单条更新也应同时兼容单条 {name, score} 的方式。
- 前端可能会在启用“快速唤醒”时把唤醒词从发送到模型的文本中移除；模型不应该依赖于请求中包含唤醒词。
- 当用户只是唤醒但未提供具体命令时（或命令内容为单个标点符号/空字符串），请将 activity 置为 "none" 并在 reply 中给出友好提示，而不要把标点作为命令内容。
- 返回的 JSON 必须是完整有效的对象，且不包含多余的注释或主体外文本。流式场景中，每次最终消息应包含完整 JSON 对象作为最终值。

示例（单次更新）：
{ "reply": "已将玩家A的分数设为10", "activity": "scoreboard", "name": "玩家A", "score": 10 }

示例（多条更新）：
{ "reply": "已更新计分板", "activity": "scoreboard", "scores": [{"name":"玩家A","score":10},{"name":"玩家B","score":5}] }

当前游戏状态会作为上下文传递，请在回复中尽量使用简洁明了的 JSON 结构。"""

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

    def process_game_request(self, user_text: str, current_state: dict, model: str = "qwen3-max") -> Any:
        context = f"当前游戏状态: {json.dumps(current_state, ensure_ascii=False)}\n用户请求: {user_text}"

        messages = [
            {"role": "system", "content": MODEL_PROMPT},
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


if __name__ == '__main__':
    app.run(debug=True)