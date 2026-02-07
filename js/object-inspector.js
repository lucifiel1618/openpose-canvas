
import { Person, DistortableImage, Drawable, Keypoint, Bone } from './entities.js';

export class ObjectInspector {
    constructor(canvasManager) {
        this.canvasManager = canvasManager;
        this.canvasManager.setObjectInspector(this);
        this.container = document.getElementById('object-inspector');
        this.contentContainer = document.getElementById('object-inspector-content');
        this.previewContainer = document.getElementById('object-preview-container');
        this.attributesContainer = document.getElementById('object-attributes-container');
        this.deleteBtn = document.getElementById('deleteObjectBtn');
        
        this.previewStage = null;
        this.previewLayer = null;
        this.previewPerson = null; // The temporary person in the preview
        
        this.currentDrawable = null;
        this.selectedParts = new Set();
        this.previewTimer = null;
        
        this.initPreviewStage();
        this.initDeleteButton();

        this.highLightColor = '#00ff00';
    }

    initDeleteButton() {
        if (!this.deleteBtn) return;
        
        this.deleteBtn.addEventListener('click', () => {
            this.deleteCurrentDrawable();
        });
    }
    
    deleteCurrentDrawable() {
        if (!this.currentDrawable) return;
        
        this.canvasManager.removeDrawable(this.currentDrawable);
        
        // Clear the selection in the canvas manager
        this.canvasManager.deselectAll();
        
        // Clear the inspector
        this.clear();
        
        // Redraw the stage
        this.canvasManager.stage.draw();
    }

    initPreviewStage() {
        if (!this.previewContainer) return;
        
        // Create a small stage for preview
        this.previewStage = new Konva.Stage({
            container: 'object-preview-container',
            width: this.previewContainer.clientWidth || 200,
            height: 200
        });

        this.previewLayer = new Konva.Layer();
        this.previewStage.add(this.previewLayer);
        
        // Add a simple background
        // this.previewLayer.add(new Konva.Rect({
        //     width: 2000,
        //     height: 2000,
        //     fill: '#f0f0f0'
        // }));
        
        // Handle clicks in preview to select parts
        this.previewStage.on('click tap', (e) => {
            const shape = e.target;
            const entity = shape.getAttr('entity');
            
            if (entity && this.currentDrawable) {
                const realEntity = this.findEntityInDrawable(this.currentDrawable, entity.name);
                if (realEntity) {
                    if (realEntity.shape) {
                        this.canvasManager.selectShapes([realEntity.shape], false);
                    } else {
                        this.showObject(this.currentDrawable, [realEntity]);
                    }
                }
            }
        });
    }

    update(selectedNodes) {
        if (!this.container) return;
        
        // Don't update if the inspector is collapsed
        if (this.container.classList.contains('collapsed')) return;

        const drawables = new Set();
        const parts = new Set();

        selectedNodes.forEach(node => {
            const entity = node.getAttr('entity');
            if (entity) {
                // Traverse up to find the root Drawable
                let current = entity;
                while (current) {
                    if (current instanceof Drawable) {
                        drawables.add(current);
                        parts.add(entity);
                        break;
                    }
                    current = current.parent;
                }
            }
        });

        if (drawables.size === 1) {
            const drawable = drawables.values().next().value;
            this.showObject(drawable, parts);
        } else {
            this.clear();
        }
    }

    showObject(drawable, selectedParts) {
        // this.container.style.display = 'block'; // Ensure visible - REMOVED for manual control
        // If it's a new drawable, rebuild preview
        if (this.currentDrawable !== drawable) {
            this.currentDrawable = drawable;
            this.selectedParts = new Set(selectedParts);
            this.buildPreview(drawable);
            this.renderAttributes(drawable);
            
            // Show delete button when an object is selected
            if (this.deleteBtn) {
                this.deleteBtn.style.display = 'flex';
            }
        } else if (!this.setsEqual(this.selectedParts, selectedParts)) {
            // Only update selection if it actually changed
            this.selectedParts = new Set(selectedParts);
            this.resetPreviewShapeAttribs();
            this.updatePreviewMissingPart();
            this.updatePreviewSelection(selectedParts);
            this.renderAttributes(drawable); // Re-render to update entity attributes
        }
        
        // Update attributes values (in case they changed externally)
        this.updateAttributeValues(drawable);
    }

