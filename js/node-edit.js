export class NodeEditManager {
    constructor(canvasManager) {
        this.canvasManager = canvasManager;
        canvasManager.setNodeEditManager(this);
        this.overlayEl = document.getElementById('node-edit-overlay');
        this.active = false;
        this._resolve = null;
        this._reject = null;
    }

    /**
     * Opens the overlay and waits for a single click or Escape key.
     * @returns {Promise<{x: number, y: number}>}
     */
    async pickPosition() {
        if (this.active) return;
        this.active = true;

        this.overlayEl.classList.add('active');
        this.overlayEl.addEventListener('click', this._onClick, true);
        window.addEventListener('keydown', this._onKeyDown);

        return new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }

    _cleanup() {
        this.active = false;
        this.overlayEl.classList.remove('active');
        this.overlayEl.removeEventListener('mousedown', this._onClick, true);
        window.removeEventListener('keydown', this._onKeyDown);
        this._resolve = null;
        this._reject = null;
    }

    _onClick = (evt) => {
        evt.preventDefault();
        evt.stopPropagation();

        const stage = this.canvasManager.stage;
        // Set the pointer position manually
        stage.setPointersPositions({clientX: evt.clientX, clientY: evt.clientY});
        // Now use Konva's method which handles everything
        const pos = stage.getRelativePointerPosition();
        if (pos && this._resolve) {
            const result = { x: pos.x, y: pos.y };
            const resolveRef = this._resolve; 
            this._cleanup();
            resolveRef(result);
        }
    };

    _onKeyDown = (evt) => {
        if (evt.key === 'Escape' && this._reject) {
            this._cleanup();
            // Using a string or Error object to signal cancellation
            this._reject(new Error('USER_CANCELLED'));
        }
    };
}