import { Line } from "./shapes.js";

function _segmentIntersectsAABB(x0, y0, x1, y1, minX, minY, maxX, maxY) {
    
    let t0 = 0, t1 = 1;
    const dx = x1 - x0;
    const dy = y1 - y0;
    
    const clip = (p, q) => {
        if (p === 0) return q >= 0;
        const r = q / p;
        if (p < 0) {
            if (r > t1) return false;
            if (r > t0) t0 = r;
        } else {
            if (r < t0) return false;
            if (r < t1) t1 = r;
        }
        return true;
    };
    
    return (
        clip(-dx, x0 - minX) &&
        clip( dx, maxX - x0) &&
        clip(-dy, y0 - minY) &&
        clip( dy, maxY - y0)
    );
}


function _polylineIntersectsBox(points, width, box, {relativeTo=null} = {}) {
    const scale = relativeTo ? Math.max(relativeTo.scaleX(), relativeTo.scaleY()) : 1;
    const r = (width * scale) * 0.5;
    
    const minX = box.x - r;
    const minY = box.y - r;
    const maxX = box.x + box.width  + r;
    const maxY = box.y + box.height + r;
    
    for (let i = 0; i < points.length - 2; i += 2) {
        const x0 = points[i];
        const y0 = points[i + 1];
        const x1 = points[i + 2];
        const y1 = points[i + 3];
        
        // Endpoint inside
        if (
            (x0 >= minX && x0 <= maxX && y0 >= minY && y0 <= maxY) ||
            (x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY)
        ) {
            return true;
        }
        
        // Segment AABB reject
        if (
            Math.max(x0, x1) < minX ||
            Math.min(x0, x1) > maxX ||
            Math.max(y0, y1) < minY ||
            Math.min(y0, y1) > maxY
        ) {
            continue;
        }
        
        // Precise test
        if (_segmentIntersectsAABB(x0, y0, x1, y1, minX, minY, maxX, maxY)) {
            return true;
        }
    }
    
    return false;
}


export class SelectionTransformer {
    constructor(canvasManager=null, {stage=null, transformLayer=null, excludedLayers=[]}={}) {
        this.canvasManager = canvasManager;
        this.stage = stage;
        this.transformLayer = transformLayer;
        this.excludedLayers = excludedLayers;
        this.selectedNodes = [];
        this.mode = 'scale'; 
        this.selectionBox = null;
        this.handles = [];
        this.pivotHandle = null;
        this.pivotPoint = null;
        this.mouseDownNode = null;
        this.mouseDownTime = 0;
        this.clickDelay = null;
        this.initialBBox = null;
        this.currentRotationAngle = 0;
        
        this.onSelectionChange = null;
        this.onInteractionEnd = null;
        this.onInteractionStart = null;
        
        this.selectionRect = null;
        this.selecting = false;
        this.selectionStart = null;
        
        this.draggingSelection = false;
        this.selectionDragStart = null;
    }
    
    init() {
        if (this.canvasManager !== null) {
            if (this.stage === null) this.stage = this.canvasManager.stage;
            if (this.transformLayer === null) this.transformLayer = this.canvasManager.transformLayer;
            this.excludedLayers = [...this.excludedLayers, this.canvasManager.pageLayer];
            this.canvasManager.setSelectionTransformer(this);
        }
        this.setupEvents();
    }
    
    /* =====================
    LOCK SEMANTICS (ONLY ADDITION)
    ===================== */
    isLocked(node) {
        if (!node) return true;
        
        if (this.isUnselectable(node)) return true;
        
        if (node.getAttr('locked')) return true;
        
        return false;
    }
    
    isUnselectable(node) {
        const layer = node.getLayer();
        if (layer && layer.getAttr('locked')) return true;
    }
    
