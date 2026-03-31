/**
 * API module - èå¾ç«¯ Flask proxy éä¿¡ï¼å¼å« Google Gemini API
 */
const API = {
    BASE_URL: '',

    /**
     * çææ¨¡æ¬ç§
     * @param {Object} params
     * @param {Array<{imageDataURL: string, maskDataURL: string|null, maskMode: string}>} params.scenes
     * @param {{floor: string|null, curtain: string|null, wallpaper: string|null}} params.materials
     * @returns {Promise<{results: Array<{url: string, original_url: string, label: string}>}>}
     */
    async generate(params) {
        const formData = new FormData();

        // Add scene images and masks
        for (let i = 0; i < params.scenes.length; i++) {
            const scene = params.scenes[i];
            const imageBlob = await this._dataURLtoBlob(scene.imageDataURL);
            formData.append(`scene_${i}`, imageBlob, `scene_${i}.png`);
            formData.append(`scene_${i}_mask_mode`, scene.maskMode);

            if (scene.maskDataURL) {
                const maskBlob = await this._dataURLtoBlob(scene.maskDataURL);
                formData.append(`scene_${i}_mask`, maskBlob, `scene_${i}_mask.png`);
            }
        }
        formData.append('scene_count', params.scenes.length);

        // Add materials
        const uploadedMaterials = [];
        for (const [key, dataURL] of Object.entries(params.materials)) {
            if (dataURL) {
                const blob = await this._dataURLtoBlob(dataURL);
                formData.append(`material_${key}`, blob, `material_${key}.png`);
                uploadedMaterials.push(key);
            }
        }
        // Send material types info for color-coded mask mapping
        formData.append('materials_info', JSON.stringify(uploadedMaterials));

        const response = await fetch(`${this.BASE_URL}/api/generate`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(err.error || `HTTP ${response.status}`);
        }

        return response.json();
    },

    _dataURLtoBlob(dataURL) {
        return new Promise((resolve) => {
            const [header, data] = dataURL.split(',');
            const mime = header.match(/:(.*?);/)[1];
            const binary = atob(data);
            const array = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                array[i] = binary.charCodeAt(i);
            }
            resolve(new Blob([array], { type: mime }));
        });
    }
};
