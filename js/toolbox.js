import { dataAccessManager } from './openpose-probe.js';

export class ToolboxManager {
    /**
     * 
     * @param {import("./canvas").CanvasManager} canvasManager
     */
    constructor(canvasManager) {
        this.canvasManager = canvasManager;
        this.canvasManager.setToolboxManager(this);
        this.dataAccessManager = dataAccessManager;
        this.layerList = document.getElementById('layer-list');
        this.addLayerBtn = document.getElementById('addLayerBtn');
        this.addPointBtn = document.getElementById('addPointBtn');
        this.addLineBtn = document.getElementById('addLineBtn');
        this.addPersonBtn = document.getElementById('addPersonBtn');
        this.addImageBtn = document.getElementById('addImageBtn');
        this.draggedElement = null;
        this.fileInput = null;
        this.importTargetLayerIndex = null;
    }

    init() {
        this.addLayerBtn?.addEventListener('click', () => this.addLayer());
        this.addPointBtn?.addEventListener('click', () => this.addPoint());
        this.addLineBtn?.addEventListener('click', () => this.addLine());
        this.addPersonBtn?.addEventListener('click', () => this.addPerson());
        this.addImageBtn?.addEventListener('click', () => this.openImportDialog(this.canvasManager.currentLayerIndex));
        
        // Setup file drag-drop on addLayerBtn
        this.setupAddLayerBtnDragDrop();
        
        this.updateLayerList();
    }

    addLayer() {
        this.canvasManager.addLayer();
        this.updateLayerList();
    }

    addPoint() {
        if (!this.canvasManager.getCurrentPoseLayer()) {
            this.addLayer();
        }
        this.canvasManager.addPoint(150, 150); // Default position
    }

    addLine() {
        if (!this.canvasManager.getCurrentPoseLayer()) {
            this.addLayer();
        }
        this.canvasManager.addLine(250, 250, 350, 350); // Default positions
    }

    addPerson() {
        if (!this.canvasManager.getCurrentPoseLayer()) {
            this.addLayer();
        }
        this.canvasManager.addPerson();
    }

    addImage() {
        if (!this.canvasManager.getCurrentPoseLayer()) {
            this.addLayer();
        }
        this.canvasManager.addImage();
    }

    selectLayer(index) {
        this.canvasManager.setCurrentLayer(index);
        this.updateLayerList();
    }

    updateLayerList() {
        this.layerList.innerHTML = '';
        const layers = this.canvasManager.getLayers().slice().reverse(); // Reverse to show top layer first
        layers.forEach((layer, reversedIndex) => {
            const actualIndex = this.canvasManager.getLayers().length - 1 - reversedIndex;
            const layerItem = this.createLayerItem(layer, actualIndex);
            this.layerList.appendChild(layerItem);
        });
    }

    createLayerItem(layer, index) {
        const item = document.createElement('div');
        item.className = 'layer-item';
        if (index === this.canvasManager.currentLayerIndex) {
            item.classList.add('active');
        }
        item.draggable = true;
        item.dataset.index = index;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'layer-name';
        nameSpan.textContent = layer.name();
        nameSpan.addEventListener('dblclick', () => this.renameLayer(index, nameSpan));

        const visibilityBtn = document.createElement('button');
        const visibilityIcon = document.createElement('img');
        visibilityIcon.src = 'assets/icons/' + (layer.visible() ? 'show.svg' : 'hide.svg');
        visibilityIcon.className = 'layer-icon';
        visibilityIcon.alt = '';
        visibilityIcon.setAttribute('aria-hidden', 'true');
        visibilityBtn.appendChild(visibilityIcon);
        visibilityBtn.addEventListener('click', () => this.toggleVisibility(index, visibilityBtn));

        const lockBtn = document.createElement('button');
        const lockIcon = document.createElement('img');
        lockIcon.src = 'assets/icons/unlock.svg';
        lockIcon.className = 'layer-icon';
        lockIcon.alt = '';
        lockIcon.setAttribute('aria-hidden', 'true');
        lockBtn.appendChild(lockIcon);
        lockBtn.addEventListener('click', () => this.toggleLock(index, lockBtn));

        const importBtn = document.createElement('button');
        const importIcon = document.createElement('img');
        importIcon.src = 'assets/icons/import.svg';
        importIcon.className = 'layer-icon';
        importIcon.alt = '';
        importIcon.setAttribute('aria-hidden', 'true');
        importBtn.title = 'Import file (Person or Image)';
        importBtn.appendChild(importIcon);
        importBtn.addEventListener('click', () => this.openImportDialog(index));

        const deleteBtn = document.createElement('button');
        const deleteIcon = document.createElement('img');
        deleteIcon.src = 'assets/icons/delete.svg';
        deleteIcon.className = 'layer-icon';
        deleteIcon.alt = '';
        deleteIcon.setAttribute('aria-hidden', 'true');
        deleteBtn.appendChild(deleteIcon);
        deleteBtn.addEventListener('click', () => this.deleteLayer(index));

        item.appendChild(nameSpan);
        item.appendChild(visibilityBtn);
        item.appendChild(lockBtn);
        item.appendChild(importBtn);
        item.appendChild(deleteBtn);

        // Click to select layer
        item.addEventListener('click', (e) => {
            if (!e.target.closest('button')) { // Don't select if clicking buttons
                this.selectLayer(index);
            }
        });

        // Drag and drop events for reordering
        item.addEventListener('dragstart', (e) => this.onDragStart(e, index));
        item.addEventListener('dragover', (e) => this.onDragOver(e));
        item.addEventListener('drop', (e) => this.onDrop(e, index));
        item.addEventListener('dragend', () => this.onDragEnd());

        // File drag-drop support
        item.addEventListener('dragover', (e) => this.onLayerFileDragOver(e));
        item.addEventListener('dragleave', (e) => this.onLayerFileDragLeave(e));
        item.addEventListener('drop', (e) => this.onLayerFileDrop(e, index));

        return item;
    }

