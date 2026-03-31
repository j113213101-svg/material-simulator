"""
材料模擬器 - Flask 後端 Proxy
轉發請求到 Google Gemini API (Nano Banana 2)，保護 API Key
"""
import os
import io
import base64
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from google import genai
from google.genai import types
from PIL import Image

load_dotenv()

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

client = genai.Client(api_key=os.environ.get('GOOGLE_API_KEY'))

NUM_VARIATIONS = 1  # Generate 2 images per scene


def image_to_part(file_bytes):
    """Convert image bytes to a Gemini Part."""
    img = Image.open(io.BytesIO(file_bytes))
    img = img.convert('RGB')
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)
    return types.Part.from_bytes(data=buf.read(), mime_type='image/png')


def image_bytes_to_data_url(file_bytes):
    """Convert image bytes to a data URL for before/after display."""
    img = Image.open(io.BytesIO(file_bytes))
    img = img.convert('RGB')
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode()
    return f'data:image/png;base64,{b64}'


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

        # Get curtain type
        curtain_type = request.form.get('curtain_type', 'auto')

        # Build material description for prompt
        mat_names = {
            'floor': '地板',
            'curtain': '窗簾',
            'wallpaper': '壁紙/牆面'
        }
        mat_desc = '、'.join([mat_names[k] for k in materials.keys()])

        # Color mask descriptions per material
        color_desc_map = {
            'floor': '紅色區域(R=255)表示地板',
            'curtain': '藍色區域(B=255)表示窗簾',
            'wallpaper': '綠色區域(G=255)表示壁紙/牆面'
        }

        results = []

        for i in range(scene_count):
            scene_file = request.files.get(f'scene_{i}')
            mask_mode = request.form.get(f'scene_{i}_mask_mode', 'ai')
            mask_file = request.files.get(f'scene_{i}_mask')

            if not scene_file:
                continue

            scene_bytes = scene_file.read()

            # Create original image data URL for before/after
            original_url = image_bytes_to_data_url(scene_bytes)

            # Build prompt
            prompt_parts = [
                f'請將此室內空間照片中的{mat_desc}替換為提供的材料樣本。'
            ]
            if 'floor' in materials:
                prompt_parts.append('地板：使用提供的地板材料紋理鋪設，保持透視和光影自然。')
            if 'curtain' in materials:
                if curtain_type and curtain_type != 'auto':
                    curtain_desc = {
                        '布簾': '布簾（傳統布質窗簾，有自然垂墜感和褶皺）',
                        '紗簾': '紗簾（薄紗材質，半透光，輕盈飄逸）',
                        '捲簾': '捲簾（平整捲收式窗簾，收合時捲成圓筒狀）',
                        '調光簾': '調光簾（斑馬簾，由透光和不透光條紋交替組成，可調節光線）',
                        '蜂巢簾': '蜂巢簾（風琴簾，橫向蜂巢結構，可上下收合）',
                        '直立簾': '直立簾（垂直葉片式百葉窗簾，葉片可左右旋轉調光）',
                        '絲柔百葉': '絲柔百葉（柔紗簾，兩層紗中間夾橫向葉片，兼具紗簾與百葉功能）',
                        '木百葉': '木百葉（實木或仿木材質的橫向百葉窗，葉片可翻轉調光）',
                        '鋁百葉': '鋁百葉（鋁合金材質的橫向百葉窗，葉片纖細可翻轉調光）'
                    }
                    ct_desc = curtain_desc.get(curtain_type, curtain_type)
                    prompt_parts.append(f'窗簾：這是{ct_desc}。使用提供的窗簾材料樣本替換窗戶上的窗簾/窗飾，務必保持{curtain_type}的正確外觀結構和特徵，不要變成其他類型的窗簾。')
                else:
                    prompt_parts.append('窗簾：使用提供的窗簾布料材質替換窗簾，保持與材料照片相同的窗簾類型和結構特徵。')
            if 'wallpaper' in materials:
                prompt_parts.append('壁紙：使用提供的壁紙花紋覆蓋牆面，保持透視正確。')
            prompt_parts.append('保持室內空間的整體構圖、傢俱、光線不變，只替揖指定材料。輸出照片級真實感的結果。請直接輸出編輯後的圖片。')

            # Handle mask
            mask_bytes = None
            if mask_mode == 'manual' and mask_file:
                mask_bytes = mask_file.read()
                # Build color-coded mask description
                color_descs = [color_desc_map[k] for k in materials.keys() if k in color_desc_map]
                mask_prompt = f'第二張圖是彩色遮罩，{"，".join(color_descs)}。黑色區域不要改動。請只替換遮罩中對應顏色標記的區域。'
                prompt_parts.insert(0, mask_prompt)

            prompt = '\n'.join(prompt_parts)

            # Build content: prompt + scene image + optional mask + material images
            contents = [prompt, image_to_part(scene_bytes)]

            if mask_bytes:
                contents.append(image_to_part(mask_bytes))

            for mat_type, mat_bytes in materials.items():
                contents.append(image_to_part(mat_bytes))

            # Generate NUM_VARIATIONS images per scene
            for gen_idx in range(NUM_VARIATIONS):
                try:
                    # Add variation hint for 2nd+ generation
                    gen_contents = list(contents)
                    if gen_idx > 0:
                        gen_contents[0] = prompt + f'\n（請生成第{gen_idx + 1}種不同的變化方案，材料鋪設角度或色調可以略有不同）'

                    response = client.models.generate_content(
                        model='gemini-3.1-flash-image-preview',
                        contents=gen_contents,
                        config=types.GenerateContentConfig(
                            response_modalities=['IMAGE', 'TEXT']
                        )
                    )

                    # Extract result image
                    for part in response.candidates[0].content.parts:
                        if part.inline_data and part.inline_data.mime_type.startswith('image/'):
                            result_b64 = base64.b64encode(part.inline_data.data).decode()
                            result_url = f'data:{part.inline_data.mime_type};base64,{result_b64}'
                            results.append({
                                'url': result_url,
                                'original_url': original_url,
                                'label': f'場景 {i + 1} - 方案 {gen_idx + 1}'
                            })
                            break
                except Exception as gen_err:
                    print(f'Generation {gen_idx + 1} for scene {i + 1} failed: {gen_err}')
                    # Continue to next variation

        return jsonify({'results': results})

    except Exception as e:
        print(f'Error: {e}')
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    if not os.environ.get('GOOGLE_API_KEY'):
        print('⚠️  請設定環境變數 GOOGLE_API_KEY')
        print('   export GOOGLE_API_KEY=AIza...')
        print()

    port = int(os.environ.get('PORT', 5050))
    print(f'🚀 材料模擬器啟動中... port={port}')
    app.run(host='0.0.0.0', port=port, debug=False)
