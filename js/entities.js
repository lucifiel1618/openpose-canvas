import { GeomPrimitive, Point, Line } from './shapes.js';
import { offsetImageProjected } from "./perspective-transform.js";
import { dataAccessManager } from './openpose-probe.js';

/**
 * Base class for all pose entities
 */
export class Entity {
    constructor(/** @type {string} */ name, parent /** @type {Entity|null} */ = null, withLock = true) {
        if (!withLock || parent === null) {
            this._stateChangeLock = {value: 0};
        }
        if (parent !== null) {
            parent.addChild(this, withLock); 
        } else {
             // console.warn(`Entity ${name} created without parent`);
        }
        this.name = name;
        this.uuid = crypto.randomUUID();
        /** @type {Entity|null} */ this.parent = parent;
        this._stateChanged = true;
        this._visible = true;
        /** @type {Entity[]} */ this.children = [];
        /** @type {string|null} */ this._strokeColor = null;
        /** @type {string|null} */ this._fillColor = null;
        /** @type {number|null} */ this._strokeWidth =4 ;
        /** @type {float|null} */ this._alpha = null;
        /** @type {boolean|null} */ this._isSelected = null;
        /** @type {Konva.Shape|null} */ this.shape = null;
        this._isDestroyed = false;
    }
    
    addChild( /** @type {this} */ child, withLock = true) {
        this.children.push(child);
        if (withLock) {
            child._stateChangeLock = this._stateChangeLock;
        }
        this.changeState(true);
        // console.log(`[Entity] Added child ${child.name} (${child.uuid}) to ${this.name} (${this.uuid})`);
    }
    
    removeChild( /** @type {this} */ child) {
        const index = this.children.indexOf(child);
        if (index !== -1) {
            this.children.splice(index, 1);
            this.changeState(true);
            if (this._stateChangeLock === child._stateChangeLock) {
                child._stateChangeLock = {value: 0};
            }
        }
    }

    /**
     * @returns {Entity[]}
     */
    getParents() {
        if (!this.parent) return [];
        return [this.parent, ...this.parent.getParents()];
    }

    lockStateChange() {
        this._stateChangeLock.value += 1;
    }

    unlockStateChange() {
        this._stateChangeLock.value -= 1;
    }

    get isStateChangeLock() {
        return this._stateChangeLock.value > 0;
    }

    overStateChange(callable) {
        this.lockStateChange();
        callable();
        this.unlockStateChange();
        this.changeState(true);
    }
    
    setVisible(/** @type {boolean} */ visible) {
        this._visible = visible
        this.updateVisibility();
    }
    
    getVisible(visible=null) {
        if (visible===null) {
            visible = this._visible;
        }
        if (visible===null && this.parent !== null) {
            visible = this.parent.getVisible();
        }
        return visible;
    }
    
    // Abstract methods to be implemented by subclasses
    /**
     * @returns {{ x: number, y: number } | null}
     */
    getPosition() {
        throw new Error('getPosition() must be implemented by subclass');
    }

    _setPosition(/** @type {{ x: number, y: number }} */ pos, /** @type {boolean} */ updateShape = true) {
        throw new Error('_setPosition() must be implemented by subclass');
    }
    
    setPosition(/** @type {{ x: number, y: number }} */ pos, /** @type {boolean} */ updateShape = true) {
        this.changeState(true);
        this._setPosition(pos, updateShape);
    }
    
    setOffset(/** @type {{ x: number, y: number }} */ offset, updateShape = true) {
        this.changeState(true);
        const keypoints = this instanceof Keypoint ? [this] : this.getAllKeypoints();
        keypoints.forEach(kp => {
            const pos = kp.getPosition();
            if (pos) {
                kp.setPosition({ x: pos.x + offset.x, y: pos.y + offset.y }, updateShape);
            }
        });
    }

    /**
     * @returns {GeomPrimitive[]}
     */    
    render(/** @type {Konva.Layer} */ layer) {
        if (layer) this._layer = layer;
        if (!this.getVisible()) return [];
        
        /** @type {GeomPrimitive[]} */const shapes = [];
        this.children.forEach(child => {
            shapes.push(...child.render(layer));
        });
        return shapes;
    }
    