    setsEqual(setA, setB) {
        if (setA.size !== setB.size) return false;
        for (const item of setA) {
            if (!setB.has(item)) return false;
        }
        return true;
    }

    clear() {
        // this.container.style.display = 'none'; // Or keep visible but empty
        if (this.previewTimer) {
             clearTimeout(this.previewTimer);
             this.previewTimer = null;
        }

        if (this.previewPerson) {
             this.previewPerson.destroy();
             this.previewPerson = null;
        }

        this.currentDrawable = null;
        this.selectedParts.clear();
        if (this.attributesContainer) this.attributesContainer.innerHTML = '';
        if (this.previewLayer) {
            this.previewLayer.destroyChildren(); 
            // Add background back
            //  this.previewLayer.add(new Konva.Rect({
            //     width: 2000,
            //     height: 2000,
            //     fill: '#f0f0f0'
            // }));
            this.previewLayer.draw();
        }
    }

    async buildPreview(drawable) {
        if (!this.previewLayer) return;
        
        // Clear previous timer
        if (this.previewTimer) {
             clearTimeout(this.previewTimer);
             this.previewTimer = null;
        }
        
        // Clear previous content and recreate background
        this.previewLayer.destroyChildren();
        // this.previewLayer.add(new Konva.Rect({
        //     width: 2000,
        //     height: 2000,
        //     fill: '#f0f0f0'
        // }));

        // Create a clone-like entity for the preview
        // We use the same class structure
        
        if (drawable instanceof Person) {
            // Create a new Person with same format
            // We force it to use default skeleton by not passing openpose data
            // We want it centered in the preview
            const cx = this.previewStage.width() / 2;
            const cy = this.previewStage.height() / 2;
            
            this.previewPerson = await Person.create(drawable.name, cx, cy, {format: drawable.format});
            // Manually add to layer since we aren't using the Scene manager here fully
            
            // Wait for skeleton build (it's async in the original class)
            // We can cheat and just wait a bit or hook into the promise if exposed.
            // buildSkeleton is async.
            
            this.previewTimer = setTimeout(() => {
                if (!this.previewPerson) return;

                this.previewPerson.render(this.previewLayer);
                
                // Disable dragging in preview
                this.previewLayer.getChildren().forEach(node => {
                    node.draggable(false);
                    node.listening(true); // Ensure we can still click them
                });

                // Scale to fit
                this.fitPreviewToObject();
                this.resetPreviewShapeAttribs();
                this.updatePreviewMissingPart();
                this.updatePreviewSelection(this.selectedParts);
                this.previewLayer.draw();
             }, 200);

        } else if (drawable instanceof DistortableImage) {
            const cx = this.previewStage.width() / 2;
            const cy = this.previewStage.height() / 2;
            
             this.previewPerson = await DistortableImage.create(drawable.name, cx, cy);
             // We won't load the image, just the control points (skeleton)
             this.previewTimer = setTimeout(() => {
                if (!this.previewPerson) return;

                this.previewPerson.render(this.previewLayer);

                // Add visual indicators (Cross and Text)
                const tl = this.previewPerson.keypointsDict['TopLeft'];
                const tr = this.previewPerson.keypointsDict['TopRight'];
                const br = this.previewPerson.keypointsDict['BotRight'];
                const bl = this.previewPerson.keypointsDict['BotLeft'];

                if (tl && tr && br && bl && tl.shape && tr.shape && br.shape && bl.shape) {
                    // Create cross lines
                    const line1 = new Konva.Line({
                        points: [tl.shape.x(), tl.shape.y(), br.shape.x(), br.shape.y()],
                        stroke: 'black',
                        strokeWidth: 2,
                        listening: false
                    });
                    
                    const line2 = new Konva.Line({
                        points: [tr.shape.x(), tr.shape.y(), bl.shape.x(), bl.shape.y()],
                        stroke: 'black',
                        strokeWidth: 2,
                        listening: false
                    });

                    // Add "Image" text
                    const centerX = (tl.shape.x() + br.shape.x()) / 2;
                    const centerY = (tl.shape.y() + br.shape.y()) / 2;

                    const text = new Konva.Text({
                        x: centerX,
                        y: centerY,
                        text: 'Image',
                        fontSize: 72,
                        fontStyle: 'bold',
                        fill: 'red',
                        listening: false
                    });
                    
                    // Center the text
                    text.offsetX(text.width() / 2);
                    text.offsetY(text.height() / 2);

                    // Add to layer
                    this.previewLayer.add(line1);
                    this.previewLayer.add(line2);
                    this.previewLayer.add(text);
                    
                    // Fallback if no background found (unlikely)
                    line1.moveToBottom();
                    line2.moveToBottom();
                    text.moveToTop();
                }


                    // Disable dragging in preview
                this.previewLayer.getChildren().forEach(node => {
                    node.draggable(false);
                    node.listening(true);
                });

                // Scale to fit
                this.fitPreviewToObject();
                this.resetPreviewShapeAttribs();
                this.updatePreviewSelection(this.selectedParts);
                this.previewLayer.draw();
              }, 200);
        }
    }

