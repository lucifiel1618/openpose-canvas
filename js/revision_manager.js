import { Person, DistortableImage, Scene, Keypoint, PoseLayer } from './entities.js';

export class RevisionManager {
    constructor(canvasManager=null, {/** @type {Scene} */ scene=null, max_history = 100}={}) {
        /**
         * @type {import("./canvas").CanvasManager | null}
         */
        this.canvasManager = canvasManager;
        this.scene = scene;
        this.onHistoryChange = null;
        this.max_history = max_history;
        this.history = [];
        this.redoStack = [];
        this.snapshot = new Map(); // UUID -> State
        this.layerSnapshot = new Map(); // Layer ID -> State
        this.isUndoing = false;
    }

    init() {
        if (this.canvasManager !== null) {
            if (this.scene === null) this.scene = this.canvasManager.scene;
            this.canvasManager.setRevisionManager(this);
        }
        // Hook into the scene
        this.scene.onStateChanged = () => this.handleStateChange();
        // Initialize snapshot
        this.initializeSnapshot();
    }

    initializeSnapshot() {
        this.snapshot.clear();
        this.scene.drawables.forEach(drawable => {
            this.snapshot.set(drawable.uuid, this.captureDrawableState(drawable));
        });
        
        // Initialize layer snapshot
        this.layerSnapshot.clear();
        this.scene.poseLayers.forEach(poseLayer => {
            this.layerSnapshot.set(poseLayer.layer.id(), this.captureLayerState(poseLayer));
        });
    }

    captureDrawableState(drawable) {
        const state = {
            type: drawable.constructor.name,
            uuid: drawable.uuid,
            constructionArgs: this.getConstructionArgs(drawable),
            attributes: {
                visible: drawable.getVisible(),
                alpha: drawable._alpha,
                fillColor: drawable._fillColor,
                strokeColor: drawable._strokeColor,
                layer: drawable._layer ? drawable._layer.id() : null
            },
            children: {}
        };

        // Traverse all children (Limbs, Bones, Keypoints) to capture their state
        this.traverseChildren(drawable, (child) => {
            if (child === drawable) return;
            // if (!child.stateChanged()) return;
            
            // We assume names are unique per drawable
            state.children[child.name] = {
                position: child instanceof Keypoint ? child.getPosition() : null,
                visible: child.getVisible(),
                strokeColor: child._strokeColor,
                fillColor: child._fillColor
            };
        });

        return state;
    }

    traverseChildren(entity, callback) {
        callback(entity);
        if (entity.children) {
            entity.children.forEach(c => this.traverseChildren(c, callback));
        }
    }

    getConstructionArgs(drawable) {
        const args = {
            name: drawable.name,
            originalBBox: drawable.originalBBox
        };

        if (drawable instanceof Person) {
            args.format = drawable.format;
        } else if (drawable instanceof DistortableImage) {
            args.imagePath = drawable.imagePath;
            args.constrainedImageSize = drawable.constrainedImageSize;
        }
        return args;
    }

