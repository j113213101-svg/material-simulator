/**
 * CropTool - 材料照裁切工具
 * 可拖拉裁切框，調整四角和四邊
 */
class CropTool {
    constructor() {
        this.modal = document.getElementById('crop-modal');
        this.canvas = document.getElementById('crop-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.cropBox = document.getElementById('crop-box');

        this.image = null;
        this.scaleRatio = 1;
        this.canvasRect = null;
        this.wrapRect = null;
        this.onConfirm = null;

        // Crop box state (in canvas pixel coords)
        this.crop = { x: 0, y: 0, w: 0, h: 0 };
        this.dragging = null; // null | 'move' | handle name
        this.dragStart = { x: 0, y: 0 };
        this.cropStart = { x: 0, y: 0, w: 0, h: 0 };

        this._bindEvents();
    }

    _bindEvents() {
        // Handles & box dragging
        this.cropBox.addEventListener('mousedown', (e) => this._onDragStart(e));
        document.addEventListener('mousemove', (e) => this._onDragMove(e));
        document.addEventListener('mouseup', () => this._onDragEnd());

        // Touch
        this.cropBox.addEventListener('touchstart', (e) => { e.preventDefault(); this._onDragStart(this._touchEvent(e)); });
        document.addEventListener('touchmove', (e) => { if (this.dragging) { e.preventDefault(); this._onDragMove(this._touchEvent(e)); } }, { passive: false });
        document.addEventListener('touchend', () => this._onDragEnd());

        // Confirm / Cancel
        document.getElementById('crop-confirm').addEventListener('click', () => this._confirm());
        document.getElementById('crop-cancel').addEventListener('click', () => this.close());
        document.getElementById('crop-modal-close').addEventListener('click', () => this.close());
    }

    open(imageDataURL, onConfirm) {
        this.onConfirm = onConfirm;
        this.modal.classList.remove('hidden');

        const img = new Image();
        img.onload = () => {
            this.image = img;
            const wrap = this.canvas.parentElement;
            const maxW = wrap.clientWidth - 40;
            const maxH = window.innerHeight * 0.6;
            this.scaleRatio = Math.min(maxW / img.width, maxH / img.height, 1);
            const w = Math.round(img.width * this.scaleRatio);
            const h = Math.round(img.height * this.scaleRatio);

            this.canvas.width = w;
            this.canvas.height = h;
            this.ctx.drawImage(img, 0, 0, w, h);

            // Default crop: 70% centered
            const margin = 0.15;
            this.crop = {
                x: Math.round(w * margin),
                y: Math.round(h * margin),
                w: Math.round(w * (1 - 2 * margin)),
                h: Math.round(h * (1 - 2 * margin))
            };

            this._updateCropBox();
            this.cropBox.style.display = 'block';
        };
        img.src = imageDataURL;
    }

    close() {
        this.modal.classList.add('hidden');
        this.cropBox.style.display = 'none';
    }

    _touchEvent(e) {
        const touch = e.touches[0] || e.changedTouches[0];
        return { clientX: touch.clientX, clientY: touch.clientY, target: e.target };
    }

    _onDragStart(e) {
        const handle = e.target.closest('.crop-handle');
        if (handle) {
            this.dragging = handle.dataset.handle;
        } else {
            this.dragging = 'move';
        }
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.cropStart = { ...this.crop };
    }

    _onDragMove(e) {
        if (!this.dragging) return;
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        const s = this.cropStart;
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        const minSize = 30;

        if (this.dragging === 'move') {
            this.crop.x = Math.max(0, Math.min(cw - s.w, s.x + dx));
            this.crop.y = Math.max(0, Math.min(ch - s.h, s.y + dy));
        } else {
            const d = this.dragging;
            let { x, y, w, h } = s;

            if (d.includes('w')) { x = s.x + dx; w = s.w - dx; }
            if (d.includes('e')) { w = s.w + dx; }
            if (d.includes('n')) { y = s.y + dy; h = s.h - dy; }
            if (d.includes('s')) { h = s.h + dy; }

            // Enforce minimum size
            if (w < minSize) { w = minSize; if (d.includes('w')) x = s.x + s.w - minSize; }
            if (h < minSize) { h = minSize; if (d.includes('n')) y = s.y + s.h - minSize; }

            // Clamp to canvas
            if (x < 0) { w += x; x = 0; }
            if (y < 0) { h += y; y = 0; }
            if (x + w > cw) w = cw - x;
            if (y + h > ch) h = ch - y;

            this.crop = { x, y, w, h };
        }

        this._updateCropBox();
    }

    _onDragEnd() {
        this.dragging = null;
    }

    _updateCropBox() {
        const rect = this.canvas.getBoundingClientRect();
        const wrapRect = this.canvas.parentElement.getBoundingClientRect();
        const offsetX = rect.left - wrapRect.left;
        const offsetY = rect.top - wrapRect.top;

        this.cropBox.style.left = (this.crop.x + offsetX) + 'px';
        this.cropBox.style.top = (this.crop.y + offsetY) + 'px';
        this.cropBox.style.width = this.crop.w + 'px';
        this.cropBox.style.height = this.crop.h + 'px';
    }

    _confirm() {
        if (!this.image) return;

        // Calculate crop in original image coords
        const ox = this.crop.x / this.scaleRatio;
        const oy = this.crop.y / this.scaleRatio;
        const ow = this.crop.w / this.scaleRatio;
        const oh = this.crop.h / this.scaleRatio;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = Math.round(ow);
        outCanvas.height = Math.round(oh);
        const outCtx = outCanvas.getContext('2d');
        outCtx.drawImage(this.image, ox, oy, ow, oh, 0, 0, outCanvas.width, outCanvas.height);

        const croppedDataURL = outCanvas.toDataURL('image/png');

        if (this.onConfirm) {
            this.onConfirm(croppedDataURL);
        }

        this.close();
    }
}

window.cropTool = new CropTool();