    findEntityInDrawable(drawable, name) {
        // Search keypoints
        if (drawable.keypointsDict[name]) return drawable.keypointsDict[name];
        
        // Search bones (inside limbs)
        for (const limb of drawable.limbs) {
            for (const child of limb.children) {
                if (child.name === name) return child;
            }
        }
        return null;
    }

    fitPreviewToObject() {
        if (!this.previewLayer || !this.previewStage) return;
        
        // Reset any previous transform to get accurate bounding box
        this.previewLayer.position({ x: 0, y: 0 });
        this.previewLayer.scale({ x: 1, y: 1 });
        
        // Get bounding box of content (excluding background)
        const children = this.previewLayer.getChildren();
        if (children.length <= 1) return; // Only background
        
        // Calculate bounding box manually to exclude background
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        children.forEach((node, i) => {
            if (i === 0) return; // Skip background
            const rect = node.getClientRect();
            if (rect.width > 0 && rect.height > 0) {
                minX = Math.min(minX, rect.x);
                minY = Math.min(minY, rect.y);
                maxX = Math.max(maxX, rect.x + rect.width);
                maxY = Math.max(maxY, rect.y + rect.height);
            }
        });
        
        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;
        
        if (contentWidth <= 0 || contentHeight <= 0) return;
        
        const padding = 20;
        const stageWidth = this.previewStage.width();
        const stageHeight = this.previewStage.height();
        
        // Calculate scale to fit
        const scale = Math.min(
            (stageWidth - padding * 2) / contentWidth,
            (stageHeight - padding * 2) / contentHeight
        );
        
        // Calculate offset to center the scaled content
        const scaledWidth = contentWidth * scale;
        const scaledHeight = contentHeight * scale;
        const offsetX = (stageWidth - scaledWidth) / 2 - minX * scale;
        const offsetY = (stageHeight - scaledHeight) / 2 - minY * scale;
        
        this.previewLayer.scale({ x: scale, y: scale });
        this.previewLayer.position({ x: offsetX, y: offsetY });
    }
    
    findEntityInPreview(name) {
         if (!this.previewPerson) return null;
         return this.findEntityInDrawable(this.previewPerson, name);
    }