    setupEvents() {
        this.stage.on('mousedown touchstart', (e) => {
            if (this.selectionRect) {
                this.selectionRect.destroy();
                this.selectionRect = null;
            }
            
            const node = e.target;
            
            // // ignore locked nodes
            // if (this.isLocked(node)) {
            //     return;
            // }
            
            if (node === this.stage || this.isPassiveObject(node)) {
                const pos = this.stage.getRelativePointerPosition();
                
                if (this.selectionBox && this.selectedNodes.length > 0) {
                    const boxRect = this.selectionBox.getClientRect({ relativeTo: this.stage });
                    if (pos.x >= boxRect.x && 
                        pos.x <= boxRect.x + boxRect.width &&
                        pos.y >= boxRect.y && 
                        pos.y <= boxRect.y + boxRect.height) {
                            this.draggingSelection = true;
                            this.selectionDragStart = pos;
                            if (this.onInteractionStart) this.onInteractionStart();
                            
                            this.selectedNodes.forEach(n => {
                                if (this.isLocked(n) || this.isPassiveObject(n)) return;
                                n._startPos = n.position();
                            });
                            return;
                        }
                    }
                    
                    this.startDragSelect(pos);
                    
                    if (!e.evt.shiftKey) {
                        this.clearSelection(e.target === this.stage);
                    }
                    return;
                }
                
                if (this.isHandle(node)) return;
                
                this.mouseDownTime = Date.now();
                this.mouseDownNode = node;
                this.wasSelectedOnMouseDown = this.selectedNodes.includes(node);
                
                if (e.evt.shiftKey) {
                    this.toggleNodeSelection(node);
                } else {
                    if (!this.selectedNodes.includes(node)) {
                        this.setSelection([node]); 
                    }
                }
            });
            
            this.stage.on('mousemove touchmove', () => {
                if (this.draggingSelection) {
                    const pos = this.stage.getRelativePointerPosition();
                    const dx = pos.x - this.selectionDragStart.x;
                    const dy = pos.y - this.selectionDragStart.y;
                    
                    this.selectedNodes.forEach(n => {
                        if (this.isPassiveObject(n)) return;
                        if (this.isLocked(n)) return;
                        
                        n.position({
                            x: n._startPos.x + dx,
                            y: n._startPos.y + dy
                        });
                    });
                    
                    this.updateSelection();
                    return;
                }
                
                if (this.selecting) {
                    this.updateDragSelect(this.stage.getRelativePointerPosition());
                }
            });
            
            this.stage.on('mouseup touchend', () => {
                if (this.draggingSelection) {
                    this.draggingSelection = false;
                    this.selectionDragStart = null;
                    if (this.onInteractionEnd) this.onInteractionEnd();
                    return;
                }
                
                if (this.selecting) {
                    this.endDragSelect();
                    this.mouseDownNode = null;
                    return;
                }
                
                const now = Date.now();
                if (this.mouseDownNode && 
                    this.wasSelectedOnMouseDown &&
                    (this.clickDelay === null || now - this.mouseDownTime < this.clickDelay)) {
                        this.toggleMode();
                    }
                    
                    this.mouseDownNode = null;
                });
            }
            
            _addDragListener(node) {
                node.on('dragstart.transformer', (e) => {
                    if (this.onInteractionStart) this.onInteractionStart();
                    this.selectedNodes.forEach(n => {
                        if (this.isLocked(n)) return;
                        if (this.isPassiveObject(n)) return;
                        n._startPos = n.position();
                    });
                    this.dragStartPoint = e.target.position();
                });
                
                node.on('dragmove.transformer', (e) => {
                    const dragNow = e.target.position();
                    const dx = dragNow.x - this.dragStartPoint.x;
                    const dy = dragNow.y - this.dragStartPoint.y;
                    
                    this.selectedNodes.forEach(n => {
                        if (n === e.target) return;
                        if (this.isPassiveObject(n)) return;
                        if (this.isLocked(n)) return;
                        
                        n.position({
                            x: n._startPos.x + dx,
                            y: n._startPos.y + dy
                        });
                    });
                    
                    this.updateSelection(); 
                    const nodeLayer = e.target.getLayer();
                    if (nodeLayer) {
                        nodeLayer.batchDraw();
                    }
                    this.transformLayer.batchDraw();
                });
                
                node.on('dragend.transformer', (e) => {
                    if (this.onInteractionEnd) this.onInteractionEnd();
                });
            }
            
            _removeDragListener(node) {
                node.off('dragstart.transformer dragmove.transformer dragend.transformer');
            }
            