    updateVisibility() {
        // Override in subclasses that create Konva shapes
    }
    
    getAllKeypoints() {
        const keypoints = [];
        if (this instanceof Keypoint) {
            keypoints.push(this);
        }
        this.children.forEach(child => {
            child.getAllKeypoints().forEach(kp => {
                if (keypoints.includes(kp)) return;
                keypoints.push(kp);
            });
        });
        return keypoints;
    }
    
    stateChanged() {
        return this._stateChanged;
    }
    
    changeState(/** @type {boolean} */ statusChanged) {
        // console.trace(`Backtrace of ${this.name}`);
        this._stateChanged = statusChanged;
        if (this.parent) {
            this.parent.changeState(statusChanged);
        }
    }

    findNearestKeypoint(/** @type {number} */ x, /** @type {number} */ y) {
        const keypoints = this.getAllKeypoints();
        if (keypoints.length === 0) {
            return { keypoint: null, distance: Infinity };
        }
        
        let minDist = Infinity;
        let nearest = null;
        
        keypoints.forEach(kp => {
            const pos = kp.getPosition();
            if (pos) {
                const dist = Math.sqrt((pos.x - x) ** 2 + (pos.y - y) ** 2);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = kp;
                }
            }
        });
        
        return { keypoint: nearest, distance: minDist };
    }
    
    getAlpha(alpha = null) {
        if (alpha===null) {
            alpha = this._alpha;
        }
        if (alpha===null && this.parent !== null) {
            alpha = this.parent.getAlpha();
        }
        return alpha;
    }

    getStrokeColor(color=null) {
        if (color===null) {
            color = this._strokeColor;
        }
        if (color===null && this.parent !== null) {
            color = this.parent.getStrokeColor();
        }
        return color;
    }

    setStrokeColor(color) {
        if (color !== null) {
            this._strokeColor = color;
        }
        if (this.shape !== null) {
            this.shape.stroke(this.getStrokeColor());
        }
        this.children.forEach(ch => ch.setStrokeColor(null));
    }

    getFillColor(color=null) {
        if (color===null) {
            color = this._fillColor;
        }
        if (color===null && this.parent !== null) {
            color = this.parent.getFillColor();
        }
        return color;
    }

    setFillColor(color) {
        if (color !== null) {
            this._fillColor = color;
        }
        if (this.shape !== null) {
            this.shape.fill(this.getFillColor());
        }
        this.children.forEach(ch => ch.setFillColor(null));
    }
    
    getColor(color=null) {
        return this.getStrokeColor(color);
    }

    getStrokeWidth(width=null) {
        if (width===null) {
            width = this._strokeWidth;
        }
        if (width===null && this.parent !== null) {
            width = this.parent.getStrokeWidth();
        }
        return width;
    }

    setStrokeWidth(width) {
        if (width !== null) {
            this._strokeWidth = width;
        }
        if (this.shape !== null) {
            this.shape.fill(this.getStrokeWidth());
        }
        this.children.forEach(ch => ch.getStrokeWidth(null));
    }
    
    destroy() {
        this._isDestroyed = true;
        // console.log(`[Entity] Destroying ${this.name} (${this.constructor.name}) with ${this.children.length} children`);
        // Create a copy of the children array to avoid modification during iteration issues
        const children = [...this.children]; 
        children.forEach(child => child.destroy());
        this.children = [];
    }
}

/**
 * A single keypoint entity (corresponds to Point in canvas.js)
 */
export class Keypoint extends Entity {
    constructor(name, x = null, y = null, parent = null) {
        super(name, parent);
        this._position = (x !== null && y !== null) ? { x, y } : null;
        this._radius = 5;
        this.shape = null; // Will store the Konva Point
    }
    
    getPosition() {
        return this._position ? { ...this._position } : null;
    }
    
    _setPosition(pos, updateShape = true) {
        this._position = pos;
        if (updateShape && this.shape) {
            if (pos !== null) {
                this.shape.position(pos);
                this.shape.show();
            } else {
                this.shape.hide();
            }
        }
    }
    
    setPosition(pos, updateShape = true) {
        super.setPosition(pos, updateShape);
        if (updateShape) {
            this._updateConnectedBones();
        }
    }