    handleStateChange() {
        if (this.isUndoing) return;
        const changes = [];
        const currentDrawables = this.scene.drawables;
        const currentUUIDs = new Set(currentDrawables.map(d => d.uuid));
        const snapshotUUIDs = new Set(this.snapshot.keys());

        // 1. Detect Layer Changes
        const layerChanges = this.detectLayerChanges();
        changes.push(...layerChanges);

        // 2. Detect Destructions
        snapshotUUIDs.forEach(uuid => {
            if (!currentUUIDs.has(uuid)) {
                const oldState = this.snapshot.get(uuid);
                this.snapshot.delete(uuid);
                changes.push({ type: 'destroy', uuid: uuid, state: oldState });
                
                // Update layer snapshot to remove destroyed drawable
                if (oldState.attributes && oldState.attributes.layer) {
                    const layerId = oldState.attributes.layer;
                    const layerState = this.layerSnapshot.get(layerId);
                    if (layerState) {
                        const drawableIndex = layerState.drawables.indexOf(uuid);
                        if (drawableIndex !== -1) {
                            layerState.drawables.splice(drawableIndex, 1);
                        }
                    }
                }
            }
        });

        currentDrawables.forEach(d => {
            // 3. Detect Creations
            if (!snapshotUUIDs.has(d.uuid)) {
                const state = this.captureDrawableState(d);
                this.snapshot.set(d.uuid, state);
                changes.push({ type: 'create', uuid: d.uuid, state: state });
                
                // Update layer snapshot to include new drawable
                if (d._layer) {
                    const layerId = d._layer.id();
                    const layerState = this.layerSnapshot.get(layerId);
                    if (layerState) {
                        layerState.drawables.push(d.uuid);
                    }
                }
                return;
            }
            // 4. Detect Attribute Changes
            if (d.stateChanged()) {
                const oldState = this.snapshot.get(d.uuid);
                const newState = this.captureDrawableState(d);
                
                const diff = this.diffStates(oldState, newState);
                if (diff) {
                    changes.push({ type: 'modify', uuid: d.uuid, diff: diff });
                    this.snapshot.set(d.uuid, newState);
                }
            }
        });

        if (changes.length > 0) {
            this.history.push(changes);
            this.redoStack = []; // Clear redo stack
            
            // Enforce max_history limit
            if (this.max_history && this.history.length > this.max_history) {
                this.history.splice(0, this.history.length - this.max_history);
            }
            
            console.log("RevisionManager: Pushed state", changes);
            if (this.onHistoryChange) this.onHistoryChange();
        }

        // Reset state changed flags
        this.resetStateFlags(this.scene);
    }

    diffStates(oldState, newState) {
        const diff = { attributes: {}, children: {} };
        let hasChanges = false;

        // Compare Attributes
        for (const key in newState.attributes) {
            if (JSON.stringify(oldState.attributes[key]) !== JSON.stringify(newState.attributes[key])) {
                diff.attributes[key] = { from: oldState.attributes[key], to: newState.attributes[key] };
                hasChanges = true;
            }
        }

        // Compare Children
        for (const name in newState.children) {
            const oldChild = oldState.children[name];
            const newChild = newState.children[name];
            
            if (oldChild && newChild) {
                const childDiff = {};
                let childChanged = false;

                if (JSON.stringify(oldChild.position) !== JSON.stringify(newChild.position)) {
                    childDiff.position = { from: oldChild.position, to: newChild.position };
                    childChanged = true;
                }
                if (oldChild.visible !== newChild.visible) {
                    childDiff.visible = { from: oldChild.visible, to: newChild.visible };
                    childChanged = true;
                }

                if (oldChild.strokeColor !== newChild.strokeColor) {
                    childDiff.strokeColor = { from: oldChild.strokeColor, to: newChild.strokeColor };
                    childChanged = true;
                }

                if (oldChild.fillColor !== newChild.fillColor) {
                    childDiff.fillColor = { from: oldChild.fillColor, to: newChild.fillColor };
                    childChanged = true;
                }

                if (childChanged) {
                    diff.children[name] = childDiff;
                    hasChanges = true;
                }
            }
        }

        return hasChanges ? diff : null;
    }

    detectLayerChanges() {
        const changes = [];
        const currentLayers = this.scene.poseLayers;
        const currentLayerIds = new Set(currentLayers.map(pl => pl.layer.id()));
        const snapshotLayerIds = new Set(this.layerSnapshot?.keys() || []);

        // Detect layer destructions
        snapshotLayerIds.forEach(layerId => {
            if (!currentLayerIds.has(layerId)) {
                const oldState = this.layerSnapshot.get(layerId);
                this.layerSnapshot.delete(layerId);
                changes.push({ type: 'layer_destroy', layerId: layerId, state: oldState });
            }
        });

        // Detect layer creations
        currentLayers.forEach(poseLayer => {
            if (!snapshotLayerIds.has(poseLayer.layer.id())) {
                const state = this.captureLayerState(poseLayer);
                this.layerSnapshot.set(state.layerId, state);
                changes.push({ type: 'layer_create', layerId: state.layerId, state: state });
            }
        });

        return changes;
    }

