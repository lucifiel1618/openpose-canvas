import {Point, Line} from './shapes.js';
import {Person, PoseLayer, Scene} from './entities.js';

const MAX_ZOOM_SCALE = 10;
const MIN_ZOOM_SCALE = 0.1;
const ZOOM_PADDING = 50;
const WORKSPACE_WIDTH = 4000;
const WORKSPACE_HEIGHT = 4000;

export class CanvasManager {
    constructor(containerId) {
        this.containerId = containerId;
        this.toolboxManager = null;
        this.toolbarManager = null;
        this.objectInspector = null;
        this.nodeEditManager = null;
        this.selectionTransformer = null;
        this.revisionManager = null;
        this.stage = null;
        this.scene = new Scene();
        this.layers = [];
        this.currentLayerIndex = 0;
        this.pageLayer = null;
        this.transformLayer = null;
        
        this.stageScaleFactor = 1;

        // Page dimensions
        this.pageWidth = 1024;
        this.pageHeight = 1024;
    }

    setToolboxManager(toolboxManager) {
        this.toolboxManager = toolboxManager;
    }

    setToolbarManager(toolbarManager) {
        this.toolbarManager = toolbarManager;
    }

    setObjectInspector(objectInspector) {
        this.objectInspector = objectInspector;
    }

    setNodeEditManager(nodeEditManager) {
        this.nodeEditManager = nodeEditManager;
    }

    setRevisionManager(revisionManager) {
        this.revisionManager = revisionManager;
        // Listen for history changes
        this.revisionManager.onHistoryChange = () => this.updateUndoRedoButtons();
    }

    setSelectionTransformer(selectionTransformer) {
        this.selectionTransformer = selectionTransformer;

        // Set up interaction end callback for undo/redo
        this.selectionTransformer.onInteractionStart = () => {
            if (this.revisionManager) {
                this.scene.lockStateChange();
            }
        };

        this.selectionTransformer.onInteractionEnd = () => {
            if (this.revisionManager) {
                this.scene.unlockStateChange();
                this.scene.changeState(true);
            }
        };

        // Set up selection change callback
        this.selectionTransformer.onSelectionChange = (selectedNodes) => {
            //// Auto-switch layer when a single shape is selected
            // if (selectedNodes.length === 1) {
            //     const shape = selectedNodes[0];
            //     const layer = shape.getLayer();
                
            //     // If the selected shape is on a different layer, switch to it
            //     const layerIndex = this.layers.indexOf(layer);
            //     if (layerIndex !== -1 && layerIndex !== this.currentLayerIndex) {
            //         this.setCurrentLayer(layerIndex);
            //         this.toolboxManager?.updateLayerList();
            //     }
            // }
            
            // Notify Object Inspector
            if (this.objectInspector) {
                this.objectInspector.update(selectedNodes);
            }
        };
    }

    init() {
        const container = document.getElementById('canvas-container');
        this.stage = new Konva.Stage({
            container: this.containerId,
            // Use the actual visible width/height of the container
            width: container.clientWidth, 
            height: container.clientHeight
        });

        // Create the transformer layer
        this.transformLayer = new Konva.Layer();
        this.stage.add(this.transformLayer);


        this.pageLayer = new Konva.Layer({
            listening: false
        });
        this.stage.add(this.pageLayer);

        this.pageLayer.add(
            new Konva.Rect({
                name: 'workspace-bg',
                x: - WORKSPACE_WIDTH / 2 + this.pageWidth / 2,
                y: - WORKSPACE_HEIGHT / 2 + this.pageHeight / 2,
                width: WORKSPACE_WIDTH,
                height: WORKSPACE_HEIGHT,
                fill: '#ccc',
                draggable: false,
                listening: false
            })
        );
        this.pageLayer.add(
            new Konva.Rect({
                name: 'page-bg',
                x: 0,
                y: 0,
                width: this.pageWidth,
                height: this.pageHeight,
                fill: 'white',
                stroke: 'black',
                strokeWidth: 2,
                draggable: false,
                listening: false
            })
        );

        // Add some initial layers
        this.addLayer();
        this.stage.draw();
        this.setupResizeHandler();
        this.setupMouseWheelZoom();
    }