    setRadius(radius, updateShape=true) {
        this._radius = radius;
        if (updateShape && this.shape) {
            this.shape.radius(radius);
        }
    } 
    
    render(layer) {
        if (!this.getVisible() || !this._position) {
            if (this.shape) {
                this.shape.visible(false);
            }
            return [];
        }
        
        if (!this.shape) {
            this.shape = new Point({
                name: this.name,
                x: this._position.x,
                y: this._position.y,
                fill: this.getFillColor(),
                radius: this._radius,
                stroke: this.getStrokeColor(),
                draggable: true
            });
            this.shape.setAttr('entity', this);
            this.setupDragListeners();
            layer.add(this.shape);
            // console.debug(`Created keypoint ${this.name} at (${this._position.x}, ${this._position.y})`);
        } else {
            if (layer !== this.shape.getLayer()) {
                this.shape.moveTo(layer);
            }
            this.shape.position(this._position);
            this.shape.visible(true);
        }
        
        return [this.shape];
    }

    setupDragListeners() {
        const shape = this.shape;
        shape.on(
            'xChange yChange', () => {
                // Update the keypoint's internal position
                const pos = shape.position();
                // console.log(`Dragging Keypoint "${this.name}" from (${this.getPosition().x}, ${this.getPosition().y}) to (${pos.x}, ${pos.y})`);
                this._position = pos;
                this.changeState(true);
            }
        );
    }
    
    updateVisibility() {
        if (this.shape) {
            this.shape.visible(this.getVisible() && this._position !== null);
        }
    }
    
    /**
     * Find and update bones connected to this keypoint.
     * Called after position changes to trigger bone re-creation if needed.
     */
    _updateConnectedBones() {
        // Find parent Drawable
        let drawable = this.parent;
        while (drawable && !(drawable instanceof Drawable)) {
            drawable = drawable.parent;
        }
        if (!drawable || !drawable._layer) return;
        
        // Find bones that use this keypoint
        for (const limb of drawable.limbs) {
            for (const bone of limb.children) {
                if (bone instanceof Bone && (bone.start === this || bone.end === this)) {
                    // Re-render the bone (will create shape if both endpoints now valid)
                    bone.render(drawable._layer);
                }
            }
        }
    }
    
    destroy() {
        // console.log(`[Keypoint] Destroying Keypoint ${this.name}`);
        if (this.shape) {
            this.shape.visible(false);
            this.shape.setAttr('entity', undefined);
            this.shape.off('xChange yChange');
            this.shape.destroy();
            this.shape = null;
        }
        super.destroy();
    }
}

/**
 * A bone connecting two keypoints (corresponds to Line in canvas.js)
 */
export class Bone extends Entity {
    constructor(name, startKeypoint, endKeypoint, parent = null) {
        super(name, parent);
        this.start = startKeypoint;
        this.end = endKeypoint;
        this.shape = null; // Will store the Konva Line
    }
    
    getPosition() {
        const startPos = this.start.getPosition();
        const endPos = this.end.getPosition();
        
        if (!startPos || !endPos) return null;
        
        return {
            x: (startPos.x + endPos.x) / 2,
            y: (startPos.y + endPos.y) / 2
        };
    }
    
    _setPosition(pos, updateShape = true) {
        if (!pos) return;
        
        const currentPos = this.getPosition();
        if (!currentPos) return;
        
        const offset = {
            x: pos.x - currentPos.x,
            y: pos.y - currentPos.y
        };
        
        this.start.setOffset(offset, updateShape);
        this.end.setOffset(offset, updateShape);
    }

    setOffset(offset, updateShape = true) {
        this.start.setOffset(offset, updateShape);
        this.end.setOffset(offset, updateShape);
    }

    getAllKeypoints() {
        return [this.start, this.end];
    }
    
