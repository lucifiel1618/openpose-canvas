import { dataAccessManager } from './openpose-probe.js';

export class ToolbarManager {
    constructor(canvasManager) {
        this.canvasManager = canvasManager;
        if (this.canvasManager.setToolbarManager) {
            this.canvasManager.setToolbarManager(this);
        }
        this.isPanMode = false;
        this.panStartPos = null;
        this.stageStartPos = null;
        
        // Debounce timers for page size inputs - REMOVED
    }

    init() {
        // Ensure DOM is ready before accessing elements
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupToolbarControls());
        } else {
            this.setupToolbarControls();
        }
    }

    setupToolbarControls() {
        // Get all toolbar buttons with null checks
        const panBtn = document.getElementById('panBtn');
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        const zoomInput = document.getElementById('zoomInput');
        const zoomDrawingBtn = document.getElementById('zoomDrawingBtn');
        const fitToPageBtn = document.getElementById('fitToPageBtn');
        const undoBtn = document.getElementById('undoBtn');
        const wysiwygBtn = document.getElementById('wysiwygBtn');
        const redoBtn = document.getElementById('redoBtn');
        const exportBtn = document.getElementById('exportBtn');
        const pageWidthInput = document.getElementById('pageWidth');
        const pageHeightInput = document.getElementById('pageHeight');

        // Attach button listeners with null checks
        panBtn?.addEventListener('click', () => this.togglePanMode());
        zoomInBtn?.addEventListener('click', () => this.canvasManager.zoomIn());
        zoomOutBtn?.addEventListener('click', () => this.canvasManager.zoomOut());
        
        zoomInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.canvasManager.applyZoomInput();
                zoomInput.blur();
            }
        });

        zoomInput?.addEventListener('blur', () => {
            this.canvasManager.applyZoomInput();
        });
        
        zoomDrawingBtn?.addEventListener('click', () => this.canvasManager.zoomToDrawing());
        fitToPageBtn?.addEventListener('click', () => this.canvasManager.fitToPage());
        undoBtn?.addEventListener('click', () => this.canvasManager.undo());
        wysiwygBtn?.addEventListener('click', () => this.toggleWYSIWYG());
        redoBtn?.addEventListener('click', () => this.canvasManager.redo());
        exportBtn?.addEventListener('click', () => this.exportPoseData());

        // Setup page size input listeners
        pageWidthInput?.addEventListener('change', (e) => {
            this.handlePageSizeChange('width', e.target.value);
        });
        
        pageHeightInput?.addEventListener('change', (e) => {
            this.handlePageSizeChange('height', e.target.value);
        });

        // Initialize page inputs with current values
        this.initializePageInputs();

        // Setup pan mode listeners on the stage
        this.setupPanListeners();
        
        // Initialize undo/redo state
        this.updateUndoRedoState(false, false);
    }

    toggleWYSIWYG() {
        const wysiwygBtn = document.getElementById('wysiwygBtn');
        const isEnabled = this.canvasManager.viewMode === 'WYSIWYG';
        
        this.canvasManager.toggleWYSIWYG(!isEnabled);
        
        if (this.canvasManager.viewMode === 'WYSIWYG') {
            wysiwygBtn.classList.add('active');
        } else {
            wysiwygBtn.classList.remove('active');
        }
    }

    togglePanMode() {
        this.isPanMode = !this.isPanMode;
        const panBtn = document.getElementById('panBtn');
        
        if (this.isPanMode) {
            panBtn.classList.add('active');
            document.body.style.cursor = 'grab';
        } else {
            panBtn.classList.remove('active');
            document.body.style.cursor = 'default';
        }
    }

    setupPanListeners() {
        const stage = this.canvasManager?.stage;
        const container = document.getElementById('openpose-canvas');
        
        if (!stage || !container) return;

        container.addEventListener('mousedown', (e) => {
            if (!this.isPanMode) return;
            
            document.body.style.cursor = 'grabbing';
            this.panStartPos = { x: e.clientX, y: e.clientY };
            this.stageStartPos = { x: stage.x(), y: stage.y() };
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isPanMode || !this.panStartPos) return;

            const dx = e.clientX - this.panStartPos.x;
            const dy = e.clientY - this.panStartPos.y;

            stage.x(this.stageStartPos.x + dx);
            stage.y(this.stageStartPos.y + dy);
            stage.batchDraw();
        });

        document.addEventListener('mouseup', () => {
            this.panStartPos = null;
            this.stageStartPos = null;
            if (this.isPanMode) {
                document.body.style.cursor = 'grab';
            }
        });
    }



    /**
     * Handle page size input changes
     * @param {string} dimension - 'width' or 'height'
     * @param {string} value - New value from input
     */
    handlePageSizeChange(dimension, value) {
        const numValue = parseInt(value);
        const currentPageSize = this.canvasManager.getPageSize();
        
        if (isNaN(numValue) || numValue < 100) {
            // Reset to last valid value if invalid
            const input = document.getElementById('page' + dimension.charAt(0).toUpperCase() + dimension.slice(1));
            if (input) {
                input.value = currentPageSize[dimension];
            }
            return;
        }
        
        if (dimension === 'width') {
            this.canvasManager.changePageSize(numValue, currentPageSize.height);
        } else {
            this.canvasManager.changePageSize(currentPageSize.width, numValue);
        }
    }

    /**
     * Initialize page size inputs with current canvas values
     */
    initializePageInputs() {
        const currentPageSize = this.canvasManager.getPageSize();
        
        const widthInput = document.getElementById('pageWidth');
        const heightInput = document.getElementById('pageHeight');
        
        if (widthInput) {
            widthInput.value = currentPageSize.width;
        }
        if (heightInput) {
            heightInput.value = currentPageSize.height;
        }
    }



    /**
     * Export all pose data from all layers to a JSON file
     */
    async exportPoseData() {
        try {
            const format = await this.showExportFormatDialog();
            if (!format) return;

            if (format === 'PNG') {
                await this.exportAsPng();
                return;
            }

            // Collect all pose data from all layers
            const allPoseData = await this.collectAllPoseData(format);
            
            // Check if we have any pose data to export
            let hasData = false;
            if (Array.isArray(allPoseData)) {
                if (allPoseData.length > 0) {
                    if (allPoseData[0].people) {
                        hasData = allPoseData[0].people.length > 0;
                    } else {
                        hasData = true; // Direct array of data
                    }
                }
            } else if (allPoseData && typeof allPoseData === 'object') {
                hasData = Object.keys(allPoseData).length > 0;
            }
            
            if (!hasData) {
                this.showExportError('No pose data found to export.');
                return;
            }

            // Show save dialog
            const fileName = await this.showSaveDialog(format);
            if (!fileName) return; // User cancelled

            // Save the file
            this.saveJsonFile(allPoseData, fileName);
            
            // Calculate and log number of exported persons
            let exportedCount = 0;
            if (Array.isArray(allPoseData)) {
                if (allPoseData.length > 0 && allPoseData[0].people) {
                    exportedCount = allPoseData[0].people.length;

                } else {
                    exportedCount = allPoseData.length;
                }
            } else if (allPoseData && typeof allPoseData === 'object') {
                exportedCount = Object.keys(allPoseData).length;
            }
            
            console.log(`Exported ${exportedCount} person(s) to ${fileName}`);
        } catch (error) {
            console.error('Export failed:', error);
            this.showExportError(`Export failed: ${error.message}`);
        }
    }

    /**
     * Show format selection dialog
     */
    showExportFormatDialog() {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            `;

            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                max-width: 400px;
            `;

            dialog.innerHTML = `
                <h3 style="margin-top: 0; color: #333;">Export Pose Data</h3>
                <p style="color: #666; margin-bottom: 20px;">Choose export format:</p>
                <select id="formatSelect" style="width: 100%; padding: 8px; margin-bottom: 20px; border: 1px solid #ccc; border-radius: 4px;">
                    <option value="BODY18">ControlNet Standard</option>
                    <option value="BODY18COMFYUI">ComfyUI Enhanced</option>
                    <option value="BODY25">Body-25 Full</option>
                    <option value="PNG">PNG Image</option>
                </select>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="cancelBtn" style="padding: 8px 16px; border: 1px solid #ccc; background: white; border-radius: 4px; cursor: pointer;">Cancel</button>
                    <button id="exportBtn" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Export</button>
                </div>
            `;

            modal.appendChild(dialog);
            document.body.appendChild(modal);

            const cancelBtn = dialog.querySelector('#cancelBtn');
            const exportBtn = dialog.querySelector('#exportBtn');
            const formatSelect = dialog.querySelector('#formatSelect');

            cancelBtn.onclick = () => {
                document.body.removeChild(modal);
                resolve(null);
            };

            exportBtn.onclick = () => {
                const selectedFormat = formatSelect.value;
                document.body.removeChild(modal);
                resolve(selectedFormat);
            };

            modal.onclick = (e) => {
                if (e.target === modal) {
                    document.body.removeChild(modal);
                    resolve(null);
                }
            };
        });
    }

    /**
     * Show save dialog
     */
    showSaveDialog(format) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            `;

            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                max-width: 400px;
            `;

            const isPng = format === 'PNG';
            const extension = isPng ? 'png' : 'json';
            const defaultFileName = isPng 
                ? `openpose-${Date.now()}.png`
                : `openpose-${format.toLowerCase()}-${Date.now()}.json`;
            const title = isPng ? 'Save PNG' : 'Save File';
            const hint = isPng ? 'PNG Image' : `${format} Data`;

            dialog.innerHTML = `
                <h3 style="margin-top: 0; color: #333;">${title}</h3>
                <p style="color: #666; margin-bottom: 20px;">Enter filename (${hint}):</p>
                <input type="text" id="fileNameInput" value="${defaultFileName}" style="width: 100%; padding: 8px; margin-bottom: 20px; border: 1px solid #ccc; border-radius: 4px;">
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="cancelBtn" style="padding: 8px 16px; border: 1px solid #ccc; background: white; border-radius: 4px; cursor: pointer;">Cancel</button>
                    <button id="saveBtn" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Save</button>
                </div>
            `;

            modal.appendChild(dialog);
            document.body.appendChild(modal);

            const cancelBtn = dialog.querySelector('#cancelBtn');
            const saveBtn = dialog.querySelector('#saveBtn');
            const fileNameInput = dialog.querySelector('#fileNameInput');

            cancelBtn.onclick = () => {
                document.body.removeChild(modal);
                resolve(null);
            };

            saveBtn.onclick = () => {
                const fileName = fileNameInput.value.trim() || defaultFileName;
                if (!fileName.endsWith(`.${extension}`)) {
                    fileNameInput.value = fileName + `.${extension}`;
                }
                document.body.removeChild(modal);
                resolve(fileNameInput.value);
            };

            fileNameInput.focus();
            fileNameInput.select();

            modal.onclick = (e) => {
                if (e.target === modal) {
                    document.body.removeChild(modal);
                    resolve(null);
                }
            };
        });
    }

    /**
     * Collect all pose data from all layers
     */
    async collectAllPoseData(format) {
        let toJson = null;
        const persons = this.canvasManager.scene.persons || [];
        console.log(`Found ${persons.length} persons in scene`);
        
        // Convert each person to the requested format
        for (const person of persons) {
            toJson = await dataAccessManager.exportPersonAsOpenPoseJson(person, format, toJson);
        }

        return toJson;
    }

    /**
     * Save JSON data to file
     */
    saveJsonFile(data, fileName) {
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Clean up
        URL.revokeObjectURL(url);
    }

    async exportAsPng() {
        const fileName = await this.showSaveDialog('PNG');
        if (!fileName) return;

        const pageSize = this.canvasManager.getPageSize();
        const stage = this.canvasManager.stage;

        const oldScale = stage.scaleX();
        const oldX = stage.x();
        const oldY = stage.y();

        stage.scale({ x: 1, y: 1 });
        stage.position({ x: 0, y: 0 });
        stage.batchDraw();

        const dataURL = stage.toDataURL({
            pixelRatio: 1,
            x: 0,
            y: 0,
            width: pageSize.width,
            height: pageSize.height,
            mimeType: 'image/png'
        });

        stage.scale({ x: oldScale, y: oldScale });
        stage.position({ x: oldX, y: oldY });
        stage.batchDraw();

        const a = document.createElement('a');
        a.href = dataURL;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        console.log(`Exported PNG to ${fileName}`);
    }

    /**
     * Show export error message
     */
    showExportError(message) {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #dc3545;
            color: white;
            padding: 12px 20px;
            border-radius: 4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            z-index: 10001;
            max-width: 300px;
        `;
        
        modal.textContent = message;
        document.body.appendChild(modal);
        
        setTimeout(() => {
            if (document.body.contains(modal)) {
                document.body.removeChild(modal);
            }
        }, 5000);
    }

    /**
     * Update enabled/disabled state of undo/redo buttons
     * @param {boolean} canUndo 
     * @param {boolean} canRedo 
     */
    updateUndoRedoState(canUndo, canRedo) {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');

        if (undoBtn) {
            undoBtn.disabled = !canUndo;
            // Optional: visual indication if CSS doesn't handle :disabled
            undoBtn.style.opacity = canUndo ? '1' : '0.5';
            undoBtn.style.cursor = canUndo ? 'pointer' : 'default';
        }

        if (redoBtn) {
            redoBtn.disabled = !canRedo;
            redoBtn.style.opacity = canRedo ? '1' : '0.5';
            redoBtn.style.cursor = canRedo ? 'pointer' : 'default';
        }
    }
}