            toggleNodeSelection(node) {
                if (this.isUnselectable(node)) return;
                
                if (this.selectedNodes.includes(node)) {
                    this.selectedNodes = this.selectedNodes.filter(n => n !== node);
                    this._removeDragListener(node);
                } else {
                    this.selectedNodes.push(node);
                    this._addDragListener(node);
                }
                this.updateSelection();
            }
            
            addToSelection(nodes) {
                const toProcess = new Set();
                nodes.forEach(node => {
                    if (this.isUnselectable(node)) return;
                    toProcess.add(node);
                });
                toProcess.forEach(node => {
                    if (!this.isPassiveObject(node)) return;
                    if (node.nodes.some(point => (toProcess.has(point)) || this.selectedNodes.includes(point))) return;
                    node.nodes.forEach(point => { toProcess.add(point); });
                })
                toProcess.forEach(node => {
                    if (!this.selectedNodes.includes(node)) {
                        this.selectedNodes.push(node);
                        this._addDragListener(node);
                    }
                });
                this.updateSelection();
            }
            
            setSelection(nodes) {
                this.clearSelection(false); 
                this.mode = 'scale';
                this.addToSelection(nodes);
            }
            
            clearSelection(update=true) {
                this.selectedNodes.forEach(node => this._removeDragListener(node));
                this.selectedNodes = [];
                if (update) {
                    this.updateSelection();
                }
            }
            
            updateSelection(mode = "") {
                if (mode) this.mode = mode;
                this.clearHandles();
                
                if (this.onSelectionChange) {
                    this.onSelectionChange(this.selectedNodes);
                }
                
                if (this.selectedNodes.length === 0) return;
                if (this.selectedNodes.length === 1 && this.selectedNodes[0].className === 'Point') {
                    this.mode = 'move';
                } else if (this.mode === 'move') {
                    this.mode = 'scale';
                }
                
                if (this.mode === 'scale') this.showScaleMode();
                else if (this.mode === 'rotate') this.showRotateMode();
                else if (this.mode === 'move') this.showMoveMode();
            }
            
            toggleMode() {
                if (this.selectedNodes.length === 0) return;
                this.updateSelection(this.mode === 'scale' ? 'rotate' : 'scale');
            }
            
            getScaleFactor() {
                if (this.canvasManager) {
                    return this.canvasManager.stageScaleFactor;
                }
                const stageScale = this.stage.scaleX() || 1;
                return 1 / stageScale;
            }
            
            updateHandleSizes() {
                const sf = this.getScaleFactor();
                
                if (this.pivotHandle) {
                    this.pivotHandle.scale({ x: sf, y: sf });
                }
                
                this.handles.forEach(handle => {
                    handle.scale({ x: sf, y: sf });
                });
                
                if (this.mode === 'scale' && this.selectionBox) {
                    const { x, y, width, height } = this.selectionBox.attrs;
                    this.updateScaleBoxAndHandles(x, y, width, height, null);
                }
                
                this.transformLayer.batchDraw();
            }
            
            getBoundingBox() {
                if (this.selectedNodes.length === 0) return null;
                let minX = Infinity, minY = Infinity;
                let maxX = -Infinity, maxY = -Infinity;
                this.selectedNodes.forEach(node => {
                    // FIX: Use relativeTo to ignore zoom when calculating bbox
                    const box = node.getClientRect({ relativeTo: this.stage });
                    minX = Math.min(minX, box.x);
                    minY = Math.min(minY, box.y);
                    maxX = Math.max(maxX, box.x + box.width);
                    maxY = Math.max(maxY, box.y + box.height);
                });
                return {
                    x: minX,
                    y: minY,
                    width: maxX - minX,
                    height: maxY - minY
                };
            }
            
            _createSelectionBox(bbox) {
                this.selectionBox = new Konva.Rect({
                    x: bbox.x,
                    y: bbox.y,
                    width: bbox.width,
                    height: bbox.height,
                    stroke: '#0066ff',
                    strokeWidth: 1,
                    dash: [4, 4],
                    listening: false
                });
                this.transformLayer.add(this.selectionBox);
            }
            
