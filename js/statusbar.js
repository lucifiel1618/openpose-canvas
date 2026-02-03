export class StatusBarManager {
    constructor(canvasManager) {
        this.canvasManager = canvasManager;
        this.statusBar = null;
        this.cursorCoords = { x: 0, y: 0 };
        this.lockButton = null;
        this.visButton = null;
        this.delNodeButton = null;
    }

    init() {
        this.createStatusBar();
        this.setupEventListeners();
        this.setupIconButtons();
        this.updateButtonStates();
    }

    createStatusBar() {
        this.statusBar = document.getElementById('statusbar');
        if (!this.statusBar) {
            console.warn('Statusbar element not found in HTML');
        }
        
        // Get reference to existing buttons
        this.lockButton = document.getElementById('lockBtn');
        this.visButton = document.getElementById('visBtn');
        this.delNodeButton = document.getElementById('delNodeBtn');
    }

    setupEventListeners() {
        const stage = this.canvasManager.stage;
        
        // Track mouse movement for cursor coordinates
        stage.on('mousemove', (e) => {
            // Use relative pointer position to account for zoom and pan
            const pos = stage.getRelativePointerPosition();
            if (pos) {
                this.cursorCoords = { x: Math.round(pos.x), y: Math.round(pos.y) };
                this.updateCursorPosition();
            }
        });

        // Hook into the selection transformer's updateSelection method
        if (this.canvasManager.selectionTransformer) {
            const originalUpdateSelection = this.canvasManager.selectionTransformer.updateSelection.bind(this.canvasManager.selectionTransformer);
            
            this.canvasManager.selectionTransformer.updateSelection = (...args) => {
                const result = originalUpdateSelection(...args);
                this.updateButtonStates();
                this.updateSelectionInfo();
                return result;
            };

            // Also hook into clearSelection and setSelection methods
            const originalClearSelection = this.canvasManager.selectionTransformer.clearSelection.bind(this.canvasManager.selectionTransformer);
            this.canvasManager.selectionTransformer.clearSelection = (...args) => {
                const result = originalClearSelection(...args);
                this.updateButtonStates();
                this.updateSelectionInfo();
                return result;
            };

            const originalSetSelection = this.canvasManager.selectionTransformer.setSelection.bind(this.canvasManager.selectionTransformer);
            this.canvasManager.selectionTransformer.setSelection = (...args) => {
                const result = originalSetSelection(...args);
                this.updateButtonStates();
                this.updateSelectionInfo();
                return result;
            };

            const originalAddToSelection = this.canvasManager.selectionTransformer.addToSelection.bind(this.canvasManager.selectionTransformer);
            this.canvasManager.selectionTransformer.addToSelection = (...args) => {
                const result = originalAddToSelection(...args);
                this.updateButtonStates();
                this.updateSelectionInfo();
                return result;
            };

            // Initial selection update
            this.updateSelectionInfo();
        }
    }

    setupIconButtons() {
        if (this.lockButton) {
            // Lock/Unlock button handler
            this.lockButton.addEventListener('click', () => {
                const selectedNodes = this.canvasManager.selectionTransformer.selectedNodes.filter(node => node.className === 'Point') || [];
                if (selectedNodes.length === 0) return;

                // Check if all are locked
                const allLocked = selectedNodes.every(node => node.getAttr('locked') === true);

                // If all locked, unlock all; otherwise lock all
                this.canvasManager.toggleNodesLock(selectedNodes, !allLocked);
                this.updateLockButtonStates();
            });
        }

        if (this.visButton) {
            // Show/Hide button handler
            this.visButton.addEventListener('click', () => {
                const selectedNodes = this.canvasManager.selectionTransformer.selectedNodes || [];
                if (selectedNodes.length === 0) return;

                // Check if all are visible
                const allVis = selectedNodes.every(node => node.visible());

                // If not all visible, show all; otherwise hide all
                this.canvasManager.toggleNodesVisibility(selectedNodes, !allVis);
                
                // Unselect invisible shapes
                const visibleNodes = selectedNodes.filter(node => node.visible());
                this.canvasManager.selectionTransformer.setSelection(visibleNodes);
                this.updateVisibleButtonStates();
            });
        }

        if (this.delNodeButton) {
            // Delete positions button handler
            this.delNodeButton.addEventListener('click', () => {
                const selectedNodes = this.canvasManager.selectionTransformer.selectedNodes || [];
                if (selectedNodes.length === 0) return;
                this.canvasManager.scene.lockStateChange();
                selectedNodes.forEach(node => {
                    if (node.className !== 'Point') return;
                    node.getAttr('entity').setPosition(null);
                });
                this.canvasManager.scene.unlockStateChange();
                this.canvasManager.scene.changeState(true);
            });
        }
    }

    async updateButtonStates() {
        this.updateLockButtonStates();
        this.updateVisibleButtonStates();
    }

    async updateVisibleButtonStates() {
        if (!this.visButton || !this.canvasManager.selectionTransformer) return;
        const selectedNodes = this.canvasManager.selectionTransformer.selectedNodes || [];
        if (selectedNodes.length === 0) {
            this.visButton.disabled = true;
            return;
        }
        this.visButton.disabled = false;

        // Update lock button icon based on selected nodes' lock status
        const visibleCount = selectedNodes.filter(node => node.visible() === true).length;
        const invisibleCount = selectedNodes.length - visibleCount;

        const visIcon = this.visButton.querySelector('img');
        if (visibleCount === selectedNodes.length) {
            // All hide
            visIcon.src = 'assets/icons/hide.svg';
            this.visButton.style.opacity = '1';
        } else if (invisibleCount === selectedNodes.length) {
            // All show
            visIcon.src = 'assets/icons/show.svg';
            this.visButton.style.opacity = '1';
        } else {
            // Mixed status - show gray show icon
            visIcon.src = 'assets/icons/show.svg';
            this.visButton.style.opacity = '0.5';
        }
    }

    async updateLockButtonStates() {
        if (!this.lockButton || !this.canvasManager.selectionTransformer) return;

        const selectedNodes = this.canvasManager.selectionTransformer.selectedNodes.filter(node => node.className === 'Point') || [];
        if (selectedNodes.length === 0) {
            this.lockButton.disabled = true;
            return;
        }

        this.lockButton.disabled = false;

        // Update lock button icon based on selected nodes' lock status
        const lockedCount = selectedNodes.filter(node => node.getAttr('locked') === true).length;
        const unlockedCount = selectedNodes.length - lockedCount;

        const lockIcon = this.lockButton.querySelector('img');
        if (lockedCount === selectedNodes.length) {
            // All locked
            lockIcon.src = 'assets/icons/lock.svg';
            this.lockButton.style.opacity = '1';
        } else if (unlockedCount === selectedNodes.length) {
            // All unlocked
            lockIcon.src = 'assets/icons/unlock.svg';
            this.lockButton.style.opacity = '1';
        } else {
            // Mixed status - show gray unlock icon
            lockIcon.src = 'assets/icons/unlock.svg';
            this.lockButton.style.opacity = '0.5';
        }
    }

    updateCursorPosition() {
        const positionElement = document.getElementById('cursor-position');
        if (positionElement) {
            positionElement.textContent = `X ${this.cursorCoords.x} Y ${this.cursorCoords.y}`;
        }
    }

    updateSelectionInfo() {
        const selectionElement = document.getElementById('selection-info');
        if (!selectionElement || !this.canvasManager.selectionTransformer) return;

        const selectedShapes = this.canvasManager.selectionTransformer.selectedNodes || [];

        if (selectedShapes.length === 0) {
            selectionElement.textContent = '-';
            return;
        }

        if (selectedShapes.length === 1) {
            const shape = selectedShapes[0];
            const name = shape.name() || shape.className || 'Unknown';
            const type = shape.type || shape.className || 'shape';
            selectionElement.textContent = `${name} (${type})`;
        } else {

            // Get the first selected shape's name
            const firstShape = selectedShapes[0];
            const firstName = firstShape.name() || firstShape.getClassName() || 'Unknown';
            const firstType = firstShape.type || firstShape.getClassName() || 'shape';

            // Count different shape types
            const shapeCounts = {};
            selectedShapes.slice(1).forEach(shape => {
                const type = shape.type || shape.getClassName() || 'shape';
                shapeCounts[type] = (shapeCounts[type] || 0) + 1;
            });

            // Build readable description
            const countParts = Object.entries(shapeCounts)
                .map(([type, count]) => `${count} ${type}${count !== 1 ? 's' : ''}`)
                .join(', ');

            selectionElement.textContent = `${firstName} (${firstType}) & ${countParts}`;
        }
    }
}