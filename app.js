/**
 * 材料模擬器 - 主應用邏輯（單頁版）
 */
(function () {
    // ===== State =====
    const state = {
        scenes: [], // { id, file, dataURL, maskMode: 'ai'|'manual', maskDataURL, maskPreview }
        materials: { floor: null, curtain: null, wallpaper: null }, // dataURL after crop
        materialsOriginal: { floor: null, curtain: null, wallpaper: null }, // dataURL before crop
        results: [] // { url, original_url, label }
    };

    // ===== DOM Refs =====
    const sceneUploadZone = document.getElementById('scene-upload-zone');
    const sceneInput = document.getElementById('scene-input');
    const sceneGrid = document.getElementById('scene-grid');
    const btnGenerate = document.getElementById('btn-generate');
    const btnDownloadAll = document.getElementById('btn-download-all');
    const resultsGrid = document.getElementById('results-grid');
    const generating = document.getElementById('generating');
    const resultsPanel = document.getElementById('panel-3');

    // ===== Helper: get uploaded material types =====
    function getUploadedMaterials() {
        return Object.keys(state.materials).filter(k => state.materials[k] !== null);
    }

    // ===== Update Generate Button State =====
    function updateGenerateBtn() {
        const hasScene = state.scenes.length > 0;
        const hasMaterial = Object.values(state.materials).some(m => m !== null);
        btnGenerate.disabled = !(hasScene && hasMaterial);
    }

    // ===== Scene Upload =====
    sceneUploadZone.addEventListener('click', () => sceneInput.click());
    sceneUploadZone.addEventListener('dragover', (e) => { e.preventDefault(); sceneUploadZone.classList.add('dragover'); });
    sceneUploadZone.addEventListener('dragleave', () => sceneUploadZone.classList.remove('dragover'));
    sceneUploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        sceneUploadZone.classList.remove('dragover');
        handleSceneFiles(e.dataTransfer.files);
    });
    sceneInput.addEventListener('change', () => {
        handleSceneFiles(sceneInput.files);
        sceneInput.value = '';
    });

    function handleSceneFiles(files) {
        Array.from(files).forEach(file => {
            if (!file.type.startsWith('image/')) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                const scene = {
                    id: Date.now() + Math.random(),
                    file,
                    dataURL: e.target.result,
                    maskMode: 'ai',
                    maskDataURL: null,
                    maskPreview: null
                };
                state.scenes.push(scene);
                renderSceneGrid();
                updateGenerateBtn();
            };
            reader.readAsDataURL(file);
        });
    }

    function renderSceneGrid() {
        sceneGrid.innerHTML = '';
        state.scenes.forEach((scene, idx) => {
            const card = document.createElement('div');
            card.className = 'scene-card';
            card.innerHTML = `
                <img src="${scene.dataURL}" alt="現況照 ${idx + 1}">
                <span class="badge ${scene.maskMode === 'ai' ? 'badge-ai' : 'badge-manual'}">
                    ${scene.maskMode === 'ai' ? 'AI 自動' : '手動遮罩'}
                </span>
                <button class="btn-remove-scene" data-idx="${idx}" title="移除">&times;</button>
                <div class="scene-card-overlay">
                    <button class="btn-mask" data-idx="${idx}">設定遮罩</button>
                </div>
            `;

            // If has manual mask preview, overlay it
            if (scene.maskPreview) {
                const overlay = document.createElement('img');
                overlay.src = scene.maskPreview;
                overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;pointer-events:none;opacity:0.5;';
                card.appendChild(overlay);
            }

            sceneGrid.appendChild(card);
        });

        // Event: remove scene
        sceneGrid.querySelectorAll('.btn-remove-scene').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                state.scenes.splice(parseInt(btn.dataset.idx), 1);
                renderSceneGrid();
                updateGenerateBtn();
            });
        });

        // Event: edit mask
        sceneGrid.querySelectorAll('.btn-mask').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.idx);
                const scene = state.scenes[idx];
                const uploadedMaterials = getUploadedMaterials();
                window.maskTool.open(scene.dataURL, scene.maskPreview, uploadedMaterials, (result) => {
                    scene.maskMode = result.mode;
                    scene.maskDataURL = result.maskDataURL;
                    scene.maskPreview = result.previewDataURL;
                    renderSceneGrid();
                });
            });
        });
    }

    // ===== Material Upload =====
    document.querySelectorAll('.material-upload').forEach(zone => {
        const type = zone.dataset.type;
        const input = zone.querySelector('input[type=file]');

        zone.addEventListener('click', () => input.click());
        input.addEventListener('change', () => {
            if (!input.files[0]) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                state.materialsOriginal[type] = e.target.result;
                state.materials[type] = e.target.result;
                showMaterialPreview(type, e.target.result);
                updateGenerateBtn();
            };
            reader.readAsDataURL(input.files[0]);
            input.value = '';
        });
    });

    function showMaterialPreview(type, dataURL) {
        const card = document.querySelector(`.material-card[data-type="${type}"]`);
        const uploadZone = card.querySelector('.material-upload');
        const preview = card.querySelector('.material-preview');
        const canvas = preview.querySelector('canvas');

        uploadZone.classList.add('hidden');
        preview.classList.remove('hidden');

        const img = new Image();
        img.onload = () => {
            const maxW = card.clientWidth - 32;
            const ratio = Math.min(maxW / img.width, 200 / img.height, 1);
            canvas.width = Math.round(img.width * ratio);
            canvas.height = Math.round(img.height * ratio);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = dataURL;

        // Crop button
        preview.querySelector('.btn-crop').onclick = () => {
            window.cropTool.open(state.materialsOriginal[type], (croppedDataURL) => {
                state.materials[type] = croppedDataURL;
                showMaterialPreview(type, croppedDataURL);
            });
        };

        // Remove button
        preview.querySelector('.btn-remove').onclick = () => {
            state.materials[type] = null;
            state.materialsOriginal[type] = null;
            preview.classList.add('hidden');
            uploadZone.classList.remove('hidden');
            updateGenerateBtn();
        };
    }

    // ===== Generate =====
    btnGenerate.addEventListener('click', async () => {
        // Check at least one material is selected
        const hasMaterial = Object.values(state.materials).some(m => m !== null);
        if (!hasMaterial) {
            alert('請至少上傳一種材料照片');
            return;
        }
        if (state.scenes.length === 0) {
            alert('請至少上傳一張現況照片');
            return;
        }

        resultsGrid.innerHTML = '';
        generating.classList.remove('hidden');
        btnDownloadAll.disabled = true;
        resultsPanel.scrollIntoView({ behavior: 'smooth' });

        try {
            const scenesPayload = state.scenes.map(s => ({
                imageDataURL: s.dataURL,
                maskDataURL: s.maskDataURL,
                maskMode: s.maskMode
            }));

            // Get curtain type selection
            const curtainTypeEl = document.querySelector('input[name="curtain-type"]:checked');
            const curtainType = curtainTypeEl ? curtainTypeEl.value : 'auto';

            const response = await API.generate({
                scenes: scenesPayload,
                materials: state.materials,
                curtainType: curtainType
            });

            state.results = response.results || [];
            renderResults();
        } catch (err) {
            console.error('Generation error:', err);
            resultsGrid.innerHTML = `
                <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--gray-500);">
                    <p style="font-size:16px;margin-bottom:8px;">生成失敗</p>
                    <p style="font-size:13px;">${err.message}</p>
                    <p style="font-size:12px;margin-top:12px;color:var(--gray-400);">
                        請確認後端服務已啟動 (python server.py) 且已設定 GOOGLE_API_KEY
                    </p>
                </div>
            `;
        } finally {
            generating.classList.add('hidden');
        }
    });

    function renderResults() {
        resultsGrid.innerHTML = '';
        if (state.results.length === 0) {
            resultsGrid.innerHTML = '<p style="text-align:center;color:var(--gray-400);grid-column:1/-1;padding:40px;">無結果</p>';
            return;
        }

        state.results.forEach((result, idx) => {
            const card = document.createElement('div');
            card.className = 'result-card before-after-card';
            card.innerHTML = `
                <div class="before-after-wrap">
                    <div class="ba-side">
                        <span class="ba-label ba-before">Before</span>
                        <img src="${result.original_url}" alt="原始照片">
                    </div>
                    <div class="ba-side">
                        <span class="ba-label ba-after">After</span>
                        <img src="${result.url}" alt="${result.label}">
                    </div>
                </div>
                <div class="result-card-footer">
                    <span>${result.label}</span>
                    <button class="btn-download" data-idx="${idx}">下載</button>
                </div>
            `;
            resultsGrid.appendChild(card);
        });

        btnDownloadAll.disabled = false;

        // Download single (after image only)
        resultsGrid.querySelectorAll('.btn-download').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                downloadImage(state.results[idx].url, `simulation_${idx + 1}.png`);
            });
        });
    }

    // Download all
    btnDownloadAll.addEventListener('click', () => {
        state.results.forEach((result, idx) => {
            setTimeout(() => {
                downloadImage(result.url, `simulation_${idx + 1}.png`);
            }, idx * 300);
        });
    });

    function downloadImage(src, filename) {
        const a = document.createElement('a');
        a.href = src;
        a.download = filename;
        a.click();
    }
})();
