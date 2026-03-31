/**
 * MaskTool - 遮罩編輯工具
 * 支援畫筆塗抹、多邊形框選、橡皮擦
 * 支援多色遮罩：紅=地板、藍=窗簾、綠=壁紙
 */
class MaskTool {
    constructor() {
        this.modal = document.getElementById('mask-modal');
        this.bgCanvas = document.getElementById('mask-canvas-bg');
        this.canvas = document.getElementById('mask-canvas');
        this.bgCtx = this.bgCanvas.getContext('2d');
        this.ctx = this.canvas.getContext('2d');
        this.cursor = document.getElementById('mask-cursor');

        this.mode = 'ai'; // 'ai' | 'manual'
        this.tool = 'brush'; // 'brush' | 'polygon' | 'eraser'
        this.brushSize = 25;
        this.isDrawing = false;
        this.history = [];
        this.polygonPoints = [];
        this.currentImage = null;
        this.scaleRatio = 1;
        this.onConfirm = null;
        this.canvasOffsetX = 0;

        // Material color mapping
        this.MATERIAL_COLORS = {
            floor:     { r: 255, g: 0,   b: 0,   label: '地板', display: 'rgba(255, 0, 0, 0.5)',   preview: 'rgba(255, 0, 0, 0.8)',   dot: '#ff4444' },
            curtain:   { r: 0,   g: 0,   b: 255, label: '窗簾', display: 'rgba(0, 0, 255, 0.5)',   preview: 'rgba(0, 0, 255, 0.8)',   dot: '#4488ff' },
            wallpaper: { r: 0,   g: 255, b: 0,   label: '壁紙', display: 'rgba(0, 255, 0, 0.45)',  preview: 'rgba(0, 255, 0, 0.8)',   dot: '#44cc66' }
        };
        this.availableMaterials = []; // e.g. ['floor', 'curtain']
        this.activeMaterial = null; // e.g. 'floor'

        this._bindEvents();
    }

    _getActiveColor() {
        if (!this.activeMaterial || !this.MATERIAL_COLORS[this.activeMaterial]) {
            return { display: 'rgba(255, 0, 0, 0.5)', preview: 'rgba(255, 0, 0, 0.8)' };
        }
        return this.MATERIAL_COLORS[this.activeMaterial];
    }