    renameLayer(index, nameSpan) {
        const input = document.createElement('input');
        input.value = nameSpan.textContent;
        input.style.width = '100%';
        nameSpan.replaceWith(input);
        input.focus();
        input.select();

        const saveName = () => {
            const newName = input.value.trim() || `Layer ${index + 1}`;
            this.canvasManager.renameLayer(index, newName);
            nameSpan.textContent = newName;
            input.replaceWith(nameSpan);
        };

        input.addEventListener('blur', saveName);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveName();
            if (e.key === 'Escape') {
                input.replaceWith(nameSpan);
            }
        });
    }

    toggleVisibility(index, btn) {
        this.canvasManager.toggleLayerVisibility(index);
        const layer = this.canvasManager.getLayers()[index];
        const icon = btn.querySelector('img');
        icon.src = 'assets/icons/' + (layer.visible() ? 'show.svg' : 'hide.svg');
    }

    toggleLock(index, btn) {
        this.canvasManager.toggleLayerLock(index);
        const layer = this.canvasManager.getLayers()[index];
        const icon = btn.querySelector('img');
        icon.src = 'assets/icons/' + (!layer.getAttr('locked') ? 'unlock.svg' : 'lock.svg');
    }

    deleteLayer(index) {
        this.canvasManager.deleteLayer(index);
        this.updateLayerList();
    }

    onDragStart(e, index) {
        this.draggedElement = e.target;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', e.target.outerHTML);
        e.target.classList.add('dragging');
    }

    onDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    onDrop(e, dropIndex) {
        e.preventDefault();
        const dragIndex = parseInt(this.draggedElement.dataset.index);
        if (dragIndex !== dropIndex) {
            this.canvasManager.reorderLayers(dragIndex, dropIndex);
            this.updateLayerList();
        }
    }

    onDragEnd() {
        if (this.draggedElement) {
            this.draggedElement.classList.remove('dragging');
            this.draggedElement = null;
        }
    }

    // ==================
    // FILE IMPORT METHODS
    // ==================

    /**
     * Create and open a file input dialog for importing files
     * @param {number} layerIndex - Target layer index
     */
    openImportDialog(layerIndex) {
        if (!this.fileInput) {
            this.fileInput = document.createElement('input');
            this.fileInput.type = 'file';
            this.fileInput.accept = '.json,.png,.jpg,.jpeg,.gif,.webp';
            this.fileInput.style.display = 'none';
            document.body.appendChild(this.fileInput);
            this.fileInput.addEventListener('change', (e) => this.handleFileImport(e));
        }
        
        this.importTargetLayerIndex = layerIndex;
        this.canvasManager.setCurrentLayer(layerIndex);
        this.fileInput.click();
        this.fileInput.value = ''; // Reset input
    }

    /**
     * Handle file import from file input dialog
     * @param {Event} event - File input change event
     */
    handleFileImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        const targetLayerIndex = this.importTargetLayerIndex;
        if (targetLayerIndex === null) return;

        this.canvasManager.setCurrentLayer(targetLayerIndex);
        this.importFile(file, targetLayerIndex);
    }

    /**
     * Import a file (JSON for person, image file for images) to a layer
     * @param {File} file - File to import
     * @param {number} layerIndex - Target layer index
     */
    importFile(file, layerIndex) {
        const fileExtension = file.name.split('.').pop().toLowerCase();

        if (fileExtension === 'json') {
            this.importJSONFile(file, layerIndex);
        } else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(fileExtension)) {
            this.importImageFile(file, layerIndex);
        } else {
            alert('Unsupported file type. Please use JSON or image files (PNG, JPG, GIF, WebP).');
        }
    }

    /**
     * Import JSON file (OpenPose format) as Person
     * @param {File} file - JSON file
     * @param {number} layerIndex - Target layer index
     */
    importJSONFile(file, layerIndex) {
        const jsonUrl = URL.createObjectURL(file);
        this.canvasManager.setCurrentLayer(layerIndex);
        
        fetch(jsonUrl)
            .then(res => res.json())
            .then(openPoseJsonData => 
                this.dataAccessManager.loadOpenPoseJsonToSkeletonData(openPoseJsonData)
            )
            .then(personDataArr => {
                personDataArr.forEach(personData => {
                    this.canvasManager.addPerson({x: 0, y: 0}, personData);
                });
                console.log(`JSON file ${file.name} imported successfully`);
            })
            .catch(error => {
                alert('Error importing JSON file: ' + error.message);
            })
            .finally(() => {
                URL.revokeObjectURL(jsonUrl);
            });
    }

    /**
     * Import image file as Image
     * @param {File} file - Image file
     * @param {number} layerIndex - Target layer index
     */
    importImageFile(file, layerIndex) {
        try {
            // Create a blob URL from the file
            const imageUrl = URL.createObjectURL(file);
            this.canvasManager.setCurrentLayer(layerIndex);
            this.canvasManager.addImage({x: 0, y: 0}, imageUrl);
            console.log('Image file imported successfully');
        } catch (error) {
            alert('Error importing image file: ' + error.message);
        }
    }

    /**
     * Setup drag-drop handlers for addLayerBtn to create new layer with imported file
     */
    setupAddLayerBtnDragDrop() {
        this.addLayerBtn.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            this.addLayerBtn.style.backgroundColor = '#e0e0e0';
        });

        this.addLayerBtn.addEventListener('dragleave', () => {
            this.addLayerBtn.style.backgroundColor = '';
        });

        this.addLayerBtn.addEventListener('drop', (e) => {
            e.preventDefault();
            this.addLayerBtn.style.backgroundColor = '';
            this.handleAddLayerWithFiles(e.dataTransfer.files);
        });
    }

    /**
     * Handle file drop on addLayerBtn - create new layer and import file
     * @param {FileList} files - Files dropped
     */
    handleAddLayerWithFiles(files) {
        if (files.length === 0) return;

        // Create new layer
        this.addLayer();
        const newLayerIndex = this.canvasManager.layers.length - 1;

        // Import first file to new layer
        const file = files[0];
        this.importFile(file, newLayerIndex);
    }

    /**
     * Handle file drag over a layer item
     * @param {DragEvent} e - Drag event
     */
    onLayerFileDragOver(e) {
        if (this.isFilesDragEvent(e)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            e.currentTarget.style.backgroundColor = '#f0f0f0';
            e.currentTarget.classList.add('drag-over');
        }
    }

    /**
     * Handle file drag leave from layer item
     * @param {DragEvent} e - Drag event
     */
    onLayerFileDragLeave(e) {
        e.currentTarget.style.backgroundColor = '';
        e.currentTarget.classList.remove('drag-over');
    }

    /**
     * Handle file drop on layer item
     * @param {DragEvent} e - Drag event
     * @param {number} layerIndex - Target layer index
     */
    onLayerFileDrop(e, layerIndex) {
        if (this.isFilesDragEvent(e)) {
            e.preventDefault();
            e.currentTarget.style.backgroundColor = '';
            e.currentTarget.classList.remove('drag-over');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.canvasManager.setCurrentLayer(layerIndex);
                this.importFile(files[0], layerIndex);
                this.updateLayerList();
            }
        }
    }

    /**
     * Check if drag event contains files
     * @param {DragEvent} e - Drag event
     * @returns {boolean} True if event contains files
     */
    isFilesDragEvent(e) {
        const dt = e.dataTransfer;
        return dt.types && (dt.types.indexOf('Files') > -1 || dt.types.includes('Files'));
    }
}