    render(layer) {
        if (this._isDestroyed) return [];
        if (layer) this._layer = layer;
        // console.log(`[Bone] Rendering bone ${this.name}`);
        if (!this.getVisible()) {
            if (this.shape) {
                this.shape.visible(false);
            }
            return [];
        }
        
        const startPos = this.start.getPosition();
        const endPos = this.end.getPosition();
        
        if (!startPos || !endPos) {
            if (this.shape) {
                this.shape.visible(false);
            }
            if (endPos) {
                this.end.setFillColor('yellow');
            }
            if (startPos) {
                this.start.setFillColor('yellow');
            }
            return [];
        }
        
        // Restore original fill colors when bone becomes visible
        this.start._fillColor = null;
        this.start.setFillColor(null);
        this.end._fillColor = null;
        this.end.setFillColor(null);
        
        if (!this.shape) {
            // Ensure keypoints have shapes (they might not if this is a partial update or visibility change)
            if (!this.start.shape) {
                 if (this.start._isDestroyed) {
                     // console.warn(`[Bone] ${this.name} skipping resurrection of destroyed start keypoint ${this.start.name}`);
                 } else {
                     // console.warn(`[Bone] ${this.name} resurrecting start keypoint ${this.start.name}`);
                     this.start.render(layer);
                 }
            }
            if (!this.end.shape) {
                 if (this.end._isDestroyed) {
                     // console.warn(`[Bone] ${this.name} skipping resurrection of destroyed end keypoint ${this.end.name}`);
                 } else {
                     // console.warn(`[Bone] ${this.name} resurrecting end keypoint ${this.end.name}`);
                     this.end.render(layer);
                 }
            }

            // If keypoints still don't have shapes (e.g. they are invisible), we can't create the connected line
            if (!this.start.shape || !this.end.shape) {
                return [];
            }

            this.shape = new Line(
                {
                    nodes: [this.start.shape, this.end.shape],
                    name: this.name,
                    stroke: this.getStrokeColor(),
                    fill: this.getFillColor(),
                    strokeWidth: this.getStrokeWidth(),
                    draggable: false // Bones shouldn't be draggable directly
                }
            );
            this.shape.setAttr('entity', this);
            
            layer.add(this.shape);
            // console.log(`Created bone ${this.name} from (${startPos.x}, ${startPos.y}) to (${endPos.x}, ${endPos.y})`);
        } else {
            if (this.shape.getLayer() !== layer) {
                this.shape.moveTo(layer);
            }
            console.debug(`Moved bone ${this.name} from (${startPos.x}, ${startPos.y}) to (${endPos.x}, ${endPos.y})`);
            this.shape.points([startPos.x, startPos.y, endPos.x, endPos.y]);
            this.shape.visible(true);
        }
        
        return [this.shape];
    }
    
    updateVisibility() {
        if (this.shape) {
            const startPos = this.start.getPosition();
            const endPos = this.end.getPosition();
            this.shape.visible(this.getVisible() && startPos !== null && endPos !== null);
        }
    }
    
    destroy() {
        if (this.shape) {
            this.shape.visible(false);
            this.shape.setAttr('entity', undefined);
            this.shape.destroy();
            this.shape = null;
        }
        super.destroy();
    }
}

/**
 * A limb composed of multiple bones and keypoints
 */
export class Limb extends Entity {
    constructor(name, parent = null) {
        super(name, parent);
    }
    
    getPosition() {
        const keypoints = this.getAllKeypoints();
        if (keypoints.length === 0) return null;
        
        const positions = [];
        for (const kp of keypoints) {
            const pos = kp.getPosition();
            if (!pos) return null;
            positions.push(pos);
        }
        
        const avgX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
        const avgY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
        
        return { x: avgX, y: avgY };
    }
    
    _setPosition(pos, updateShape = true) {
        if (!pos) return;
        
        const currentPos = this.getPosition();
        if (!currentPos) return;
        
        const offset = {
            x: pos.x - currentPos.x,
            y: pos.y - currentPos.y
        };
        
        this.getAllKeypoints().forEach(kp => kp.setOffset(offset, updateShape));
    }

    render(layer) {
        const shapes = []

        const allKeypoints = this.getAllKeypoints();
        // Render all keypoints first (yet bring them to front)
        allKeypoints.forEach(
            kp => {
                shapes.push(...kp.render(layer));
            }
        );
        // Render bones and other entities
        this.children.forEach(ch => {
            shapes.push(...ch.render(layer));
        });
        return shapes;
    }
}

/**
 * Base class for drawable entities (Person, Hand, etc.)
 */