            _createPivotHandle(bbox, circle = true, cross = true, draggable = true) {
                const centerX = bbox.x + bbox.width / 2;
                const centerY = bbox.y + bbox.height / 2;
                this.pivotPoint = { x: centerX, y: centerY };
                
                this.pivotHandle = new Konva.Group({ draggable: draggable, name: 'pivot-handle' });
                
                const sf = this.getScaleFactor();
                this.pivotHandle.scale({ x: sf, y: sf });
                
                if (circle) {
                    const pivotCircle = new Konva.Circle({
                        name: 'pivot-handle-circle',
                        x: 0,
                        y: 0,
                        radius: 6,
                        fill: 'white',
                        stroke: '#0066ff',
                        strokeWidth: 2
                    });
                    this.pivotHandle.add(pivotCircle);
                }
                if (cross) {
                    const pivotCross1 = new Konva.Line({
                        name: 'pivot-handle-cross1',
                        points: [ - 10, 0, 10, 0],
                        stroke: '#0066ff',
                        strokeWidth: 1
                    });
                    const pivotCross2 = new Konva.Line({
                        name: 'pivot-handle-cross2',
                        points: [0, - 10, 0, 10],
                        stroke: '#0066ff',
                        strokeWidth: 1
                    });
                    this.pivotHandle.add(pivotCross1);
                    this.pivotHandle.add(pivotCross2);
                }
                this.pivotHandle.position({ x: centerX, y: centerY });
                this.handles.push(this.pivotHandle);
                this.transformLayer.add(this.pivotHandle);
                return this.pivotHandle;
            }
            
            showMoveMode() {
                const bbox = this.getBoundingBox();
                if (!bbox) return;
                this._createSelectionBox(bbox);
                this.transformLayer.batchDraw();
            }
            
            showScaleMode() {
                const bbox = this.getBoundingBox();
                if (!bbox) return;
                
                const centerX = bbox.x + bbox.width / 2;
                const centerY = bbox.y + bbox.height / 2;
                this._createSelectionBox(bbox);
                this._createPivotHandle(bbox, false, true, false).on('dragmove', () => {
                    const pos = this.pivotHandle.position();
                    this.pivotPoint = { x: pos.x, y: pos.y };
                    this.updateScaleBoxAndHandles(bbox.x, bbox.y, bbox.width, bbox.height, null);
                });
                
                const positions = [
                    { x: bbox.x, y: bbox.y, cursor: 'nw-resize', name: 'top-left' },
                    { x: centerX, y: bbox.y, cursor: 'n-resize', name: 'top-center' },
                    { x: bbox.x + bbox.width, y: bbox.y, cursor: 'ne-resize', name: 'top-right' },
                    { x: bbox.x + bbox.width, y: centerY, cursor: 'e-resize', name: 'middle-right' },
                    { x: bbox.x + bbox.width, y: bbox.y + bbox.height, cursor: 'se-resize', name: 'bottom-right' },
                    { x: centerX, y: bbox.y + bbox.height, cursor: 's-resize', name: 'bottom-center' },
                    { x: bbox.x, y: bbox.y + bbox.height, cursor: 'sw-resize', name: 'bottom-left' },
                    { x: bbox.x, y: centerY, cursor: 'w-resize', name: 'middle-left' }
                ];
                
                const sf = this.getScaleFactor();
                
                positions.forEach(pos => {
                    const handle = new Konva.Rect({
                        x: pos.x - 4 * sf,
                        y: pos.y - 4 * sf,
                        width: 8,
                        height: 8,
                        fill: 'white',
                        stroke: '#0066ff',
                        strokeWidth: 2,
                        scaleX: sf,
                        scaleY: sf,
                        name: `scale-handle-${pos.name}`,
                        draggable: true
                    });
                    
                    handle.on('dragstart', () => {
                        if (this.onInteractionStart) this.onInteractionStart();
                        this.initialBBox = this.getBoundingBox();
                        this.selectedNodes.forEach(node => {
                            node._startPos = node.position();
                            node._startScale = { x: node.scaleX(), y: node.scaleY() };
                        });
                    });
                    handle.on('dragmove', () => this.handleScale(handle, pos.name));
                    handle.on('dragend', () => {
                        this.initialBBox = null;
                        this.updateSelection();
                        if (this.onInteractionEnd) this.onInteractionEnd();
                    });
                    handle.on('mouseenter', () => {
                        this.stage.container().style.cursor = pos.cursor;
                    });
                    handle.on('mouseleave', () => {
                        this.stage.container().style.cursor = 'default';
                    });
                    this.handles.push(handle);
                    this.transformLayer.add(handle);
                });
                this.transformLayer.batchDraw();
            }
            
