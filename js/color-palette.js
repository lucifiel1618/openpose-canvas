export class ColorPicker {
    constructor() {
        this.h = 0; // 0-360
        this.s = 100; // 0-100
        this.v = 100; // 0-100
        this.r = 255;
        this.g = 0;
        this.b = 0;
        this.isOpen = false;
        this.callback = null; // Function to call on color change
        this.targetElement = null; // The button that triggered the picker
        this.element = null; // The popup DOM element

        this._createDOM();
        this._bindEvents();
    }

    _createDOM() {
        this.element = document.createElement('div');
        this.element.className = 'color-picker-popup hidden';
        this.element.innerHTML = `
            <div class="color-picker-sv-wrapper" id="cp-sv">
                <div class="color-picker-sv-bg" style="background: linear-gradient(transparent, black), linear-gradient(to right, white, transparent), rgb(255, 0, 0);"></div>
                <div class="color-picker-sv-handle" id="cp-sv-handle"></div>
            </div>
            
            <div class="color-picker-hue-wrapper" id="cp-hue">
                <div class="color-picker-hue-handle" id="cp-hue-handle"></div>
            </div>

            <div class="color-picker-inputs-row">
                <div class="color-picker-preview" id="cp-preview"></div>
                <div class="color-picker-inputs-group">
                    <label class="color-picker-input-label">
                        <span>R</span>
                        <input type="number" min="0" max="255" class="color-picker-input" id="cp-input-r">
                    </label>
                    <label class="color-picker-input-label">
                        <span>G</span>
                        <input type="number" min="0" max="255" class="color-picker-input" id="cp-input-g">
                    </label>
                    <label class="color-picker-input-label">
                        <span>B</span>
                        <input type="number" min="0" max="255" class="color-picker-input" id="cp-input-b">
                    </label>
                </div>
            </div>
        `;
        document.body.appendChild(this.element);

        this.svContainer = this.element.querySelector('#cp-sv');
        this.svBg = this.element.querySelector('.color-picker-sv-bg');
        this.svHandle = this.element.querySelector('#cp-sv-handle');
        this.hueContainer = this.element.querySelector('#cp-hue');
        this.hueHandle = this.element.querySelector('#cp-hue-handle');
        this.preview = this.element.querySelector('#cp-preview');
        
        this.inputR = this.element.querySelector('#cp-input-r');
        this.inputG = this.element.querySelector('#cp-input-g');
        this.inputB = this.element.querySelector('#cp-input-b');
    }

    _bindEvents() {
        // Saturation/Value Dragging
        const handleSVDrag = (e) => {
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const rect = this.svContainer.getBoundingClientRect();
            let x = clientX - rect.left;
            let y = clientY - rect.top;

            x = Math.max(0, Math.min(x, rect.width));
            y = Math.max(0, Math.min(y, rect.height));

            this.s = (x / rect.width) * 100;
            this.v = 100 - (y / rect.height) * 100;

            this._updateColorFromHSV();
        };

        const startSVDrag = (e) => {
            e.preventDefault(); // Prevent scrolling on touch
            handleSVDrag(e);
            document.addEventListener('mousemove', handleSVDrag);
            document.addEventListener('touchmove', handleSVDrag, { passive: false });
            document.addEventListener('mouseup', stopSVDrag);
            document.addEventListener('touchend', stopSVDrag);
        };

        const stopSVDrag = () => {
            document.removeEventListener('mousemove', handleSVDrag);
            document.removeEventListener('touchmove', handleSVDrag);
            document.removeEventListener('mouseup', stopSVDrag);
            document.removeEventListener('touchend', stopSVDrag);
            
            // Auto close on release
            this.hide();
        };

        this.svContainer.addEventListener('mousedown', startSVDrag);
        this.svContainer.addEventListener('touchstart', startSVDrag, { passive: false });

        // Hue Dragging
        const handleHueDrag = (e) => {
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const rect = this.hueContainer.getBoundingClientRect();
            let x = clientX - rect.left;
            x = Math.max(0, Math.min(x, rect.width));
            
            this.h = (x / rect.width) * 360;
            
            this._updateColorFromHSV();
        };

        const startHueDrag = (e) => {
            e.preventDefault();
            handleHueDrag(e);
            document.addEventListener('mousemove', handleHueDrag);
            document.addEventListener('touchmove', handleHueDrag, { passive: false });
            document.addEventListener('mouseup', stopHueDrag);
            document.addEventListener('touchend', stopHueDrag);
        };

        const stopHueDrag = () => {
            document.removeEventListener('mousemove', handleHueDrag);
            document.removeEventListener('touchmove', handleHueDrag);
            document.removeEventListener('mouseup', stopHueDrag);
            document.removeEventListener('touchend', stopHueDrag);
            
            // Auto close on release
            this.hide();
        };

        this.hueContainer.addEventListener('mousedown', startHueDrag);
        this.hueContainer.addEventListener('touchstart', startHueDrag, { passive: false });

        // Inputs
        const updateFromRGBInput = () => {
            this.r = parseInt(this.inputR.value) || 0;
            this.g = parseInt(this.inputG.value) || 0;
            this.b = parseInt(this.inputB.value) || 0;
            this._updateColorFromRGB();
        };

        [this.inputR, this.inputG, this.inputB].forEach(input => {
            input.addEventListener('change', updateFromRGBInput);
            input.addEventListener('input', updateFromRGBInput);
        });

        // Close when clicking outside
        document.addEventListener('mousedown', (e) => {
            if (this.isOpen && 
                !this.element.contains(e.target) && 
                this.targetElement && 
                !this.targetElement.contains(e.target)) {
                this.hide();
            }
        });
    }

    /**
     * Open the color picker.
     * @param {HTMLElement} targetElement - The button/element that triggered the picker.
     * @param {string|function} initialColor - Hex color string (e.g., "#FF0000") or a function that returns a hex color string.
     * @param {Function} callback - Function called with new hex color string on change.
     */
    open(targetElement, initialColor, callback) {
        this.targetElement = targetElement;
        this.callback = callback;
        this.isOpen = true;
        this.element.classList.remove('hidden');

        // console.trace("Opening color picker with initial color:", initialColor);
        // Initialize color
        if (initialColor) {
            if (!this.isColorHex(initialColor)) {
                initialColor = this._strToHex(initialColor);
            }
            this._updateColorFromHex(initialColor);
        } else {
            // Default red if no color provided
            this.h = 0; this.s = 100; this.v = 100;
            this._updateColorFromHSV(); 
        }

        // Position
        this._position(targetElement);
    }

    openWithColorCallable(targetElement, colorCallable, callback) {
        this.open(targetElement, colorCallable(), callback);
    }

    hide() {
        this.isOpen = false;
        this.element.classList.add('hidden');
        this.targetElement = null;
        this.callback = null;
    }

    _position(target) {
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const popupRect = this.element.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        let top = rect.bottom + window.scrollY + 5;
        let left = rect.left + window.scrollX;

        // Check overflow
        if (left + popupRect.width > windowWidth) {
            left = windowWidth - popupRect.width - 10;
        }
        if (top + popupRect.height > windowHeight) {
            // Try positioning above
            const topAbove = rect.top + window.scrollY - popupRect.height - 5;
            if (topAbove > 0) {
                top = topAbove;
            } else {
                // If neither fits well, stick to bottom but shift up if needed (rare)
                top = windowHeight - popupRect.height - 10;
            }
        }

        this.element.style.top = `${top}px`;
        this.element.style.left = `${left}px`;
    }

    _updateColorFromHSV() {
        // Update RGB from HSV
        const { r, g, b } = this._hsvToRgb(this.h, this.s, this.v);
        this.r = r;
        this.g = g;
        this.b = b;

        this._updateUI();
    }

    _updateColorFromRGB() {
        // Clamp values
        this.r = Math.max(0, Math.min(255, this.r));
        this.g = Math.max(0, Math.min(255, this.g));
        this.b = Math.max(0, Math.min(255, this.b));

        // Update HSV
        const { h, s, v } = this._rgbToHsv(this.r, this.g, this.b);
        this.h = h;
        this.s = s;
        this.v = v;

        this._updateUI();
    }

    isColorHex(str) {
        return /^#[0-9A-Fa-f]{6}$/.test(str);
    }

    _updateColorFromHex(hex) {
        const r = parseInt(hex.substring(1, 3), 16);
        const g = parseInt(hex.substring(3, 5), 16);
        const b = parseInt(hex.substring(5, 7), 16);

        this.r = r;
        this.g = g;
        this.b = b;

        const { h, s, v } = this._rgbToHsv(r, g, b);
        this.h = h;
        this.s = s;
        this.v = v;

        this._updateUI();
    }

    _updateUI() {
        // Handles positions
        const huePercent = this.h / 360;
        this.hueHandle.style.left = `${huePercent * 100}%`;

        this.svHandle.style.left = `${this.s}%`;
        this.svHandle.style.top = `${100 - this.v}%`;
        this.svHandle.style.backgroundColor = this._rgbToHex(this.r, this.g, this.b);

        // Background color of SV area (pure hue)
        const pureHue = this._hsvToRgb(this.h, 100, 100);
        this.svBg.style.background = `linear-gradient(transparent, black), linear-gradient(to right, white, transparent), rgb(${pureHue.r}, ${pureHue.g}, ${pureHue.b})`;

        // Inputs
        this.inputR.value = Math.round(this.r);
        this.inputG.value = Math.round(this.g);
        this.inputB.value = Math.round(this.b);

        const hex = this._rgbToHex(this.r, this.g, this.b);
        this.preview.style.backgroundColor = hex;

        // Callback
        if (this.callback) {
            this.callback(hex);
        }
    }

    // --- Helpers ---

    _hsvToRgb(h, s, v) {
        let r, g, b;
        const i = Math.floor(h / 60) % 6;
        const f = h / 60 - i;
        const p = (v / 100) * (1 - s / 100);
        const q = (v / 100) * (1 - f * s / 100);
        const t = (v / 100) * (1 - (1 - f) * s / 100);
        const val = v / 100;

        switch (i) {
            case 0: r = val; g = t; b = p; break;
            case 1: r = q; g = val; b = p; break;
            case 2: r = p; g = val; b = t; break;
            case 3: r = p; g = q; b = val; break;
            case 4: r = t; g = p; b = val; break;
            case 5: r = val; g = p; b = q; break;
        }

        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255)
        };
    }

    _rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, v = max;

        const d = max - min;
        s = max === 0 ? 0 : d / max;

        if (max === min) {
            h = 0; // achromatic
        } else {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        return {
            h: h * 360,
            s: s * 100,
            v: v * 100
        };
    }

    _rgbToHex(r, g, b) {
        const toHex = (c) => {
            const hex = Math.round(c).toString(16);
            return hex.length === 1 ? "0" + hex : hex;
        };
        return "#" + toHex(r) + toHex(g) + toHex(b);
    }

    _strToHex(color) {
        const temp = document.createElement("div");
        temp.style.color = color;
        document.body.appendChild(temp);

        const computedColor = getComputedStyle(temp).color;
        document.body.removeChild(temp);

        // computedColor will be in rgb(...) format
        const rgb = computedColor.match(/\d+/g).map(Number);

        return (
            "#" +
            rgb
            .map(x => x.toString(16).padStart(2, "0"))
            .join("")
        );
    }
}