    resetPreviewShapeAttribs() {
        // Reset all bones to default first
        this.previewLayer.find('Line').forEach(shape => {
            shape.stroke('black');
            shape.dash(null);
        });
        
        // Reset all keypoints to default
        this.previewLayer.find('Point').forEach(shape => {
            shape.fill('white');
        });
    }

    updatePreviewMissingPart() {
        if (!this.previewPerson || !this.currentDrawable) return;
        // Check each bone in currentDrawable for missing keypoints
        this.currentDrawable.limbs.forEach(limb => {
            limb.children.forEach(bone => {
                const startPos = bone.start.getPosition();
                const endPos = bone.end.getPosition();
                
                // Check if bone is missing either start or end position
                if (!startPos || !endPos) {
                    // Find corresponding bone in previewPerson
                    const previewBone = this.findEntityInPreview(bone.name);
                    if (previewBone && previewBone.shape) {
                        // Set preview bone to dashed red line
                        previewBone.shape.stroke('red');
                        previewBone.shape.dash([5, 5]);
                    }
                    
                    // Find and set corresponding endpoints in preview to red
                    if (!startPos) {
                        const previewStart = this.findEntityInPreview(bone.start.name);
                        if (previewStart && previewStart.shape) {
                            previewStart.shape.fill('red');
                        }
                    }
                    if (!endPos) {
                        const previewEnd = this.findEntityInPreview(bone.end.name);
                        if (previewEnd && previewEnd.shape) {
                            previewEnd.shape.fill('red');
                        }
                    }
                }
            });
        });
    }

    updatePreviewSelection(selectedParts) {
        if (!this.previewPerson) return;
        const previewEntityShapes = [];
        
        selectedParts.forEach(partEntity => {
            const previewEntity = this.findEntityInPreview(partEntity.name);
            const previewEntityShape = previewEntity?.shape;
            if (previewEntityShape) {
                if (previewEntityShape.getClassName() === 'Point') { // Keypoint
                    previewEntityShape.fill(this.highLightColor); // Highlight color
                } else if (previewEntityShape.getClassName() === 'Line') { // Bone
                    previewEntityShape.stroke(this.highLightColor);
                }
                previewEntityShapes.push(previewEntityShape);
            }
        });
        this.previewLayer.getChildren().sort((a, b) =>
            ((previewEntityShapes.includes(a) ? 2 : 0) + (a.className === 'Point' ? 1 : 0)) -
            ((previewEntityShapes.includes(b) ? 2 : 0) + (b.className === 'Point' ? 1 : 0))
        );
        this.previewLayer.draw();
    }

    /**
     * Refresh the preview canvas state after node changes.
     * Updates missing part indicators and selection highlighting.
     */
    refreshPreviewState() {
        if (!this.previewPerson || !this.previewLayer) return;
        
        this.resetPreviewShapeAttribs();
        this.updatePreviewMissingPart();
        this.updatePreviewSelection(this.selectedParts);
        this.previewLayer.draw();
    }

    renderAttributes(drawable) {
        this.attributesContainer.innerHTML = '';
        
        const template = document.getElementById('drawable-attribute-template');
        const clone = template.content.cloneNode(true);
        
        // Name input
        const nameInput = clone.querySelector('.name-input');
        nameInput.value = drawable.name;
        nameInput.addEventListener('change', (e) => {
            drawable.name = e.target.value;
        });
        nameInput.addEventListener('input', (e) => {
            drawable.name = e.target.value;
        });
        
        // X/Y inputs
        const xInput = clone.querySelector('.drawable-x-input');
        const yInput = clone.querySelector('.drawable-y-input');
        
        const pos = drawable.getPosition();
        if (pos) {
            xInput.value = Math.round(pos.x);
            yInput.value = Math.round(pos.y);
        }
        
        const updateX = (e) => {
            const newX = parseFloat(e.target.value);
            const current = drawable.getPosition();
            if (!isNaN(newX) && current) {
                drawable.setPosition({x: newX, y: current.y});
                this.canvasManager.stage.draw();
            }
        };
        xInput.addEventListener('change', updateX);
        xInput.addEventListener('input', updateX);
        
        const updateY = (e) => {
            const newY = parseFloat(e.target.value);
            const current = drawable.getPosition();
            if (!isNaN(newY) && current) {
                drawable.setPosition({x: current.x, y: newY});
                this.canvasManager.stage.draw();
            }
        };
        yInput.addEventListener('change', updateY);
        yInput.addEventListener('input', updateY);
        
        // Layer dropdown
        const layerSelect = clone.querySelector('.layer-select');
        this.populateLayerDropdown(layerSelect, drawable);
        
        this.attributesContainer.appendChild(clone);
        
        // Add collapsible element for the last selected entity
        this.renderEntityAttributes();
    }
    