    captureLayerState(poseLayer) {
        return {
            layerId: poseLayer.layer.id(),
            layerName: poseLayer.layer.name(),
            layerIndex: this.scene.poseLayers.indexOf(poseLayer),
            visible: poseLayer.layer.visible(),
            opacity: poseLayer.layer.opacity(),
            drawables: poseLayer.drawables.map(d => d.uuid)
        };
    }

    resetStateFlags(entity) {
        entity._stateChanged = false;
        if (entity.children) {
            entity.children.forEach(c => this.resetStateFlags(c));
        }
    }

    findDrawable(uuid) {
        return this.scene.drawables.find(d => d.uuid === uuid);
    }

    findPoseLayer(layerId) {
        return this.scene.poseLayers.find(pl => pl.layer.id() === layerId);
    }

    async restoreLayer(state) {
        if (!this.canvasManager) return;

        this.canvasManager.scene.lockStateChange();
        
        // Create new layer
        const layer = new Konva.Layer({
            id: state.layerId,
            name: state.layerName,
            visible: state.visible,
            opacity: state.opacity
        });

        const currentLayer = this.canvasManager.getCurrentLayer();
        this.canvasManager.addLayer(layer);
        
        // Reorder if necessary
        const newIndex = this.canvasManager.layers.indexOf(layer);
        if (newIndex !== state.layerIndex) {
            this.canvasManager.reorderLayers(newIndex, state.layerIndex);
        }
        
        const poseLayer = this.canvasManager.poseLayers[state.layerIndex];
        
        // Restore drawables that belong to this layer
        if (state.drawables && state.drawables.length > 0) {
            for (const drawableUuid of state.drawables) {
                const existingDrawable = this.findDrawable(drawableUuid);
                
                if (existingDrawable) {
                    // Fix: If drawable already exists (wasn't destroyed), just re-attach to the restored layer
                    // This prevents duplicate entities with same UUID
                    poseLayer.renderDrawable(existingDrawable);
                    
                    // Update layer snapshot to include restored drawable
                    const layerState = this.layerSnapshot.get(state.layerId);
                    if (layerState && !layerState.drawables.includes(drawableUuid)) {
                        layerState.drawables.push(drawableUuid);
                    }
                } else {
                    const drawableState = this.snapshot.get(drawableUuid);
                    if (drawableState) {
                        // Set the current layer to ensure drawable is added to the restored layer
                        const savedCurrentLayer = this.canvasManager.getCurrentLayer();
                        // Use state.layerIndex because layer might have been reordered
                        this.canvasManager.setCurrentLayer(state.layerIndex);
                        
                        await this.restoreDrawable(drawableState);
                        
                        // Restore the original current layer
                        this.canvasManager.setCurrentLayer(savedCurrentLayer);
                        
                        // Update layer snapshot to include restored drawable
                        const layerState = this.layerSnapshot.get(state.layerId);
                        if (layerState && !layerState.drawables.includes(drawableUuid)) {
                            layerState.drawables.push(drawableUuid);
                        }
                    }
                }
            }
        }
        
        this.canvasManager.setCurrentLayer(this.canvasManager.layers.indexOf(currentLayer));

        this.canvasManager.scene.unlockStateChange();
    }

    async restoreDrawable(state) {
        let drawable = null;
        const args = state.constructionArgs;

        // Create the instance (note: this adds it to the current active layer initially)
        if (state.type === 'Person') {
            drawable = await this.scene.addPerson(args.originalBBox, null, { format: args.format });
        } else if (state.type === 'DistortableImage') {
            drawable = await this.scene.addImage(args.originalBBox, args.imagePath);
        }

        if (drawable) {
            drawable.uuid = state.uuid; // Restore UUID
            drawable.name = args.name;
            
            // Apply visual attributes
            this.applyState(drawable, state);
            
            // Restore Layer Position
            const targetLayerId = state.attributes.layer;
            if (targetLayerId && this.canvasManager) {
                const targetLayer = this.canvasManager.getLayers().find(l => l.id() === targetLayerId);
                drawable.render(targetLayer);
                
                // Update layer snapshot to include restored drawable
                const layerState = this.layerSnapshot.get(targetLayerId);
                if (layerState && !layerState.drawables.includes(drawable.uuid)) {
                    layerState.drawables.push(drawable.uuid);
                }
            }
        }
    }