            handleScale(handle, anchorName) {
                if (!this.initialBBox) return;
                const bbox = this.initialBBox;
                // FIX: Use relative pointer for scaling logic
                const pointer = this.stage.getRelativePointerPosition();
                
                let anchorX = anchorName.includes('left') ? bbox.x + bbox.width : bbox.x;
                let anchorY = anchorName.includes('top') ? bbox.y + bbox.height : bbox.y;
                
                let scaleX = 1;
                let scaleY = 1;
                
                if (anchorName.includes('left') || anchorName.includes('right')) {
                    const currentWidth = Math.abs(pointer.x - anchorX);
                    scaleX = currentWidth / bbox.width || 1; 
                }
                if (anchorName.includes('top') || anchorName.includes('bottom')) {
                    const currentHeight = Math.abs(pointer.y - anchorY);
                    scaleY = currentHeight / bbox.height || 1;
                }
                
                this.selectedNodes.forEach(node => {
                    if (this.isPassiveObject(node)) return;
                    if (this.isLocked(node)) return;
                    const relX = node._startPos.x - anchorX;
                    const relY = node._startPos.y - anchorY;
                    node.x(anchorX + relX * scaleX);
                    node.y(anchorY + relY * scaleY);
                    if (!node.isGeomPrimitive) {
                        node.scaleX(node._startScale.x * scaleX);
                        node.scaleY(node._startScale.y * scaleY);
                    }
                });
                
                const newX = anchorName.includes('left') ? Math.min(pointer.x, anchorX) : bbox.x;
                const newY = anchorName.includes('top') ? Math.min(pointer.y, anchorY) : bbox.y;
                const newW = (anchorName.includes('left') || anchorName.includes('right')) ? Math.abs(pointer.x - anchorX) : bbox.width;
                const newH = (anchorName.includes('top') || anchorName.includes('bottom')) ? Math.abs(pointer.y - anchorY) : bbox.height;
                
                this.updateScaleBoxAndHandles(newX, newY, newW, newH, anchorName);
            }
            
            updateScaleBoxAndHandles(x, y, width, height, draggedHandleName) {
                this.selectionBox.setAttrs({ x, y, width, height });
                const centerX = x + width / 2;
                const middleY = y + height / 2;
                const rightX = x + width;
                const bottomY = y + height;
                
                const sf = this.getScaleFactor();
                
                const positions = {
                    'top-left': { x: x, y: y },
                    'top-center': { x: centerX, y: y },
                    'top-right': { x: rightX, y: y },
                    'middle-right': { x: rightX, y: middleY },
                    'bottom-right': { x: rightX, y: bottomY },
                    'bottom-center': { x: centerX, y: bottomY },
                    'bottom-left': { x: x, y: bottomY },
                    'middle-left': { x: x, y: middleY }
                };
                
                this.handles.forEach(handle => {
                    const name = handle.name();
                    if (name && name.startsWith('scale-handle-')) {
                        const handleName = name.replace('scale-handle-', '');
                        if (handleName !== draggedHandleName && positions[handleName]) {
                            const pos = positions[handleName];
                            handle.position({ x: pos.x - 4 * sf, y: pos.y - 4 * sf });
                        }
                    }
                });
                
                if (this.pivotHandle) {
                    this.pivotHandle.position({ x: centerX, y: middleY });
                    this.pivotPoint = { x: centerX, y: middleY };
                }
                this.transformLayer.batchDraw();
            }
            