    populateLayerDropdown(layerSelect, drawable) {
        // Clear existing options
        layerSelect.innerHTML = '';
        
        // Get all layers from canvas manager
        const layers = this.canvasManager.layers;
        
        // Add option for each layer
        layers.forEach((layer, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = layer.name() || `Layer ${index + 1}`;
            layerSelect.appendChild(option);
        });
        
        // Set current layer
        let currentLayerIndex = 0;
        if (drawable._layer) {
            currentLayerIndex = layers.indexOf(drawable._layer);
            if (currentLayerIndex === -1) currentLayerIndex = 0;
        }
        layerSelect.value = currentLayerIndex;
        
        // Add change event listener
        layerSelect.addEventListener('change', (e) => {
            const newLayerIndex = parseInt(e.target.value);
            this.moveDrawableToLayer(drawable, newLayerIndex);
        });
    }
    
    moveDrawableToLayer(drawable, newLayerIndex) {
        if (!this.canvasManager.layers[newLayerIndex]) return;
        
        const oldLayer = drawable._layer;
        const newLayer = this.canvasManager.layers[newLayerIndex];
        
        if (oldLayer === newLayer) return;
        
        // Remove drawable from old layer's PoseLayer
        const oldPoseLayer = this.canvasManager.scene.poseLayers.find(poseLayer => poseLayer.layer === oldLayer);
        if (oldPoseLayer) {
            oldPoseLayer.removeDrawable(drawable);
        }
        
        // Add drawable to new layer's PoseLayer
        const newPoseLayer = this.canvasManager.scene.poseLayers[newLayerIndex];
        if (newPoseLayer) {
            newPoseLayer.renderDrawable(drawable);
        }
        
        // Update the drawable's layer reference
        drawable._layer = newLayer;
        
        // Redraw both layers
        oldLayer.draw();
        newLayer.draw();
        
        // Update state for undo/redo
        if (this.canvasManager.revisionManager) {
            this.canvasManager.scene.changeState(true);
        }
    }

    updateAttributeValues(drawable) {
        // Update input values if they changed
        const pos = drawable.getPosition();
        if (pos) {
            const xInput = this.attributesContainer.querySelector('input[data-attr="X"]');
            const yInput = this.attributesContainer.querySelector('input[data-attr="Y"]');
            if (xInput && document.activeElement !== xInput) xInput.value = Math.round(pos.x);
            if (yInput && document.activeElement !== yInput) yInput.value = Math.round(pos.y);
        }
        
        // Update layer dropdown if drawable's layer changed
        const layerSelect = this.attributesContainer.querySelector('.layer-select');
        if (layerSelect && document.activeElement !== layerSelect) {
            const layers = this.canvasManager.layers;
            let currentLayerIndex = 0;
            if (drawable._layer) {
                currentLayerIndex = layers.indexOf(drawable._layer);
                if (currentLayerIndex === -1) currentLayerIndex = 0;
            }
            layerSelect.value = currentLayerIndex;
        }
    }

