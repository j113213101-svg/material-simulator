"""
材料模擬器 - Flask 後端 Proxy
轉發請求到 OpenAI Images API，保護 API Key
"""
import os
import io
import base64
from PIL import Image
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from openai import OpenAI

load_dotenv()

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

client = OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))


def to_png_bytes(file_bytes):
    """Convert any image bytes to RGBA PNG bytes for OpenAI API."""
    img = Image.open(io.BytesIO(file_bytes))
    img = img.convert('RGBA')
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)
    return buf


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


@app.route('/api/generate', methods=['POST'])
def generate():
    try:
        scene_count = int(request.form.get('scene_count', 0))
        if scene_count == 0:
            return jsonify({'error': '未提供現況照'}), 400

        # Collect materials
        materials = {}
        for mat_type in ['floor', 'curtain', 'wallpaper']:
            f = request.files.get(f'material_{mat_type}')
            if f:
                materials[mat_type] = f.read()

        if not materials:
            return jsonify({'error': '請至少上傳一種材料'}), 400

        # Build material description for prompt
        mat_names = {
            'floor': '地板',
            'curtain': '窗簾',
            'wallpaper': '壁紙/牆面'
        }
        mat_desc = '、'.join([mat_names[k] for k in materials.keys()])

        results = []

        for i in range(scene_count):
            scene_file = request.files.get(f'scene_{i}')
            mask_mode = request.form.get(f'scene_{i}_mask_mode', 'ai')
            mask_file = request.files.get(f'scene_{i}_mask')

            if not scene_file:
                continue

            scene_bytes = scene_file.read()

            # Build prompt
            prompt_parts = [
                f'將此室內空間照片中的{mat_desc}替換為提供的材料樣本。'
            ]
            if 'floor' in materials:
                prompt_parts.append('地板：使用提供的地板材料紋理鋪設，保持透視和光影自然。')
            if 'curtain' in materials:
                prompt_parts.append('窗簾：使用提供的窗簾布料材質替換窗簾，保持自然垂墜感和褶皺。')
            if 'wallpaper' in materials:
                prompt_parts.append('壁紙：使用提供的壁紙花紋覆蓋牆面，保持透視正確。')
            prompt_parts.append('保持室內空間的整體構圖、傢俱、光線不變，只替換指定材料。輸出照片級真實感的結果。')

            prompt = '\n'.join(prompt_parts)

            # Convert scene image to PNG
            scene_png = to_png_bytes(scene_bytes)

            # Build mask if manual mode
            mask_png = None
            if mask_mode == 'manual' and mask_file:
                mask_bytes = mask_file.read()
                mask_png = to_png_bytes(mask_bytes)
                prompt = f'遮罩圖中白色區域為需要替換的部分。\n{prompt}'

            # Call OpenAI Images API
            api_kwargs = {
                'model': 'dall-e-2',
                'image': scene_png,
                'prompt': prompt,
                'n': 1,
                'size': '1024x1024',
            }
            if mask_png:
                api_kwargs['mask'] = mask_png

            response = client.images.edit(**api_kwargs)

            # Get result
            image_data = response.data[0]
            if hasattr(image_data, 'b64_json') and image_data.b64_json:
                result_b64 = image_data.b64_json
                result_url = f'data:image/png;base64,{result_b64}'
            elif hasattr(image_data, 'url') and image_data.url:
                result_url = image_data.url
            else:
                continue

            results.append({
                'url': result_url,
                'label': f'模擬結果 {i + 1}'
            })

        return jsonify({'results': results})

    except Exception as e:
        print(f'Error: {e}')
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    if not os.environ.get('OPENAI_API_KEY'):
        print('⚠️  請設定環境變數 OPENAI_API_KEY')
        print('   export OPENAI_API_KEY=sk-...')
        print()

    port = int(os.environ.get('PORT', 5050))
    print(f'🚀 材料模擬器啟動中... port={port}')
    app.run(host='0.0.0.0', port=port, debug=False)
