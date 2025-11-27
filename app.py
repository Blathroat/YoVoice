from flask import Flask, render_template, request, jsonify
from openai import OpenAI

app = Flask(__name__)
app.config['WTF_I18N_ENABLED'] = False  # 禁用默认语言
app.config['SECRET_KEY'] = "HU7YUSsBgjec3GdcS621"
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///test.db'

MODEL_API_KEY = "sk-65807fabe7bc4f9a8fb709b2bb4ffbd5"
MODEL_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
MODEL_PROMPT = ("返回JSON首个字段名须为'activity'，其值须为以下值中的一个："
                "'roll'：判断用户需求为扔骰子时返回；"
                "'reply'：判断用户需求为需要裁判规则/闲聊时返回。"
                "当返回首个字段名为'roll'时，")  # 须含有关键词JSON


class ChatAssistant:
    def __init__(self, api_key: str = MODEL_API_KEY, base_url: str = MODEL_BASE_URL):
        self.client = OpenAI(api_key=api_key, base_url=base_url)

    def extract_person_info(self, user_text: str, model: str = "qwen3-max"):
        messages = [
            {"role": "system", "content": MODEL_PROMPT},
            {"role": "user", "content": user_text},
        ]
        completion = self.client.chat.completions.create(
            model=model,
            messages=messages,
            response_format={"type": "json_object"},
        )
        return completion.choices[0].message.content


@app.route('/')
def hello_world():
    return render_template('index.html')


@app.route('/process-voice', methods=['POST'])
def process_voice():
    """接受前端发送的语音识别文本（JSON），返回助手的回复（JSON）。
    请求体: {"text": "..."}
    返回: {"response": "..."}
    """
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()

    # 简单模拟的处理逻辑，可替换为调用真实后端服务
    if not text:
        resp = "抱歉，我没有收到任何内容。"
    elif '天气' in text:
        resp = '今天天气晴朗，气温19°C，适合户外活动。'
    elif '时间' in text:
        from datetime import datetime
        now = datetime.now()
        resp = f'现在是{now.hour}点{now.minute}分。'
    elif '你好' in text or '您好' in text:
        resp = '您好！有什么我可以帮您的吗？'
    elif '再见' in text or '拜拜' in text:
        resp = '再见！如果您还有其他问题，随时可以唤醒我。'
    else:
        resp = f'您说的是："{text}"。这是一个模拟回复。'

    return jsonify({'response': resp})


if __name__ == '__main__':
    app.run(debug=True)