    /**
     * Update the entity attribute section's X/Y input values.
     * Called after node position changes to keep inputs in sync.
     */
    updateEntityAttributeValues() {
        const entities = Array.from(this.selectedParts);
        const firstEntity = entities[0];
        if (!firstEntity) return;

        const pos = firstEntity.getPosition();
        const xInput = this.attributesContainer.querySelector('.entity-section .x-input');
        const yInput = this.attributesContainer.querySelector('.entity-section .y-input');
        
        if (pos) {
            if (xInput && document.activeElement !== xInput) xInput.value = Math.round(pos.x);
            if (yInput && document.activeElement !== yInput) yInput.value = Math.round(pos.y);
        } else {
            // Position is null (node deleted)
            if (xInput && document.activeElement !== xInput) xInput.value = '';
            if (yInput && document.activeElement !== yInput) yInput.value = '';
        }
    }

    createAttributeRow(label, value, onChange, type='text') {
        const row = document.createElement('div');
        row.className = 'attribute-row';
        
        const labelSpan = document.createElement('label');
        labelSpan.textContent = label;
        
        const input = document.createElement('input');
        input.type = type;
        input.value = value;
        input.dataset.attr = label; // For finding it later
        
        input.addEventListener('change', (e) => onChange(e.target.value));
        input.addEventListener('input', (e) => onChange(e.target.value)); // Live update?
        
        row.appendChild(labelSpan);
        row.appendChild(input);
        this.attributesContainer.appendChild(row);
    }

    renderEntityAttributes() {
        const entities = Array.from(this.selectedParts);
        const firstEntity = entities[0];
        if (!firstEntity) return;

        const template = document.getElementById('entity-attribute-template');
        const clone = template.content.cloneNode(true);
        const section = clone.querySelector('.entity-section');

        // 1. Fill Identity
        section.querySelector('.entity-name').textContent = firstEntity.name;
        section.querySelector('.entity-class').textContent = this.getEntityClassName(firstEntity);

        // 2. Fill Values
        // 2.5. Set button states
        const nodeCreateBtn = section.querySelector('.node-create');
        const nodeDeleteBtn = section.querySelector('.node-delete');
        
        if (nodeCreateBtn) {
            const isNodeCreateValid = this.isNodeCreateValid(firstEntity);
            nodeCreateBtn.disabled = !isNodeCreateValid;
            if (!isNodeCreateValid) {
                nodeCreateBtn.classList.add('disabled');
            } else {
                nodeCreateBtn.classList.remove('disabled');
            }
        }
        
        if (nodeDeleteBtn) {
            const isNodeDeleteValid = this.isNodeDeleteValid(firstEntity);
            nodeDeleteBtn.disabled = !isNodeDeleteValid;
            if (!isNodeDeleteValid) {
                nodeDeleteBtn.classList.add('disabled');
            } else {
                nodeDeleteBtn.classList.remove('disabled');
            }
        }

        const xInput = section.querySelector('.x-input');
        const yInput = section.querySelector('.y-input');
        const pos = firstEntity.getPosition();
        if (pos) {
            xInput.value = Math.round(pos.x);
            yInput.value = Math.round(pos.y);
        }

        // 3. Simple Toggle Logic
        section.querySelector('.entity-divider').addEventListener('click', () => {
            section.classList.toggle('collapsed');
        });

        // 4. Action Handlers
        section.querySelector('.node-create')?.addEventListener(
            'click', async (e) => await this.handleNodeRecreate(firstEntity)
        );
        section.querySelector('.node-delete')?.addEventListener(
            'click', async (e) => await this.handleNodeDelete(firstEntity)
        );
        section.querySelector('.node-move')?.addEventListener(
            'click', async (e) => await this.handleNodeMove(firstEntity)
        );

        // 5. Input Sync
        const update = () => {
            const x = parseFloat(xInput.value);
            const y = parseFloat(yInput.value);
            if (!isNaN(x) && !isNaN(y)) {
                firstEntity.setPosition({ x, y });
                this.canvasManager.stage.draw();
            }
        };
        xInput.onchange = update;
        yInput.onchange = update;

        this.attributesContainer.appendChild(section);
    }