export class Drawable extends Entity {
    constructor(name, cx, cy, width=null, height=null, parent=null, format='BODY18', withLock=true) {
        super(name, parent, withLock);
        this.lockStateChange();
        /** @type {{ [key: string]: Keypoint }} */
        this.keypointsDict = {};
        /** @type {Limb[]} */
        this.limbs = [];
        this._alpha = 1.0;
        this.format = format;
        this.originalBBox = {x: cx, y: cy, width, height}
    }

    static async create(name, cx, cy, {width=null, height=null, parent=null, format='BODY18', withLock=true, personData=null}={}) {
        const obj = new this(name, cx, cy, width, height, parent, format, withLock);
        await obj.buildSkeleton(cx, cy, width, height, {personData});
        obj.unlockStateChange();
        return obj;
    }

    async buildSkeleton(cx, cy, width=null, height=null, {personData=null}={}) {
        try {
            console.log(`Building skeleton at (${cx}, ${cy})`);
            
            // Load skeleton data and let subclass handle structure building
            const skeletonData = await this.buildStructure(cx, cy, width, height, {personData});

            let skeletonExists = false;
            
            // Create keypoints from returned data
            skeletonData.names.forEach((name, i) => {
                const pos = skeletonData.positions[i];
                if (!(name in this.keypointsDict)) {
                    // console.log(`[Person] Creating keypoint ${name} for ${this.name}`);
                    this.keypointsDict[name] = new Keypoint(name, pos.x, pos.y, this);
                } else {
                    this.keypointsDict[name]._setPosition(pos);
                    skeletonExists ||= true;
                }
                const kp = this.keypointsDict[name];
                if (['Face', 'LHand', 'RHand'].some(partName => name.startsWith(partName + '_'))) {
                    kp.setRadius(1);
                    kp.setStrokeColor('gray');
                    kp.setFillColor('gray');
                }
            });
            if (skeletonExists) {
                console.log(`Updated existing skeleton for "${this.name}"`);
            } else {
                // Build limbs/bones if provided
                if (skeletonData.limbs) {
                    const kp = this.keypointsDict;
                    
                    skeletonData.limbs.forEach(limb => {
                        const limbObj = new Limb(limb.name, this);
                        this.limbs.push(limbObj);
                        
                        // Create bones for this limb
                        limb.bones.forEach(bone => {
                            const startKp = kp[bone.start];
                            const endKp = kp[bone.end];
                            
                            if (startKp && endKp) {
                                const boneEn = new Bone(bone.name, startKp, endKp, limbObj);
                                if (['Face', 'LHand', 'RHand'].some(partName => bone.name.startsWith(partName + '_'))) {
                                    boneEn.setStrokeColor('gray');
                                    boneEn.setStrokeWidth(1);
                                }
                            }
                        });
                    });
                }
            }
            this.changeState(true);
        } catch (error) {
            console.error('Failed to build skeleton:', error);
        }
    }

    async buildStructure(cx, cy, width=null, height=null, {personData=null}={}) {
        if (!personData) {
            personData = await dataAccessManager.loadSkeletonData(this.format);
        }
        // Create all bones with their vertex indices
        const allBones = Array.from(
            { length: personData.edges.length / 2 },
            (_, i) => {
                const [startIdx, endIdx] = dataAccessManager.getEdge(personData, i);
                return {
                    name: `${personData.names[startIdx]}To${personData.names[endIdx]}`,
                    start: personData.names[startIdx],
                    end: personData.names[endIdx],
                    startIdx,
                    endIdx
                };
            }
        );
        
        // Create limb bone mappings
        const limbVertexSets = personData.limbs.map(limb => new Set(limb));
        const assignedBones = new Set();
        
        const limbs = personData.limbNames.map((limbName, limbIndex) => {
            const vertexSet = limbVertexSets[limbIndex];
            const limbBones = [];
            
            allBones.forEach((bone, boneIdx) => {
                if (vertexSet.has(bone.startIdx) && vertexSet.has(bone.endIdx)) {
                    assignedBones.add(boneIdx);
                    limbBones.push({
                        name: bone.name,
                        start: bone.start,
                        end: bone.end
                    });
                }
            });
            
            return { name: limbName, bones: limbBones };
        });
        
        // Add "Others" limb for unassigned bones
        const othersBones = [];
        allBones.forEach((bone, boneIdx) => {
            if (!assignedBones.has(boneIdx)) {
                othersBones.push({
                    name: bone.name,
                    start: bone.start,
                    end: bone.end
                });
            }
        });
        
        if (othersBones.length > 0) {
            limbs.push({ name: "Others", bones: othersBones });
        }
        
        return {
            names: personData.names,
            positions: personData.names.map((_, i) => dataAccessManager.getVertexPosition(personData, i, {x: cx, y: cy, width: width, height: height})),
            limbs: limbs
        };
    }
    