    addLayer() {
        const layer = new Konva.Layer({
            name: `Layer ${this.layers.length + 1}`,
        });
        this.layers.push(layer);
        this.stage.add(layer);
        
        // Create a corresponding PoseLayer
        new PoseLayer(layer, this.scene);
        
        // CRITICAL: Ensure the UI layer (transformer handles) is always on top
        if (this.transformLayer) {
            this.transformLayer.moveToTop();
        }

        this.currentLayerIndex = this.layers.length - 1;
        this.updateLayerOpacities();
        this.updateUndoRedoButtons();
        return layer;
    }

    /**
     * @param {number} index Layer index 
     */
    deleteLayer(index) {
        if (index >= 0 && index < this.layers.length) {
            this.layers.splice(index, 1);
            this.scene.deletePoseLayer(this.poseLayers[index]);
            
            if (this.currentLayerIndex >= this.layers.length) {
                this.currentLayerIndex = Math.max(0, this.layers.length - 1);
            }
            this.updateLayerOpacities();
            this.stage.draw();
            this.updateUndoRedoButtons();
        }
    }

    /**
     * Make given layer visible/invisible
     * @param {number} index Layer index
     * @param {boolean|null} visible Visible status
     */
    toggleLayerVisibility(index, visible=null) {
        if (index >= 0 && index < this.layers.length) {
            const layer = this.layers[index];
            if (visible === null) {
                visible = !layer.visible();
            }
            layer.visible(visible);
            this.stage.draw();
        }
    }

    get poseLayers() {
        return this.scene.poseLayers;
    }

    /**
     * Lock/Unlock given layer
     * @param {number} index Layer index 
     * @param {boolean|null} lock Lock status
     */
    toggleLayerLock(index, lock=null) {
        if (index >= 0 && index < this.layers.length) {
            const layer = this.layers[index];
            if (lock === null) {
                lock = layer.getAttr('locked');
                if (lock === null) {
                    lock = false;
                }
                lock = !lock
            }
            layer.listening(!lock);
            layer.setAttr('locked', lock);
            this.stage.draw();
        }
    }

    /**
     * Make given nodes visible/invisible
     * @param {Array|null} nodes Nodes to toggle (null = use selected nodes)
     * @param {boolean|null} visible Visible status
     */
    toggleNodesVisibility(nodes=null, visible=null) {
        if (nodes === null) {
            nodes = this.selectionTransformer.selectedNodes;
        }
        if (!nodes || nodes.length === 0) return;

        nodes.forEach(node => {
            if (visible === null) {
                visible = !node.visible();
            }
            node.visible(visible);
        });
        this.stage.draw();
    }

    /**
     * Lock/Unlock given nodes
     * @param {Array|null} nodes Nodes to toggle (null = use selected nodes) 
     * @param {boolean|null} lock Lock status
     */
    toggleNodesLock(nodes=null, lock=null) {
        if (nodes === null) {
            nodes = this.selectionTransformer.selectedNodes;
        }
        if (!nodes || nodes.length === 0) return;

        nodes.forEach(node => {
            if (node.className !== 'Point') {
                return;
            }
            
            if (lock === null) {
                lock = node.getAttr('locked');
                if (lock == null) {
                    lock = false;
                }
                lock = !lock;
            }
            node.draggable(!lock);
            node.setAttr('locked', lock);
        });
        this.stage.draw();
    }

    renameLayer(index, newName) {
        if (index >= 0 && index < this.layers.length) {
            this.layers[index].name(newName);
        }
    }

    reorderLayers(fromIndex, toIndex) {
        if (fromIndex < 0 || fromIndex >= this.layers.length || toIndex < 0 || toIndex >= this.layers.length) return;

        const [movedLayer] = this.layers.splice(fromIndex, 1);
        const [movedPoseLayer] = this.poseLayers.splice(fromIndex, 1);
        
        this.layers.splice(toIndex, 0, movedLayer);
        this.poseLayers.splice(toIndex, 0, movedPoseLayer);

        movedLayer.setZIndex(toIndex);
        
        // Safe approach: just move the transform layer to top after any reorder
        if (this.transformLayer) {
            this.transformLayer.moveToTop();
        }

        this.currentLayerIndex = toIndex;
        this.stage.draw();
        this.updateUndoRedoButtons();
    }

    getCurrentLayer() {
        return this.layers[this.currentLayerIndex] || null;
    }
    
    getCurrentPoseLayer() {
        return this.poseLayers[this.currentLayerIndex] || null;
    }