    getEntityClassName(entity) {
        if (entity.constructor.name == 'DistortableImage') return 'Image';
        return entity.constructor.name;
    }

    async handleNodeRecreate(entity) {
        // Check if entity is one end of a missing bone or a bone with missing ends
        console.log('Node recreate');
        if (entity instanceof Keypoint) {
            // Find missing bones connected to this keypoint
            const missingBones = this.findMissingBonesForKeypoint(entity);
            if (missingBones.length > 0) {
                // Choose the first missing keypoint
                const missingBone = missingBones[0];
                const missingKeypoint = missingBone.start.getPosition() ? missingBone.end : missingBone.start;
                
                // Use canvasManager.getCursorPosition to set position
                try {
                    missingKeypoint.setPosition(await this.canvasManager.pickPosition(), false);
                    if (!missingKeypoint._shape) {
                        missingKeypoint.render(this.currentDrawable._layer);
                    }
                    missingKeypoint._updateConnectedBones();
                    this.canvasManager.stage.draw();
                    
                    // Sync preview and attributes
                    this.refreshPreviewState();
                    this.updateEntityAttributeValues();
                } catch (e) {
                    if (e.message !== 'USER_CANCELLED') throw e;
                }
            }
        } else if (entity instanceof Bone) {
            // Check if bone has missing ends
            const startPos = entity.start.getPosition();
            const endPos = entity.end.getPosition();
            
            try {
                if (!startPos) {
                    entity.start.setPosition(await this.canvasManager.pickPosition(), false);
                } else if (!endPos) {
                    entity.end.setPosition(await this.canvasManager.pickPosition(), false);
                }
                entity.render(this.currentDrawable._layer);
                this.canvasManager.stage.draw();
                
                // Sync preview and attributes
                this.refreshPreviewState();
                this.updateEntityAttributeValues();
            } catch (e) {
                if (e.message !== 'USER_CANCELLED') throw e;
            }
        }
    }

    async handleNodeDelete(entity) {
        if (entity instanceof Keypoint) {
            entity.setPosition(null);
            this.canvasManager.stage.draw();
            
            // Sync preview and attributes
            this.refreshPreviewState();
            this.updateEntityAttributeValues();
        }
    }

    async handleNodeMove(entity) {
        try {
            entity.setPosition(await this.canvasManager.pickPosition());
            this.canvasManager.stage.draw();
            
            // Sync preview and attributes
            this.refreshPreviewState();
            this.updateEntityAttributeValues();
        } catch (e) {
            if (e.message !== 'USER_CANCELLED') throw e;
        }
    }

    findMissingBonesForKeypoint(keypoint) {
        if (!this.currentDrawable) return [];
        
        const missingBones = [];
        
        this.currentDrawable.limbs.forEach(limb => {
            limb.children.forEach(bone => {
                const startPos = bone.start.getPosition();
                const endPos = bone.end.getPosition();
                
                // Check if bone is missing either start or end position
                // and the current keypoint is one of its endpoints
                if ((!startPos || !endPos) && 
                    (bone.start === keypoint || bone.end === keypoint)) {
                    missingBones.push(bone);
                }
            });
        });
        
        return missingBones;
    }

    isNodeCreateValid(entity) {
        if (entity instanceof Keypoint) {
            return this.findMissingBonesForKeypoint(entity).length > 0;
        } else if (entity instanceof Bone) {
            const startPos = entity.start.getPosition();
            const endPos = entity.end.getPosition();
            return !startPos || !endPos;
        }
        return false;
    }

    isNodeDeleteValid(entity) {
        if (entity instanceof Keypoint) {
            return entity.getPosition() !== null;
        }
        return false;
    }
}