    applyState(drawable, state) {
        // Apply attributes to drawable itself
        if (state.attributes) {
            if (state.attributes.strokeColor) drawable.setStrokeColor(state.attributes.strokeColor);
            if (state.attributes.fillColor) drawable.setFillColor(state.attributes.fillColor);
            if (state.attributes.visible !== undefined) drawable.setVisible(state.attributes.visible);
        }

        // Recursively apply state to children
        if (state.children) {
            const childrenMap = {};
            this.traverseChildren(drawable, c => childrenMap[c.name] = c);
            
            Object.keys(state.children).forEach(name => {
                const childState = state.children[name];
                const child = childrenMap[name];
                if (!child) return;
                
                if (childState.position) child.setPosition(childState.position, false);
                
                if (childState.visible !== undefined) child.setVisible(childState.visible);
                if (childState.strokeColor) child._strokeColor = childState.strokeColor;
                if (childState.fillColor) child._fillColor = childState.fillColor;
            });
        }
    }

    applyDiff(drawable, diff, mode = 'undo') {
        const dir = mode === 'undo' ? 'from' : 'to';
        const cm = this.canvasManager;
        cm?.scene.lockStateChange();

        // Apply attributes
if (diff.attributes) {
                Object.keys(diff.attributes).forEach(key => {
                    const val = diff.attributes[key][dir];
                    if (key === 'visible') drawable.setVisible(val);
                    if (key === 'strokeColor') drawable.setStrokeColor(val); 
                    if (key === 'fillColor') drawable.setFillColor(val); 
                    if (key === 'layer') {
                        // Fix: Ensure we find the layer correctly or handle failure gracefully
                        const layerIndex = cm?.getLayers().findIndex(layer => layer.id() == val);
                        if (layerIndex !== -1 && layerIndex !== undefined) {
                            cm?.moveDrawableToLayer(drawable, layerIndex);
                            
                            // Update layer snapshots for layer movement
                            const oldLayerId = diff.attributes[key][dir === 'from' ? 'to' : 'from'];
                            const newLayerId = val;
                            
                            // Remove from old layer snapshot
                            if (oldLayerId) {
                                const oldLayerState = this.layerSnapshot.get(oldLayerId);
                                if (oldLayerState) {
                                    const drawableIndex = oldLayerState.drawables.indexOf(drawable.uuid);
                                    if (drawableIndex !== -1) {
                                        oldLayerState.drawables.splice(drawableIndex, 1);
                                    }
                                }
                            }
                            
                            // Add to new layer snapshot
                            if (newLayerId) {
                                const newLayerState = this.layerSnapshot.get(newLayerId);
                                if (newLayerState && !newLayerState.drawables.includes(drawable.uuid)) {
                                    newLayerState.drawables.push(drawable.uuid);
                                }
                            }
                        } else {
                            console.warn(`[RevisionManager] Could not find layer with ID ${val} during ${mode}`);
                        }
                    }
                });
            }

        // Apply children changes
        if (diff.children) {
            const childrenMap = {};
            this.traverseChildren(drawable, c => childrenMap[c.name] = c);

            Object.keys(diff.children).forEach(name => {
                const child = childrenMap[name];
                const d = diff.children[name];
                if (!child) return;

                if (d.position) child.setPosition(d.position[dir]);
                if (d.visible) child.setVisible(d.visible[dir]);
                if (d.fillColor) child._fillColor = d.fillColor[dir];
                if (d.strokeColor) child._strokeColor = d.strokeColor[dir];
            });
        }

        cm?.scene.unlockStateChange();
    }