    setCurrentLayer(index) {
        if (index >= 0 && index < this.layers.length) {
            this.currentLayerIndex = index;
            this.updateLayerOpacities();
            this.updateUndoRedoButtons();
        }
    }

    updateLayerOpacities() {
        this.layers.forEach((layer, idx) => {
            layer.opacity(idx === this.currentLayerIndex ? 1 : 0.5);
        });
        this.stage.draw();
    }

    async undo() {
        if (this.revisionManager) {
            await this.revisionManager.undo();
            this.stage.batchDraw();
        }
    }

    async redo() {
        if (this.revisionManager) {
            await this.revisionManager.redo();
            this.stage.batchDraw();
        }
    }

    updateUndoRedoButtons() {
        if (!this.toolbarManager) return;
        
        if (this.revisionManager) {
            const canUndo = this.revisionManager.history.length > 0;
            const canRedo = this.revisionManager.redoStack.length > 0;
            this.toolbarManager.updateUndoRedoState(canUndo, canRedo);
        } else {
            this.toolbarManager.updateUndoRedoState(false, false);
        }
    }

    // ====================
    // POSE METHODS
    // ====================
    
    /**
     * Add a new person to the current layer
     * @param {Object<string, number | null>} bbox {x, y, width, height} - Bounding box for the object (defaults to center)
     * @param {Object} ctx - Context options (e.g., format, color)
     * @returns {Person | null} The created person entity
     */
    addPerson(bbox={x: null, y: null, width: null, height: null}, personData=null, ctx={}) {
        const poseLayer = this.getCurrentPoseLayer();
        if (!poseLayer) return null;
        let x = bbox.x, y = bbox.y;
        // Default to center of stage if no coordinates provided
        if (bbox.x === null) x = this.stage.width() / 2;
        if (bbox.y === null) y = this.stage.height() / 2;
        
        const personPromise = poseLayer.addPerson({x, y, width: bbox.width, height: bbox.height}, personData, ctx);
        
        // Ensure new shapes get the correct scale
        if (personPromise && personPromise.then) {
            personPromise.then(() => {
                this.updateShapesScale();
                this.stage.draw();
            });
        }
        
        return personPromise;
    }
    
    /**
     * Remove a drawable from the scene
     */
    removeDrawable(drawable) {
        this.scene.removeDrawable(drawable);
        this.stage.draw();
    }
    
    /**
     * Get all persons in the current layer
     */
    getCurrentPersons() {
        const poseLayer = this.getCurrentPoseLayer();
        return poseLayer ? poseLayer.scene.persons : [];
    }

    addImage(bbox={x: null, y: null, width: null, height: null}, imgPath) {
        const poseLayer = this.getCurrentPoseLayer();
        if (!poseLayer) return null;
        let x = bbox.x, y = bbox.y;
        // Default to center of stage if no coordinates provided
        if (bbox.x === null) x = this.stage.width() / 2;
        if (bbox.y === null) y = this.stage.height() / 2;
        const image = poseLayer.addImage({x, y, width: bbox.width, height: bbox.height}, imgPath);
        this.stage.draw();
        return image;
    }

    // ====================
    // ORIGINAL METHODS (for backward compatibility)
    // ====================
    
    addPoint(x, y, name, color='red') {
        const layer = this.getCurrentLayer();
        if (!layer) return;

        const point = new Point({
            name: name,
            x: x,
            y: y,
            fill: color,
            draggable: true
        });
        
        if (point.setStageScale) {
            point.setStageScale(this.stageScaleFactor);
        }

        layer.add(point);
        this.stage.draw();
    }

    addLine(x1, y1, x2, y2, name, color='blue') {
        const layer = this.getCurrentLayer();
        if (!layer) return;

        const line = new Line({
            name: name,
            points: [x1, y1, x2, y2],
            stroke: color,
            draggable: true
        });

        if (line.setStageScale) {
            line.setStageScale(this.stageScaleFactor);
        }

        layer.add(line);
        this.stage.draw();
    }