    _bindEvents() {
        // Mode toggle
        document.querySelectorAll('input[name="mask-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.mode = e.target.value;
                const manualTools = document.getElementById('manual-tools');
                if (this.mode === 'manual') {
                    manualTools.classList.remove('hidden');
                } else {
                    manualTools.classList.add('hidden');
                }
            });
        });

        // Tool toggle
        document.querySelectorAll('.mask-toolbar .tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mask-toolbar .tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.tool = btn.dataset.tool;
                this.polygonPoints = [];
                this._updateCursor();
            });
        });

        // Brush size
        const brushSlider = document.getElementById('brush-size');
        const brushLabel = document.getElementById('brush-size-label');
        brushSlider.addEventListener('input', () => {
            this.brushSize = parseInt(brushSlider.value);
            brushLabel.textContent = this.brushSize + 'px';
            this._updateCursor();
        });

        // Canvas events
        this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.canvas.addEventListener('mouseup', () => this._onMouseUp());
        this.canvas.addEventListener('mouseleave', () => { this.isDrawing = false; this.cursor.style.display = 'none'; });
        this.canvas.addEventListener('dblclick', () => this._closePolygon());
        this.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this._closePolygon(); });

        // Touch events
        this.canvas.addEventListener('touchstart', (e) => { e.preventDefault(); this._onMouseDown(this._touchToMouse(e)); });
        this.canvas.addEventListener('touchmove', (e) => { e.preventDefault(); this._onMouseMove(this._touchToMouse(e)); });
        this.canvas.addEventListener('touchend', (e) => { e.preventDefault(); this._onMouseUp(); });

        // Undo / Clear
        document.getElementById('mask-undo').addEventListener('click', () => this._undo());
        document.getElementById('mask-clear').addEventListener('click', () => this._clear());

        // Confirm / Cancel / Close
        document.getElementById('mask-confirm').addEventListener('click', () => this._confirm());
        document.getElementById('mask-cancel').addEventListener('click', () => this.close());
        document.getElementById('mask-modal-close').addEventListener('click', () => this.close());
    }

    /**
     * Render color swatches in the toolbar based on available materials
     */
    _renderColorSwatches() {
        const container = document.getElementById('color-swatches');
        if (!container) return;
        container.innerHTML = '';

        this.availableMaterials.forEach((mat, idx) => {
            const color = this.MATERIAL_COLORS[mat];
            if (!color) return;
            const btn = document.createElement('button');
            btn.className = 'color-swatch' + (idx === 0 ? ' active' : '');
            btn.dataset.material = mat;
            btn.innerHTML = `<span class="color-dot" style="background:${color.dot}"></span>${color.label}`;
            btn.addEventListener('click', () => {
                container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
                btn.classList.add('active');
                this.activeMaterial = mat;
            });
            container.appendChild(btn);
        });

        // Select first by default
        if (this.availableMaterials.length > 0) {
            this.activeMaterial = this.availableMaterials[0];
        }

        // Show/hide color selector
        const colorGroup = document.getElementById('color-selector');
        if (colorGroup) {
            colorGroup.classList.toggle('hidden', this.availableMaterials.length <= 1);
        }
    }

    open(imageDataURL, existingMask, availableMaterials, onConfirm) {
        this.onConfirm = onConfirm;
        this.availableMaterials = availableMaterials || ['floor'];
        this.modal.classList.remove('hidden');
        this.history = [];
        this.polygonPoints = [];

        // Render color swatches
        this._renderColorSwatches();

        // Reset mode to AI
        document.querySelector('input[name="mask-mode"][value="ai"]').checked = true;
        this.mode = 'ai';
        document.getElementById('manual-tools').classList.add('hidden');

        const img = new Image();
        img.onload = () => {
            this.currentImage = img;
            const wrap = this.canvas.parentElement;
            const maxW = wrap.clientWidth;
            const maxH = window.innerHeight * 0.6;
            this.scaleRatio = Math.min(maxW / img.width, maxH / img.height, 1);
            const w = Math.round(img.width * this.scaleRatio);
            const h = Math.round(img.height * this.scaleRatio);

            this.bgCanvas.width = w;
            this.bgCanvas.height = h;
            this.canvas.width = w;
            this.canvas.height = h;

            this.bgCtx.drawImage(img, 0, 0, w, h);

            // Clear mask canvas
            this.ctx.clearRect(0, 0, w, h);

            // Load existing mask if provided
            if (existingMask) {
                const maskImg = new Image();
                maskImg.onload = () => {
                    this.ctx.drawImage(maskImg, 0, 0, w, h);
                    this._saveHistory();

                    // If existing mask, switch to manual mode
                    document.querySelector('input[name="mask-mode"][value="manual"]').checked = true;
                    this.mode = 'manual';
                    document.getElementById('manual-tools').classList.remove('hidden');
                };
                maskImg.src = existingMask;
            } else {
                this._saveHistory();
            }
        };
        img.src = imageDataURL;
    }

    close() {
        this.modal.classList.add('hidden');
        this.polygonPoints = [];
    }

    _touchToMouse(e) {
        const touch = e.touches[0] || e.changedTouches[0];
        const rect = this.canvas.getBoundingClientRect();
        return { offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top };
    }

    _getPos(e) {
        return { x: e.offsetX, y: e.offsetY };
    }

    _onMouseDown(e) {
        if (this.mode !== 'manual') return;
        const pos = this._getPos(e);
        const color = this._getActiveColor();

        if (this.tool === 'polygon') {
            this.polygonPoints.push(pos);
            this._drawPolygonPreview();
            return;
        }

        this.isDrawing = true;
        this._saveHistory();
        this.ctx.beginPath();
        this.ctx.moveTo(pos.x, pos.y);

        if (this.tool === 'eraser') {
            this.ctx.globalCompositeOperation = 'destination-out';
        } else {
            this.ctx.globalCompositeOperation = 'source-over';
        }

        this.ctx.lineWidth = this.brushSize;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.strokeStyle = color.display;

        // Draw a dot for single click
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, this.brushSize / 2, 0, Math.PI * 2);
        this.ctx.fillStyle = color.display;
        if (this.tool === 'eraser') {
            this.ctx.globalCompositeOperation = 'destination-out';
            this.ctx.fillStyle = 'rgba(0,0,0,1)';
        }
        this.ctx.fill();

        this.ctx.beginPath();
        this.ctx.moveTo(pos.x, pos.y);
    }

    _onMouseMove(e) {
        const pos = this._getPos(e);

        // Update cursor
        if (this.mode === 'manual' && (this.tool === 'brush' || this.tool === 'eraser')) {
            this.cursor.style.display = 'block';
            const rect = this.canvas.getBoundingClientRect();
            this.cursor.style.left = (e.offsetX + rect.left - this.canvas.parentElement.getBoundingClientRect().left) + 'px';
            this.cursor.style.top = (e.offsetY + rect.top - this.canvas.parentElement.getBoundingClientRect().top) + 'px';
            this.cursor.style.width = this.brushSize + 'px';
            this.cursor.style.height = this.brushSize + 'px';
        } else {
            this.cursor.style.display = 'none';
        }

        if (!this.isDrawing || this.mode !== 'manual') return;
        if (this.tool === 'polygon') return;

        this.ctx.lineTo(pos.x, pos.y);
        this.ctx.stroke();
    }

    _onMouseUp() {
        if (this.isDrawing) {
            this.ctx.globalCompositeOperation = 'source-over';
        }
        this.isDrawing = false;
    }

    _drawPolygonPreview() {
        if (this.polygonPoints.length < 2) return;
        const color = this._getActiveColor();
        const lastState = this.history[this.history.length - 1];
        if (lastState) {
            this.ctx.putImageData(lastState, 0, 0);
        }
        this.ctx.beginPath();
        this.ctx.moveTo(this.polygonPoints[0].x, this.polygonPoints[0].y);
        for (let i = 1; i < this.polygonPoints.length; i++) {
            this.ctx.lineTo(this.polygonPoints[i].x, this.polygonPoints[i].y);
        }
        this.ctx.strokeStyle = color.preview;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Draw points
        this.polygonPoints.forEach(p => {
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            this.ctx.fillStyle = color.preview;
            this.ctx.fill();
        });
    }

    _closePolygon() {
        if (this.polygonPoints.length < 3) return;
        const color = this._getActiveColor();

        this._saveHistory();

        const lastState = this.history[this.history.length - 1];
        if (lastState) {
            this.ctx.putImageData(lastState, 0, 0);
        }

        this.ctx.beginPath();
        this.ctx.moveTo(this.polygonPoints[0].x, this.polygonPoints[0].y);
        for (let i = 1; i < this.polygonPoints.length; i++) {
            this.ctx.lineTo(this.polygonPoints[i].x, this.polygonPoints[i].y);
        }
        this.ctx.closePath();
        this.ctx.fillStyle = color.display;
        this.ctx.fill();

        this.polygonPoints = [];
    }

    _saveHistory() {
        const data = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        this.history.push(data);
        if (this.history.length > 30) this.history.shift();
    }

    _undo() {
        if (this.history.length <= 1) return;
        this.history.pop();
        const prev = this.history[this.history.length - 1];
        this.ctx.putImageData(prev, 0, 0);
        this.polygonPoints = [];
    }

    _clear() {
        this._saveHistory();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.polygonPoints = [];
    }

    _updateCursor() {
        this.cursor.style.width = this.brushSize + 'px';
        this.cursor.style.height = this.brushSize + 'px';
    }

    /**
     * Snap a pixel's RGB to the nearest known material color or black.
     */
    _snapColor(r, g, b, a) {
        if (a < 20) return { r: 0, g: 0, b: 0 }; // transparent -> black (no mask)

        // Find dominant channel
        let bestMat = null;
        let bestScore = -1;

        for (const [mat, color] of Object.entries(this.MATERIAL_COLORS)) {
            // Score = how closely this pixel matches the material color
            const score = (color.r > 0 ? r : 0) + (color.g > 0 ? g : 0) + (color.b > 0 ? b : 0);
            const penalty = (color.r === 0 ? r : 0) + (color.g === 0 ? g : 0) + (color.b === 0 ? b : 0);
            const net = score - penalty;
            if (net > bestScore) {
                bestScore = net;
                bestMat = mat;
            }
        }

        if (bestMat && bestScore > 30) {
            const c = this.MATERIAL_COLORS[bestMat];
            return { r: c.r, g: c.g, b: c.b };
        }
        return { r: 0, g: 0, b: 0 };
    }

    _confirm() {
        let maskData = null;
        let maskMode = this.mode;

        if (this.mode === 'manual') {
            // Generate color-coded mask at original resolution
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = this.currentImage.width;
            maskCanvas.height = this.currentImage.height;
            const mCtx = maskCanvas.getContext('2d');

            // Get mask pixels from display canvas
            const displayData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.canvas.width;
            tempCanvas.height = this.canvas.height;
            const tCtx = tempCanvas.getContext('2d');

            // Convert to clean color-coded mask (snap colors)
            const outData = tCtx.createImageData(this.canvas.width, this.canvas.height);
            for (let i = 0; i < displayData.data.length; i += 4) {
                const r = displayData.data[i];
                const g = displayData.data[i + 1];
                const b = displayData.data[i + 2];
                const a = displayData.data[i + 3];

                const snapped = this._snapColor(r, g, b, a);
                outData.data[i] = snapped.r;
                outData.data[i + 1] = snapped.g;
                outData.data[i + 2] = snapped.b;
                outData.data[i + 3] = 255;
            }
            tCtx.putImageData(outData, 0, 0);

            // Scale to original resolution
            mCtx.fillStyle = '#000';
            mCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
            mCtx.imageSmoothingEnabled = false;
            mCtx.drawImage(tempCanvas, 0, 0, maskCanvas.width, maskCanvas.height);

            maskData = maskCanvas.toDataURL('image/png');
        }

        if (this.onConfirm) {
            this.onConfirm({
                mode: maskMode,
                maskDataURL: maskData,
                previewDataURL: this.mode === 'manual' ? this.canvas.toDataURL('image/png') : null
            });
        }

        this.close();
    }
}

// Global instance
window.maskTool = new MaskTool();