    getPosition() {
        const firstKp = Object.values(this.keypointsDict)[0];
        return firstKp ? firstKp.getPosition() : null;
    }
    
    _setPosition(pos) {
        const currentPos = this.getPosition();
        if (!currentPos) return;
        
        const offset = {
            x: pos.x - currentPos.x,
            y: pos.y - currentPos.y
        };
        
        this.getAllKeypoints().forEach(kp => {
            const kpPos = kp.getPosition();
            if (kpPos) {
                kp._setPosition({
                    x: kpPos.x + offset.x,
                    y: kpPos.y + offset.y
                });
            }
        });
    }
    
    async getKeypointsArray() {
        const positions = [];
        const skeletonData = await dataAccessManager.loadSkeletonData(this.format);
        skeletonData.names.forEach(name => {
            const pos = this.keypointsDict[name].getPosition();
            positions.push(pos || { x: 0, y: 0 });
        });
        return positions;
    }

    async resetPose({x=null, y=null, width=null, height=null}) {
        x = x !== null ? x : this.originalBBox.x;
        y = y !== null ? y : this.originalBBox.y;
        width = width !== null ? width : this.originalBBox.width;
        height = height !== null ? height : this.originalBBox.height;
        // Just rebuild skeleton at current position
        await this.buildSkeleton(x, y, width, height);
    }
}

/**
 * An image entity with perspective transform capability
 */
export class DistortableImage extends Drawable {
    constructor(name, cx, cy, width=null, height=null, imagePath = null, parent = null) {
        super(name, cx, cy, width, height, parent, 'IMAGE');
        this.imagePath = imagePath;
        this.image = null;
        this.imageShape = null; // Konva.Image for the transformed image
        this.constrainedImageSize = null;
        this.imageNaturalSize = null;
    }

    static async create(name, cx, cy, {width=null, height=null, imagePath=null, parent=null}={}) {
        const obj = new this(name, cx, cy, width, height, imagePath, parent);
        await obj.buildSkeleton(cx, cy, width, height);
        try {
            await obj.loadImage();
        } catch (error) {
            console.warn(`Failed to load image for ${name}: ${imagePath}`, error);
        }
        obj.unlockStateChange();
        return obj;
    }

    async loadImage(imagePath=null, allowCrossOrigin=true) {

        if (imagePath !== null && imagePath !== this.imagePath) {
            this.imagePath = imagePath;
            this.changeState(true);
        } else {
            imagePath = this.imagePath;
        }
        // Skip image loading entirely when imagePath is null/empty
        if (imagePath === null) {
            this.image = null;
            this.imagePath = imagePath;
            this.imageNaturalSize = null;
            return Promise.resolve(null);  // Resolve with null for consistent Promise behavior
        }
        return new Promise((resolve, reject) => {
            const img = new Image();
            this.image = img;
            if (allowCrossOrigin) {
                img.crossOrigin = 'anonymous';
            }
            img.onload = () => {
                this.imageNaturalSize = { width: img.naturalWidth, height: img.naturalHeight };
                console.log(`Image natural size: ${this.imageNaturalSize.width}x${this.imageNaturalSize.height}`);
                const imageSize = { ... this.constrainedImageSize? this.constrainedImageSize : this.imageNaturalSize };
                console.log(`Loaded image size: ${imageSize.width}x${imageSize.height}`);
                this.resetPose({width: imageSize.width, height: imageSize.height}); // Rebuild skeleton to fit image
                resolve(img);
            };
            img.onerror = (_) => {
                // console.error(`Failed to load image: ${imagePath}`, error);
                reject(new Error(`Failed to load image: ${imagePath}`));
            };
            img.src = imagePath;
        });
    }
    