            showRotateMode() {
                const bbox = this.getBoundingBox();
                if (!bbox) return;
                const centerX = bbox.x + bbox.width / 2;
                const centerY = bbox.y + bbox.height / 2;
                this.pivotPoint = { x: centerX, y: centerY };
                this._createSelectionBox(bbox);
                
                this._createPivotHandle(bbox).on('dragmove', () => {
                    const pos = this.pivotHandle.position();
                    this.pivotPoint = { x: pos.x, y: pos.y };
                    this.updateRotateBoxAndHandles(this.currentRotationAngle || 0, pos.x, pos.y);
                });
                
                const corners = [
                    { x: bbox.x, y: bbox.y, name: 'top-left' },
                    { x: bbox.x + bbox.width, y: bbox.y, name: 'top-right' },
                    { x: bbox.x + bbox.width, y: bbox.y + bbox.height, name: 'bottom-right' },
                    { x: bbox.x, y: bbox.y + bbox.height, name: 'bottom-left' }
                ];
                const sf = this.getScaleFactor();
                
                corners.forEach((corner, i) => {
                    const handle = new Konva.Circle({
                        x: corner.x,
                        y: corner.y,
                        radius: 6,
                        fill: 'white',
                        stroke: '#0066ff',
                        strokeWidth: 2,
                        draggable: true,
                        scaleX: sf,
                        scaleY: sf,
                        name: `rotate-handle-${corner.name}`
                    });
                    handle.on('dragstart', () => {
                        if (this.onInteractionStart) this.onInteractionStart();
                        this.initialBBox = { ...bbox };
                        this.currentRotationAngle = 0;
                        handle.startAngle = this.getAngle(this.pivotPoint, handle.position());
                    });
                    handle.on('dragmove', () => this.handleRotation(handle));
                    handle.on('dragend', () => {
                        this.initialBBox = null;
                        this.currentRotationAngle = 0;
                        this.updateSelection();
                        if (this.onInteractionEnd) this.onInteractionEnd();
                    });
                    this.handles.push(handle);
                    this.transformLayer.add(handle);
                });
                this.transformLayer.batchDraw();
            }
            
            getAngle(pivot, point) {
                return Math.atan2(point.y - pivot.y, point.x - pivot.x) * 180 / Math.PI;
            }
            
            handleRotation(handle) {
                // FIX: Use relative position for rotation calculation
                const currentAngle = this.getAngle(this.pivotPoint, handle.position());
                const deltaAngle = currentAngle - handle.startAngle;
                
                this.selectedNodes.forEach(node => {
                    if (this.isPassiveObject(node)) return;
                    if (this.isLocked(node)) return;
                    const pos = node.position();
                    const rad = deltaAngle * Math.PI / 180;
                    const dx = pos.x - this.pivotPoint.x;
                    const dy = pos.y - this.pivotPoint.y;
                    const newX = this.pivotPoint.x + dx * Math.cos(rad) - dy * Math.sin(rad);
                    const newY = this.pivotPoint.y + dx * Math.sin(rad) + dy * Math.cos(rad);
                    node.position({ x: newX, y: newY });
                    node.rotation(node.rotation() + deltaAngle);
                });
                
                handle.startAngle = currentAngle;
                this.currentRotationAngle = (this.currentRotationAngle || 0) + deltaAngle;
                this.updateRotateBoxAndHandles(this.currentRotationAngle, this.pivotPoint.x, this.pivotPoint.y);
            }
            
