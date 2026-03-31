"""
æææ¨¡æ¬å¨ - Flask å¾ç«¯ Proxy
è½ç¼è«æ±å° Google Gemini API (Nano Banana 2)ï¼ä¿è­· API Key
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

NUM_VARIATIONS = 2  # Generate 2 images per scene


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
            return jsonify({'error': 'æªæä¾ç¾æ³æ¶§'}), 400

        # Collect materials
        materials = {}
        for mat_type in ['floor', 'curtain', 'wallpaper']:
            f = request.files.get(f'material_{mat_type}')
            if f:
                materials[mat_type] = f.read()

        if not materials:
            return jsonify({'error': 'è«è³å°ä¸å³ä¸ç¨®ææ'}), 400

        # Build material description for prompt
        mat_names = {
            'floor': 'å°æ¿',
            'curtain': 'çªç°¾',
            'wallpaper': 'å£ç´/çé¢'
        }
        mat_desc = 'ã'.join([mat_names[k] for k in materials.keys()])

        # Color mask descriptions per material
        color_desc_map = {
            'floor': 'ç´è²åå(R=255)è¡¨ç¤ºå°æ¿',
            'curtain': 'èè²åå(B=255)è¡¨ç¤ºçªç°¾',
            'wallpaper': 'ç¶ è²åå(G=255)è¡¨ç¤ºå£ç´/çé¢'
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
                f'è«å°æ­¤å®¤å§ç©ºéç§çä¸­ç{mat_desc}æ¿æçºæä¾çæææ¨£æ¬ã'
            ]
            if 'floor' in materials:
                prompt_parts.append('å°æ¿ï¼ä½¿ç¨æä¾çå°æ¿ææç´çéªè¨­ï¼ä¿æéè¦ååå½±èªç¶ã')
            if 'curtain' in materials:
                prompt_parts.append('çªç°¾ï¼ä½¿ç¨æä¾ççªç°¾å¸ææè³ªæ¿æçªç°¾ï¼ä¿æèªç¶åå¢æåè¤¶çºã')
            if 'wallpaper' in materials:
                prompt_parts.append('å£ç´ï¼ä½¿ç¨æä¾çå£ç´è±ç´è¦èçé¢ï¼ä¿æéè¦æ­£ç¢ºã')
            prompt_parts.append('ä¿æå®¤å§ç©ºéçæ´é«æ§åãå¢ä¿±ãåç·ä¸è®ï¼åªæ¿ææå®ææãè¼¸åºç§çç´çå¯¦æççµæãè«ç´æ¥è¼¸åºç·¨è¼¯å¾çåçã')

            # Handle mask
            mask_bytes = None
            if mask_mode == 'manual' and mask_file:
                mask_bytes = mask_file.read()
                # Build color-coded mask description
                color_descs = [color_desc_map[k] for k in materials.keys() if k in color_desc_map]
                mask_prompt = f'ç¬¬äºå¼µåæ¯å½©è²é®ç½©ï¼{"ï¼".join(color_descs)}ãé»è²ååä¸è¦æ¹åãè«åªæ¿æé®ç½©ä¸­å°æé¡è²æ¨è¨çååã'
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
                        gen_contents[0] = prompt + f'\nï¼è«çæç¬¬{gen_idx + 1}ç¨®ä¸åçè®åæ¹æ¡ï¼ææéªè¨­è§åº¦æè²èª¿å¯ä»¥ç¥æä¸åï¼'

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
                                'label': f'å ´æ¯ {i + 1} - æ¹æ¡ {gen_idx + 1}'
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
        print('â ï¸  è«è¨­å®ç°å¢è®æ¸ GOOGLE_API_KEY')
        print('   export GOOGLE_API_KEY=AIza...')
        print()

    port = int(os.environ.get('PORT', 5050))
    print(f'ð æææ¨¡æ¬å¨ååä¸­... port={port}')
    app.run(host='0.0.0.0', port=port, debug=False)