    getPerspectiveTransformedImage() {
        if (!this.image) return null;
        
        // Get all four corner positions
        const keypointNames = ['TopLeft', 'TopRight', 'BotRight', 'BotLeft'];
        const points = [];
        
        for (const kpName of keypointNames) {
            const keypoint = this.keypointsDict[kpName];
            if (!keypoint) return null;
            const pos = keypoint.getPosition();
            if (!pos) return null;
            points.push([pos.x, pos.y]);
        }
        
        // Use perspective transform
        return offsetImageProjected(this.image, points);
    }
    
    render(layer) {
        const shapes = [...super.render(layer)];
        
        if (!this.getVisible()) {
            if (this.imageShape) {
                this.imageShape.visible(false);
            }
        } else {
            // Render the transformed image
            const transformedImage_config = this.getPerspectiveTransformedImage()?.toKonvaConfig();
            // console.log(`"${this.imageShape}": rendering transformed image`);
            if (transformedImage_config && transformedImage_config.image) {
                if (!this.imageShape) {
                    this.imageShape = new Konva.Image({
                        ...transformedImage_config,
                        listening: true,
                        draggable: false
                    });
                    this.imageShape.setAttr('entity', this);
                    this.imageShape.nodes = [];
                    layer.add(this.imageShape);
                    this.getAllKeypoints().forEach( kp => { 
                        if (kp.shape) {
                            this.imageShape.nodes.push(kp.shape);
                            kp.shape.on('xChange.perTrans yChange.perTrans', () => {
                                if (!this.getVisible()) return;
                                if (!this.imageShape) return;
                                const transformedImage_config = this.getPerspectiveTransformedImage()?.toKonvaConfig();
                                if (transformedImage_config && transformedImage_config.image) {
                                    this.imageShape.image(transformedImage_config.image);
                                    this.imageShape.x(transformedImage_config.x);
                                    this.imageShape.y(transformedImage_config.y);
                                }
                            });
                        }
                    });
                } else {
                    this.imageShape.image(transformedImage_config.image);
                    this.imageShape.x(transformedImage_config.x);
                    this.imageShape.y(transformedImage_config.y);
                    this.imageShape.visible(true);
                }
                shapes.push(this.imageShape);
            }
        }
        
        return shapes;
    }
    
    getPosition() {
        return this.keypointsDict['TopLeft'] ? this.keypointsDict['TopLeft'].getPosition() : null;
    }
    
    destroy() {
        for (const kp of this.getAllKeypoints()) {
            kp.shape.off('xChange.perTrans yChange.perTrans');
        }
        if (this.imageShape) {
            this.imageShape.visible(false);
            this.imageShape.setAttr('entity', undefined);
            this.imageShape.destroy();
            this.imageShape = null;
        }
        // Clean up HTML image object
        if (this.image) {
            this.image.onload = null;
            this.image.onerror = null;
            this.image.src = '';
            this.image = null;
        }
        super.destroy();
    }
}

/**
 * A complete person entity with skeleton structure
 */
export class Person extends Drawable {
    constructor(name, cx, cy, width=null, height=null, parent=null, format='BODY18') {
        super(name, cx, cy, width, height, parent, format);
    }
    
    getPosition() {
        return this.keypointsDict['Neck']?.getPosition();
    }
}

/**
 * Scene containing all drawable entities
 */
export class Scene extends Entity {
    static COLORS = ['black', 'blue', 'green', 'red', 'purple', 'orange', 'cyan', 'magenta', 'brown'];
    
    constructor(name="Scene") {
        super(name);
        this.width = null;
        this.height = null;
        /** @type {() => void | null} */
        this.onStateChanged = null;
        this.poseLayers = [];
    }

    addPoseLayer(poseLayer) {
        if (!this.poseLayers.includes(poseLayer)) {
            this.poseLayers.push(poseLayer);
        }
    }

    deletePoseLayer(poseLayer) {
        poseLayer.clear();
        this.poseLayers.splice(this.poseLayers.indexOf(poseLayer), 1);
    }
    
    changeState(/** @type {boolean} */ statusChanged) {
        super.changeState(statusChanged);
        if (this.onStateChanged) {
            if (!this.isStateChangeLock) {
                this.onStateChanged();
            }
        }
    }