    selectShapes(shapes, multiSelect = false) {
        const shapeLayer = shapes[shapes.length - 1].getLayer();
        const layerIndex = this.layers.indexOf(shapeLayer);
        
        if (layerIndex !== -1 && layerIndex !== this.currentLayerIndex) {
            this.setCurrentLayer(layerIndex);
            this.toolboxManager?.updateLayerList();
        }

        // Delegate selection to the transformer
        if (this.selectionTransformer) {
            if (multiSelect) {
                this.selectionTransformer.addToSelection(shapes);
            } else {
                this.selectionTransformer.setSelection(shapes);
            }
            // Note: ObjectInspector is notified via onSelectionChange callback
        }

        this.stage.draw();
    }

    deselectAll() {
        this.selectionTransformer?.clearSelection();
        // Note: ObjectInspector is notified via onSelectionChange callback
        this.stage.draw();
    }

    getLayers() {
        return this.layers;
    }

    async pickPosition() {
        if (!this.nodeEditManager) {
            throw new Error('NodeEditManager not initialized');
        }
        return await this.nodeEditManager.pickPosition();
    }

    setupResizeHandler() {
        const container = document.getElementById('canvas-container');
        
        const resizeObserver = new ResizeObserver(() => {
            this.stage.width(container.clientWidth);
            this.stage.height(container.clientHeight);
            this.stage.batchDraw();
        });

        resizeObserver.observe(container);
    }

    /**
     * Change the page dimensions
     * @param {number} width - New page width
     * @param {number} height - New page height
     * @param {boolean} keepViewportPosition - If true, maintains current viewport position
     */
    changePageSize(width, height, keepViewportPosition = false) {
        this.pageWidth = Math.max(100, width);
        this.pageHeight = Math.max(100, height);
        
        // Update workspace background position
        const workspaceBg = this.pageLayer.findOne('.workspace-bg');
        if (workspaceBg) {
            workspaceBg.x(-2000 + this.pageWidth / 2);
            workspaceBg.y(-2000 + this.pageHeight / 2);
        }
        
        // Update page background
        const pageBg = this.pageLayer.findOne('.page-bg');
        if (pageBg) {
            pageBg.width(this.pageWidth);
            pageBg.height(this.pageHeight);
        }
        
        // Adjust viewport to fit page if requested
        if (!keepViewportPosition) {
            this.centerPageInViewport();
        }
        
        // Redraw the stage
        this.pageLayer.batchDraw();
        
        // Update toolbar inputs
        this.updatePageInputs();
    }

    /**
     * Center the page in the current viewport
     */
    centerPageInViewport() {
        const stage = this.stage;
        const stageWidth = stage.width();
        const stageHeight = stage.height();
        
        // Calculate position to center the page
        const pageCenterX = this.pageWidth / 2;
        const pageCenterY = this.pageHeight / 2;
        const stageCenterX = stageWidth / 2;
        const stageCenterY = stageHeight / 2;
        
        stage.x(stageCenterX - pageCenterX);
        stage.y(stageCenterY - pageCenterY);
        stage.batchDraw();
    }

    /**
     * Update page size input fields in toolbar
     */
    updatePageInputs() {
        const widthInput = document.getElementById('pageWidth');
        const heightInput = document.getElementById('pageHeight');
        
        if (widthInput) {
            widthInput.value = this.pageWidth;
        }
        if (heightInput) {
            heightInput.value = this.pageHeight;
        }
    }

    /**
     * Get current page dimensions
     * @returns {Object} - { width, height }
     */
    getPageSize() {
        return {
            width: this.pageWidth,
            height: this.pageHeight
        };
    }

    // Zooming functions
    zoomIn() {
        const stage = this.stage;
        const currentScale = stage.scaleX();
        const newScale = Math.min(MAX_ZOOM_SCALE, currentScale + 0.2);
        this.zoomToScale(newScale);
    }

    zoomOut() {
        const stage = this.stage;
        const currentScale = stage.scaleX();
        const newScale = Math.max(MIN_ZOOM_SCALE, currentScale - 0.2);
        this.zoomToScale(newScale);
    }

    zoomToScale(scale) {
        const stage = this.stage;

        const viewCenterX = stage.width() / 2;
        const viewCenterY = stage.height() / 2;

        const oldScale = stage.scaleX();

        // world-space point currently at viewport center
        const worldCenter = {
            x: (viewCenterX - stage.x()) / oldScale,
            y: (viewCenterY - stage.y()) / oldScale,
            width: 0,
            height: 0
        };
        
        this.stageScaleFactor = 1 / scale;
        this.updateShapesScale();

        // reuse zoomToBBox centering logic
        this.zoomToBBox(worldCenter, {fixedScale: scale});
    }

