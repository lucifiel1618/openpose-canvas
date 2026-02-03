import { Person, DistortableImage, Scene, Keypoint, PoseLayer } from './entities.js';

export class RevisionManager {
    constructor(canvasManager=null, {/** @type {Scene} */ scene=null, max_history = 100}={}) {
        this.canvasManager = canvasManager;
        this.scene = scene;
        this.onHistoryChange = null;
        this.max_history = max_history;
        this.history = [];
        this.redoStack = [];
        this.snapshot = new Map(); // UUID -> State
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
                strokeColor: drawable._strokeColor
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

        // 1. Detect Destructions
        snapshotUUIDs.forEach(uuid => {
            if (!currentUUIDs.has(uuid)) {
                const oldState = this.snapshot.get(uuid);
                this.snapshot.delete(uuid);
                changes.push({ type: 'destroy', uuid: uuid, state: oldState });
            }
        });

        currentDrawables.forEach(d => {
            // 2. Detect Creations
            if (!snapshotUUIDs.has(d.uuid)) {
                const state = this.captureDrawableState(d);
                this.snapshot.set(d.uuid, state);
                changes.push({ type: 'create', uuid: d.uuid, state: state });
                return;
            }
            // 3. Detect Attribute Changes
            if (d.stateChanged()) {
                // console.trace("Backtrace");
                const oldState = this.snapshot.get(d.uuid);
                const newState = this.captureDrawableState(d);
                // console.log(`oldState:`, oldState);
                // console.log(`newState:`, newState);
                
                const diff = this.diffStates(oldState, newState);
                // console.log('diff:', diff);
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

    resetStateFlags(entity) {
        entity._stateChanged = false;
        if (entity.children) {
            entity.children.forEach(c => this.resetStateFlags(c));
        }
    }

    findDrawable(uuid) {
        return this.scene.drawables.find(d => d.uuid === uuid);
    }

    async restoreDrawable(state) {
        let drawable = null;
        const args = state.constructionArgs;

        if (state.type === 'Person') {
            drawable = await this.scene.addPerson(args.originalBBox, null, { format: args.format });
        } else if (state.type === 'DistortableImage') {
            drawable = await this.scene.addImage(args.originalBBox, args.imagePath);
        }

        if (drawable) {
            drawable.uuid = state.uuid; // Restore UUID
            drawable.name = args.name;
            if (state.attributes.strokeColor) drawable.setStrokeColor(state.attributes.strokeColor);
            if (state.attributes.fillColor) drawable.setFillColor(state.attributes.fillColor);
            if (state.attributes.visible !== undefined) drawable.setVisible(state.attributes.visible);
            if (state) this.applyState(drawable, state);
            const poseLayer = this.scene.poseLayers.find(poseLayer => poseLayer.layer === drawable._layer);
            (poseLayer ?? this.scene.poseLayers[this.scene.poseLayers.length - 1]).renderDrawable(drawable);
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

        // Apply attributes
        if (diff.attributes) {
            Object.keys(diff.attributes).forEach(key => {
                const val = diff.attributes[key][dir];
                if (key === 'visible') drawable.setVisible(val);
                if (key === 'strokeColor') drawable.setStrokeColor(val); 
                if (key === 'fillColor') drawable.setFillColor(val); 
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
    }

    async undo() {
        if (this.history.length === 0) return;

        if (this.canvasManager) {
            this.canvasManager.deselectAll();
        }

        this.isUndoing = true;
        const transaction = this.history.pop();
        this.redoStack.push(transaction);

        for (let i = transaction.length - 1; i >= 0; i--) {
            const change = transaction[i];
            if (change.type === 'create') {
                const d = this.findDrawable(change.uuid);
                // console.log(`[Undo] Undoing create of ${change.uuid}. Found: ${d}`);
                if (d) this.scene.removeDrawable(d);
            } else if (change.type === 'destroy') {
                await this.restoreDrawable(change.state);
            } else if (change.type === 'modify') {
                const d = this.findDrawable(change.uuid);
                if (d) this.applyDiff(d, change.diff, 'undo');
            }
        }
        
        this.initializeSnapshot();
        this.scene.updateVisibility(); 
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

        for (const change of transaction) {
            if (change.type === 'create') {
                await this.restoreDrawable(change.state);
            } else if (change.type === 'destroy') {
                const d = this.findDrawable(change.uuid);
                if (d) this.scene.removeDrawable(d);
            } else if (change.type === 'modify') {
                const d = this.findDrawable(change.uuid);
                if (d) this.applyDiff(d, change.diff, 'redo');
            }
        }

        this.initializeSnapshot();
        this.isUndoing = false;
        if (this.onHistoryChange) this.onHistoryChange();
    }
}