    get drawables() {
        return this.children.filter(child => child instanceof Drawable);
    }
    
    get persons() {
        return this.drawables.filter(d => d instanceof Person);
    }
    
    get images() {
        return this.drawables.filter(d => d instanceof DistortableImage);
    }

    async addPerson(bbox, personData=null, {strokeColor=null, fillColor='white', format='BODY18'}={}) {
        const personNum = this.persons.length + 1;
        this.lockStateChange();
        const person = await Person.create(
            `Person${personNum}`,
            bbox.x, bbox.y,
            {
                parent: this,
                format,
                personData,
                ...bbox
            }
        );
        if (!strokeColor) {
            const colorArr = Scene.COLORS.filter(color => color != fillColor);
            strokeColor = colorArr[(personNum - 1) % colorArr.length];
        }
        person.setStrokeColor(strokeColor);
        person.setFillColor(fillColor);
        this.unlockStateChange();
        person.changeState(true);
        return person;
    }

    async addImage(bbox, imagePath=null, {strokeColor=null, fillColor='white'}={}) {
        const imageNum = this.images.length + 1;
        this.lockStateChange();
        const image = await DistortableImage.create(
            `Image${imageNum}`,
            bbox.x, bbox.y,
            {
                imagePath,
                parent: this,
                ...bbox
            }
        );
        let constrainedSize = null;
        if (bbox.height != null && bbox.width != null) {
            constrainedSize = {height: bbox.height, width: bbox.width};
        }
        if (constrainedSize) {
            console.log(`Setting constrained size for Image${imageNum}:`, constrainedSize);
            image.constrainedImageSize = { ...constrainedSize };
        }
        if (!strokeColor) {
            strokeColor = Scene.COLORS[(imageNum - 1) % Scene.COLORS.length];
        }
        image.setStrokeColor(strokeColor);
        image.setFillColor(fillColor);
        this.unlockStateChange();
        image.changeState(true);
        return image;
    }
    
    removeDrawable(drawable) {
        if (this.drawables.includes(drawable)) {
            this.removeChild(drawable);
            this.poseLayers.forEach(poseLayer => poseLayer.removeDrawable(drawable));
            drawable.destroy();
        }
    }
    
    getDrawableFromKeypoint(keypoint) {
        for (const parent of keypoint.getParents()) {
            if (parent instanceof Drawable) {
                return parent;
            }
        }
        return null;
    }
    
    getPosition() {
        return { x: 0, y: 0 };
    }
    
    _setPosition(pos) {
        // Scene doesn't move
    }
}

/**
 * Pose layer manager - integrates Scene with Konva Layer
 */
export class PoseLayer {
    constructor(layer, scene = null) {
        this.layer = layer;
        this.drawables = [];
        this.scene = scene ?? new Scene();
        this.scene.addPoseLayer(this);
    }

    async addPerson(bbox={x: 0, y: 0, width: null, height: null}, personData=null, {...ctx}={}) {
        const person = await this.scene.addPerson(bbox, personData, ctx);
        this.renderDrawable(person);
        return person;
    }

    async addImage(bbox={x: 0, y: 0, width: null, height: null}, imagePath=null, {color=null}={}) {
        const image = await this.scene.addImage(bbox, imagePath, {color});
        this.renderDrawable(image);
        return image;
    }
    
    updateAll() {
        // Re-render all entities
        this.drawables.forEach(drawable => {
            this.renderDrawable(drawable);
        });
        this.layer.batchDraw();
    }
    
    renderDrawable(drawable) {
        // Update all bones
        drawable.render(this.layer);
        this.layer.getChildren().sort((a, b) => {
            if (a.className === 'Point') return 2;
            if (b.className === 'Point') return -2;
            if (a.className === 'Line') return 1;
            if (b.className === 'Line') return -1;
            return 0;
        });
        this.layer.batchDraw();
        if (!this.drawables.includes(drawable)) {
            this.drawables.push(drawable);
        }
    }
    
    removeDrawable(drawable) {
        // this.scene.removeDrawable(drawable);
        const index = this.drawables.indexOf(drawable);
        if (index !== -1) {
            this.drawables.splice(index, 1);
            this.layer.batchDraw();
        }
    }
    
    clear() {
        this.layer.destroy();
    }
}