    async undo() {
        if (this.history.length === 0) return;

        if (this.canvasManager) {
            this.canvasManager.deselectAll();
        }

        this.isUndoing = true;
        const transaction = this.history.pop();
        this.redoStack.push(transaction);

        // Reverse iteration for Undo
        for (let i = transaction.length - 1; i >= 0; i--) {
            const change = transaction[i];
            if (change.type === 'create') {
                const d = this.findDrawable(change.uuid);
                if (d) {
                    // Update layer snapshot to remove drawable
                    if (d._layer) {
                        const layerId = d._layer.id();
                        const layerState = this.layerSnapshot.get(layerId);
                        if (layerState) {
                            const drawableIndex = layerState.drawables.indexOf(d.uuid);
                            if (drawableIndex !== -1) {
                                layerState.drawables.splice(drawableIndex, 1);
                            }
                        }
                    }
                    this.scene.removeDrawable(d);
                }
            } else if (change.type === 'destroy') {
                await this.restoreDrawable(change.state);
                
                // Update layer snapshot to include restored drawable
                const targetLayerId = change.state.attributes.layer;
                if (targetLayerId) {
                    const layerState = this.layerSnapshot.get(targetLayerId);
                    if (layerState && !layerState.drawables.includes(change.state.uuid)) {
                        layerState.drawables.push(change.state.uuid);
                    }
                }
            } else if (change.type === 'modify') {
                const d = this.findDrawable(change.uuid);
                if (d) this.applyDiff(d, change.diff, 'undo');
            } else if (change.type === 'layer_create') {
                const poseLayer = this.findPoseLayer(change.layerId);
                if (poseLayer && this.canvasManager) {
                    const layerIndex = this.canvasManager.layers.indexOf(poseLayer.layer);
                    this.canvasManager.deleteLayer(layerIndex);
                }
            } else if (change.type === 'layer_destroy') {
                await this.restoreLayer(change.state);
            }
        }
        
        this.scene.updateVisibility(); 
        // CRITICAL FIX: Update snapshot so the next action is diffed against the restored state
        this.initializeSnapshot();
        
        this.isUndoing = false;
        if (this.onHistoryChange) this.onHistoryChange();
    }

    async redo() {
        if (this.redoStack.length === 0) return;

        if (this.canvasManager) {
            this.canvasManager.deselectAll();
        }

        this.isUndoing = true;
        const transaction = this.redoStack.pop();
        this.history.push(transaction);

        // Forward iteration for Redo
        for (const change of transaction) {
            if (change.type === 'create') {
                await this.restoreDrawable(change.state);
                
                // Update layer snapshot to include restored drawable
                const targetLayerId = change.state.attributes.layer;
                if (targetLayerId) {
                    const layerState = this.layerSnapshot.get(targetLayerId);
                    if (layerState && !layerState.drawables.includes(change.state.uuid)) {
                        layerState.drawables.push(change.state.uuid);
                    }
                }
            } else if (change.type === 'destroy') {
                const d = this.findDrawable(change.uuid);
                if (d) {
                    // Update layer snapshot to remove drawable
                    if (d._layer) {
                        const layerId = d._layer.id();
                        const layerState = this.layerSnapshot.get(layerId);
                        if (layerState) {
                            const drawableIndex = layerState.drawables.indexOf(d.uuid);
                            if (drawableIndex !== -1) {
                                layerState.drawables.splice(drawableIndex, 1);
                            }
                        }
                    }
                    this.scene.removeDrawable(d);
                }
            } else if (change.type === 'modify') {
                const d = this.findDrawable(change.uuid);
                if (d) this.applyDiff(d, change.diff, 'redo');
            } else if (change.type === 'layer_create') {
                await this.restoreLayer(change.state);
            } else if (change.type === 'layer_destroy') {
                const poseLayer = this.findPoseLayer(change.layerId);
                if (poseLayer && this.canvasManager) {
                    const layerIndex = this.canvasManager.layers.indexOf(poseLayer.layer);
                    this.canvasManager.deleteLayer(layerIndex);
                }
            }
        }

        this.scene.updateVisibility();
        // CRITICAL FIX: Update snapshot so the next action is diffed against the restored state
        this.initializeSnapshot();

        this.isUndoing = false;
        if (this.onHistoryChange) this.onHistoryChange();
    }
}