    updateShapesScale() {
        this.stage.find(node => node.setStageScale).forEach(node => {
            node.setStageScale(this.stageScaleFactor);
        });
        this.stage.batchDraw();
    }

    /**
     * Unified function to zoom and center a specific bounding box
     * @param {Object} bbox - { x, y, width, height } in absolute canvas coordinates
     * @param {Object} options - { padding, fixedScale }
     */
    zoomToBBox(bbox, { padding = 0, fixedScale = null, scaleMax = MAX_ZOOM_SCALE }) {
        const stage = this.stage;

        let scale;

        if (fixedScale !== null) {
            scale = fixedScale;
        } else {
            const scaleX = stage.width() / (bbox.width + padding * 2);
            const scaleY = stage.height() / (bbox.height + padding * 2);
            scale = Math.min(scaleX, scaleY, scaleMax);
        }

        stage.scale({ x: scale, y: scale });

        stage.position({
            x: stage.width() / 2 - (bbox.x + bbox.width / 2) * scale,
            y: stage.height() / 2 - (bbox.y + bbox.height / 2) * scale
        });
        
        if (this.selectionTransformer) {
            this.selectionTransformer.updateHandleSizes();
        }

        this.updateZoomInput();

        stage.batchDraw();
    }

    zoomToDrawing() {
        const stage = this.stage;
        const contentLayers = this.layers;
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasContent = false;

        contentLayers.forEach(layer => {
            layer.children?.forEach(shape => {
                // relativeTo: stage ignores current stage scale/offset
                const box = shape.getClientRect({ relativeTo: stage });
                minX = Math.min(minX, box.x);
                minY = Math.min(minY, box.y);
                maxX = Math.max(maxX, box.x + box.width);
                maxY = Math.max(maxY, box.y + box.height);
                hasContent = true;
            });
        });

        if (hasContent) {
            this.zoomToBBox(
                {
                    x: minX,
                    y: minY,
                    width: maxX - minX,
                    height: maxY - minY
                },
                { padding: ZOOM_PADDING }
            );
        }
    }

    fitToPage() {
        const page = this.pageLayer.findOne('.page-bg');
        if (!page) return;

        // Use raw attributes as the "World" bounding box
        this.zoomToBBox(
            {
                x: page.x(),
                y: page.y(),
                width: page.width(),
                height: page.height()
            },
            { padding: ZOOM_PADDING }
        );
    }

    updateZoomInput() {
        const zoomInput = document.getElementById('zoomInput');
        if (!zoomInput) return;
        
        const scale = this.stage.scaleX();
        zoomInput.value = Math.round(scale * 100) + '%';
    }

    applyZoomInput() {
        const zoomInput = document.getElementById('zoomInput');
        if (!zoomInput) return;
        
        let value = zoomInput.value.trim();

        if (value.endsWith('%')) {
            value = value.slice(0, -1);
        }

        const percent = parseFloat(value);
        if (isNaN(percent)) {
            this.updateZoomInput();
            return;
        }

        const scale = Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, percent / 100));
        this.zoomToScale(scale);
    }

    setupMouseWheelZoom() {
        const container = document.getElementById('openpose-canvas');
        if (!container) return;

        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const stage = this.stage;
            const oldScale = stage.scaleX();
            const pointer = stage.getPointerPosition();

            // Determine zoom direction
            const direction = e.deltaY > 0 ? -1 : 1;
            const newScale = oldScale + direction * 0.1;

            // Clamp scale between MIN_ZOOM_SCALE and MAX_ZOOM_SCALE
            const clampedScale = Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, newScale));

            // Calculate new position to zoom towards pointer
            if (pointer) {
                const mousePointTo = {
                    x: (pointer.x - stage.x()) / oldScale,
                    y: (pointer.y - stage.y()) / oldScale,
                };

                stage.scale({ x: clampedScale, y: clampedScale });
                this.stageScaleFactor = 1 / clampedScale;
                this.updateShapesScale();

                const newPos = {
                    x: pointer.x - mousePointTo.x * clampedScale,
                    y: pointer.y - mousePointTo.y * clampedScale,
                };

                stage.position(newPos);
            }
            
            if (this.selectionTransformer) {
                this.selectionTransformer.updateHandleSizes();
            }

            stage.batchDraw();
            this.updateZoomInput();
        });
    }
}