            updateRotateBoxAndHandles(angle, centerX, centerY) {
                const bbox = this.initialBBox;
                if (!bbox) return;
                
                // Get the four corners of the original box
                const corners = [
                    { x: bbox.x, y: bbox.y },
                    { x: bbox.x + bbox.width, y: bbox.y },
                    { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
                    { x: bbox.x, y: bbox.y + bbox.height }
                ];
                
                // Rotate each corner around the pivot point
                const rad = angle * Math.PI / 180;
                const rotatedCorners = corners.map(corner => {
                    const dx = corner.x - centerX;
                    const dy = corner.y - centerY;
                    return {
                        x: centerX + dx * Math.cos(rad) - dy * Math.sin(rad),
                        y: centerY + dx * Math.sin(rad) + dy * Math.cos(rad)
                    };
                });
                
                // Update selection box as a rotated polygon (using Konva.Line with closed path)
                const points = [
                    rotatedCorners[0].x, rotatedCorners[0].y,
                    rotatedCorners[1].x, rotatedCorners[1].y,
                    rotatedCorners[2].x, rotatedCorners[2].y,
                    rotatedCorners[3].x, rotatedCorners[3].y
                ];
                
                if (this.selectionBox && this.selectionBox.className === 'Line') {
                    this.selectionBox.points(points);
                } else {
                    if (this.selectionBox) {
                        this.selectionBox.remove();
                    }
                    this.selectionBox = new Konva.Line({
                        points: points,
                        closed: true,
                        stroke: '#0066ff',
                        strokeWidth: 1,
                        dash: [4, 4],
                        listening: false
                    });
                    this.transformLayer.add(this.selectionBox);
                }
                
                // Update rotate handles to match the rotated corners
                const handleNames = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
                this.handles.forEach(handle => {
                    if (handle === this.pivotHandle) return;
                    const name = handle.name();
                    if (name && name.startsWith('rotate-handle-')) {
                        const handleName = name.replace('rotate-handle-', '');
                        const idx = handleNames.indexOf(handleName);
                        if (idx >= 0 && rotatedCorners[idx]) {
                            handle.position(rotatedCorners[idx]);
                        }
                    }
                });
                
                this.transformLayer.batchDraw();
            }
            
            clearHandles() {
                if (this.selectionBox) {
                    this.selectionBox.remove();
                }
                this.handles.forEach(handle => handle.remove());
                // this.handles = [];
                this.pivotHandle = null;
                this.transformLayer.batchDraw();
            }
            
            isHandle(node) {
                return node && (node.name() && node.name().includes('handle'));
            }
            
            startDragSelect(pos) {
                this.selecting = true;
                this.selectionStart = pos;
                this.selectionRect = new Konva.Rect({
                    x: pos.x,
                    y: pos.y,
                    width: 0,
                    height: 0,
                    fill: 'rgba(0, 102, 255, 0.1)',
                    stroke: '#0066ff',
                    strokeWidth: 1,
                    dash: [4, 4],
                    listening: false
                });
                this.transformLayer.add(this.selectionRect);
            }
            
            updateDragSelect(pos) {
                if (!this.selectionRect || !this.selectionStart) return;
                const x = Math.min(this.selectionStart.x, pos.x);
                const y = Math.min(this.selectionStart.y, pos.y);
                const width = Math.abs(pos.x - this.selectionStart.x);
                const height = Math.abs(pos.y - this.selectionStart.y);
                
                this.selectionRect.setAttrs({ x, y, width, height });
                this.transformLayer.batchDraw();
            }  /* ---------- drag selection ---------- */
            
            endDragSelect() {
                if (!this.selectionRect) {
                    this.selecting = false;
                    return;
                }
                
                const box = this.selectionRect.getClientRect({ relativeTo: this.stage });
                if (box.width > 0 || box.height > 0) {
                    const selected = [];
                    this.stage.getLayers().forEach(layer => {
                        if (layer === this.transformLayer) return;
                        if (this.excludedLayers.includes(layer)) return;
                        if (layer.getAttr && layer.getAttr('locked')) return;
                        
                        layer.children.forEach(child => {
                            if (this.isUnselectable(child)) return;
                            if (child.draggable && child.visible()) {
                                if (this.nodeIntersectWithBox(child, box)) {
                                    selected.push(child);
                                }
                            }
                        });
                    });
                    
                    if (selected.length > 0) {
                        this.addToSelection(selected);
                    }
                }
                
                this.selectionRect.remove();
                this.selectionRect = null;
                this.selecting = false;
                this.selectionStart = null;
                this.transformLayer.batchDraw();
            }
            
            /* ---------- utils ---------- */
            
            boxesIntersect(box1, box2) {
                return !(
                    box2.x > box1.x + box1.width ||
                    box2.x + box2.width < box1.x ||
                    box2.y > box1.y + box1.height ||
                    box2.y + box2.height < box1.y
                );
            }
            
            nodeIntersectWithBox(node, box) {
                if (node instanceof Line) {
                    return _polylineIntersectsBox(node.points(), node.strokeWidth(), box);//, {relativeTo: this.stage});
                }
                return this.boxesIntersect(box, node.getClientRect({ relativeTo: this.stage }));
            }
            
            isPassiveObject(node) {
                const PassiveObjects = new Set(['Line', 'Image']);
                return PassiveObjects.has(node.getClassName());
            }
        }
        