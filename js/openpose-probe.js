/**
 * Enum for OpenPose JSON Formats and their ecosystem mapping.
 */
const OpenPoseFormats = Object.freeze({
    BODY18: {
        id: 'BODY18',
        develop: 'Automatic1111 / ControlNet Extension',
        description: 'Standard 18-keypoint (COCO) flat array. The industry standard for SD 1.5/XL ControlNet.'
    },
    BODY18COMFYUI: {
        id: 'BODY18COMFYUI',
        develop: 'ComfyUI / OpenPose Editor',
        description: 'Standard format extended with "canvas_width/height". Critical for multi-resolution latent scaling.'
    },

    BODY25: {
        id: 'BODY25',
        develop: 'Original OpenPose C++ / Research',
        description: '25-keypoint model (COCO + Mid-Hip + Feet). High precision but often needs conversion for web-UI tools.'
    },
    UNKNOWN: {
        id: 'UNKNOWN',
        develop: 'N/A',
        description: 'Structure does not match known OpenPose standards.'
    }
});

/**
 * Distinguishes specific OpenPose flavor.
 * @param {Object} data - The parsed JSON content.
 * @returns {Object} - Returns (format, develop, description) from Enum.
 */
function identifyPoseFormat(data) {
    // 1. Check for explicit format field first
    if (data.format) {
        switch(data.format) {
            case 'BODY25': return OpenPoseFormats.BODY25;
            case 'BODY18': return OpenPoseFormats.BODY18;
            case 'BODY18COMFYUI': return OpenPoseFormats.BODY18COMFYUI;

        }
    }



    // 3. Handle the "People" Array structure (Standard formats)
    const person = Array.isArray(data) ? data[0]?.people?.[0] : data?.people?.[0];
    
    if (person && person.pose_keypoints_2d) {
        const kpCount = person.pose_keypoints_2d.length / 3;

        // Determine if it has ComfyUI metadata
        const hasCanvas = data.canvas_width || (Array.isArray(data) && data[0].canvas_width);

        if (kpCount === 25) return OpenPoseFormats.BODY25;
        if (kpCount === 18) {
            // 18-keypoint people array format is always BODY18 (OpenPose standard)
            return hasCanvas ? OpenPoseFormats.BODY18COMFYUI : OpenPoseFormats.BODY18;
        }
        
        // Generic catch for "Standard" structure with custom KP counts (19, 70, etc.)
        return {
            ...OpenPoseFormats.BODY18,
            description: `Standard structure with ${kpCount} keypoints (includes ${person.hand_left_keypoints_2d ? 'hands/face' : 'body only'}).`
        };
    }

    return OpenPoseFormats.UNKNOWN;
}

/**
 * Skeleton Data Access Class
 * Provides efficient access to skeleton JSON data files
 */
export class SkeletonDataAccess {
    constructor() {
        this.cache = new Map();
        this.dataPath = './data/';
    }

    /**
     * Load skeleton data for specific format
     * @param {string} formatId - Format ID from OpenPoseFormats enum
     * @returns {Promise<Object>} Skeleton data structure
     */
    async loadSkeletonData(formatId) {
        if (this.cache.has(formatId)) {
            return this.cache.get(formatId);
        }

        try {
            const response = await fetch(`${this.dataPath}${formatId}.json`);
            if (!response.ok) {
                throw new Error(`Failed to load ${formatId}.json: ${response.statusText}`);
            }
            
            const data = await response.json();
            const processedData = this.processData(data);
            this.cache.set(formatId, processedData);
            return processedData;
        } catch (error) {
            console.error('Error loading skeleton data:', error);
        }
    }

    /**
     * Process raw JSON data into efficient structures
     * @param {Object} data - Raw JSON data
     * @returns {Object} Processed skeleton data
     */
    processData(data) {
        const keypointOrder = Object.keys(data.vertices);
        const positions = new Array(keypointOrder.length * 2);
        const nameToIndex = {};
        
        // Build positions array and name mapping
        keypointOrder.forEach((name, index) => {
            nameToIndex[name] = index;
            const pos = data.vertices[name];
            positions[index * 2] = pos[0];
            positions[index * 2 + 1] = pos[1];
        });

        // Convert edges from name pairs to index pairs
        const edges = new Uint16Array(data.edges.length * 2);
        data.edges.forEach((edge, index) => {
            const [startName, endName] = edge;
            edges[index * 2] = nameToIndex[startName];
            edges[index * 2 + 1] = nameToIndex[endName];
        });

        const limbNames = Object.keys(data.limbs).filter((key => !SkeletonDataAccess.isSymbolicLimb(key)));
        // Convert limbs from name arrays to index arrays
        const limbs = limbNames.map( limbName => {
            const indices = SkeletonDataAccess._resolveLimbs(data.limbs, data.limbs[limbName]).map(name => nameToIndex[name]);
            return new Uint8Array(indices);
        });

        const naturalBounds = this._calculateNaturalBounds(positions);

        return {
            positions,
            edges,
            names: keypointOrder,
            limbs,
            limbNames,
            metadata: data.metadata || null,
            nameToIndex,
            naturalBounds
        };
    }

    static isSymbolicLimb(limbName) {
        return limbName.startsWith('.');
    }

    static _resolveLimbs(limbData, limbNames) {
        const result = [];
        const stack = [...limbNames];

        while (stack.length) {
            const name = stack.pop();

            if (this.isSymbolicLimb(name)) {
                stack.push(...limbData[Object.hasOwn(limbData, name) ? name : name.slice(1)]);
            } else {
                result.push(name);
            }
        }
        return result;
    }

    async resolveLimbs(formatId, limbNames) {
        const response = await fetch(`${this.dataPath}${formatId}.json`);
        if (!response.ok) {
            throw new Error(`Failed to load ${formatId}.json: ${response.statusText}`);
        }
        const data = await response.json();
        return SkeletonDataAccess._resolveLimbs(data.limbs, limbNames);
        
    }

    /**
     * Calculate natural bounding box of vertices
     * @param {Array} positions - Vertex positions [x, y, x, y...]
     * @returns {Object} Bounds {minX, minY, width, height}
     */
    _calculateNaturalBounds(positions) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (let i = 0; i < positions.length; i += 2) {
            const x = positions[i];
            const y = positions[i + 1];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }

        // Handle empty case
        if (minX === Infinity) return { minX: 0, minY: 0, width: 0, height: 0 };

        return { minX, minY, width: maxX - minX, height: maxY - minY };
    }

    /**
     * set vertex position by name
     * @param {Object} skeletonData - Loaded skeleton data
     * @param {string} vertexName - Vertex Name
     * @param {Array<number|null>} position - [x, y] to set  
     */

    setVertexPosition(skeletonData, vertexName, position) {
        const i = skeletonData.names.indexOf(vertexName) * 2;
        skeletonData.positions[i] = position[0];
        skeletonData.positions[i + 1] = position[1];
    }

    /**
     * Get vertex position by index
     * @param {Object} skeletonData - Loaded skeleton data
     * @param {number} index - Vertex index
     * @param {Object} [bbox] - Target bounds {x, y, width, height}. If width/height missing, acts as offset x/y.
     * @returns {Object<string, number|null>} {x, y} position
     */
    getVertexPosition(skeletonData, index, bbox = { x: 0, y: 0, width: 0, height: 0 }) {
        const i = index * 2;
        const rawX = skeletonData.positions[i];
        const rawY = skeletonData.positions[i + 1];
        if (rawX == null && rawY == null) {
            return {
                x: null,
                y: null
            }
        }

        if (bbox.width && bbox.height && skeletonData.naturalBounds) {
            const nb = skeletonData.naturalBounds;
            const scaleX = nb.width ? bbox.width / nb.width : 1;
            const scaleY = nb.height ? bbox.height / nb.height : 1;
            return {
                x: bbox.x + (rawX - nb.minX) * scaleX,
                y: bbox.y + (rawY - nb.minY) * scaleY
            };
        }

        return {
            x: rawX + (bbox.x || 0),
            y: rawY + (bbox.y || 0)
        };
    }

    /**
     * Get edge vertices by edge index
     * @param {Object} skeletonData - Loaded skeleton data
     * @param {number} edgeIndex - Edge index
     * @returns {Array<number>} [startVertexIndex, endVertexIndex]
     */
    getEdge(skeletonData, edgeIndex) {
        const i = edgeIndex * 2;
        return [skeletonData.edges[i], skeletonData.edges[i + 1]];
    }

    /**
     * Get vertices in a limb
     * @param {Object} skeletonData - Loaded skeleton data
     * @param {number} limbIndex - Limb index
     * @returns {Array<number>} Vertex indices
     */
    getLimbVertices(skeletonData, limbIndex) {
        return Array.from(skeletonData.limbs[limbIndex]);
    }

    /**
     * Calculate edge length
     * @param {Object} skeletonData - Loaded skeleton data
     * @param {number} edgeIndex - Edge index
     * @param {Object} [bbox] - Target bounds {x, y, width, height}
     * @returns {number} Edge length
     */
    getEdgeLength(skeletonData, edgeIndex, bbox = { x: 0, y: 0, width: 0, height: 0 }) {
        const [startIdx, endIdx] = this.getEdge(skeletonData, edgeIndex);
        const start = this.getVertexPosition(skeletonData, startIdx, bbox);
        const end = this.getVertexPosition(skeletonData, endIdx, bbox);
        
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Get vertex name by index
     * @param {Object} skeletonData - Loaded skeleton data
     * @param {number} index - Vertex index
     * @returns {string} Vertex name
     */
    getVertexName(skeletonData, index) {
        return skeletonData.names[index];
    }

    /**
     * Get limb name by index
     * @param {Object} skeletonData - Loaded skeleton data
     * @param {number} index - Limb index
     * @returns {string} Limb name
     */
    getLimbName(skeletonData, index) {
        return skeletonData.limbNames[index];
    }

    /**
     * Translate all vertex positions
     * @param {Object} skeletonData - Loaded skeleton data
     * @param {number} deltaX - X translation
     * @param {number} deltaY - Y translation
     */
    translateVertices(skeletonData, deltaX, deltaY) {
        const positions = skeletonData.positions;
        for (let i = 0; i < positions.length; i += 2) {
            positions[i] += deltaX;
            positions[i + 1] += deltaY;
        }
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }

    /**
     * Export person data as OpenPose JSON format
     * @param {Person} person - Person entity to export
     * @param {string} format - Target format (defaults to person's format)
     * @param {Object | Object[] | null} toJson - Existing JSON to merge with
     * @returns {Promise<Object>} OpenPose JSON data
     */
    async exportPersonAsOpenPoseJson(person, format=null, toJson=null) {
        const targetFormat = format || person.format;
        
        try {
            const skeletonData = await this.loadSkeletonData(targetFormat);
            
            // Validate format compatibility
            if (!this.validatePersonFormatCompatibility(person, skeletonData)) {
                throw new Error(`Cannot convert to ${targetFormat}: incompatible keypoint structure`);
            }
            
            switch (targetFormat) {
                case 'BODY18':
                    return this.createBODY18(person, skeletonData, toJson);
                case 'BODY18COMFYUI':
                    return this.createBODY18COMFYUI(person, skeletonData, toJson);
                case 'BODY25':
                    return this.createBODY25(person, skeletonData, toJson);

                default:
                    const supportedFormats = ['BODY18', 'BODY18COMFYUI', 'BODY25'];
                    throw new Error(`Unsupported format: ${targetFormat}. Supported formats: ${supportedFormats.join(', ')}`);
            }
        } catch (error) {
            throw new Error(`Failed to generate OpenPose JSON data for ${targetFormat}: ${error.message}`);
        }
    }

    /**
     * Validate format compatibility for person export
     * @param {Person} person - Person entity to validate
     * @param {Object} skeletonData - Target skeleton data
     * @returns {boolean} True if compatible
     */
    validatePersonFormatCompatibility(person, skeletonData) {
        // Get current person's format and keypoints
        const currentFormat = person.format || 'UNKNOWN';
        const currentKeypoints = Object.keys(person.keypointsDict);
        const targetFormat = skeletonData.format;
        
        // Check if all required keypoints exist in this person
        const missingKeypoints = skeletonData.names.filter(name => !person.keypointsDict[name]);
        
        if (missingKeypoints.length > 0) {
            // Provide specific compatibility guidance based on format combinations
            if (currentFormat === 'BODY18' && targetFormat === 'BODY25') {
                throw new Error(`Cannot export BODY18 pose (18 keypoints) to BODY25 format (25 keypoints). BODY25 requires additional foot/toe keypoints that are not present: ${missingKeypoints.join(', ')}. Use ControlNet Standard format instead.`);
            } else if (currentFormat === 'BODY25' && targetFormat === 'BODY18') {
                throw new Error(`Exporting BODY25 pose (25 keypoints) to ControlNet format (18 keypoints) will lose foot/toe detail: ${missingKeypoints.join(', ')}. This is allowed but some pose precision will be lost.`);
            } else {
                throw new Error(`Format incompatibility: Current pose (${currentFormat}, ${currentKeypoints.length} keypoints) cannot be converted to ${targetFormat} (${skeletonData.names.length} keypoints). Missing: ${missingKeypoints.join(', ')}`);
            }
        }
        return true;
    }

    /**
     * Create ControlNet Standard format
     * @param {Person} person - Person entity
     * @param {Object} skeletonData - Skeleton data
     * @param {Object | null} toJson - Existing JSON to merge with
     * @returns {Object} ControlNet Standard JSON
     */
    createBODY18(person, skeletonData, toJson=null) {
        if (toJson === null) {
            toJson = {people: []};
        }
        const poseKeypoints = [];
        
        skeletonData.names.forEach(name => {
            if (['Face', 'LHand', 'RHand'].some(partName => name.startsWith(partName + '_'))) return;
            const kp = person.keypointsDict[name]
            const pos = kp.getPosition();
            const confidence = kp.getVisible()? 1.0 : 0.
            if (pos) {
                poseKeypoints.push(pos.x, pos.y, confidence); // x, y, confidence
            } else {
                poseKeypoints.push(0, 0, 0); // Missing keypoint
            }
        });
        
        // Export face keypoints if available
        const faceKeypoints = this.exportKeypoints(person.keypointsDict, 'Face');
        
        // Export hand keypoints if available
        const leftHandKeypoints = this.exportKeypoints(person.keypointsDict, 'LHand');
        const rightHandKeypoints = this.exportKeypoints(person.keypointsDict, 'RHand');
        
        toJson.people.push({
            pose_keypoints_2d: poseKeypoints,
            face_keypoints_2d: faceKeypoints,
            hand_left_keypoints_2d: leftHandKeypoints,
            hand_right_keypoints_2d: rightHandKeypoints
        })
        return toJson;
    }

    /**
     * Create ComfyUI Enhanced format
     * @param {Person} person - Person entity
     * @param {Object} skeletonData - Skeleton data
     * @param {Object[]|null} toJson - Existing ComfyUI Enhanced JSON to merge with
     * @returns {Object[]} ComfyUI Enhanced JSON
     */
    createBODY18COMFYUI(person, skeletonData, toJson=null) {
        if (toJson === null) {
            toJson = [{people: [], canvas_width: 0, canvas_height: 0}];
        }
        const data = toJson[toJson.length - 1];
        this.createBODY18(person, skeletonData, data);
        
        // Add canvas dimensions (assuming based on current pose extents)
        const positions = skeletonData.names.map(name => person.keypointsDict[name].getPosition()).filter(Boolean);
        if (positions.length > 0) {
            const xs = positions.map(p => p.x);
            const ys = positions.map(p => p.y);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            
            data.canvas_width = Math.max(Math.round(maxX - minX + 100), data.canvas_width);
            data.canvas_height = Math.max(Math.round(maxY - minY + 100), data.canvas_height);
        };
        
        return toJson;
    }

    /**
     * Create Body25 Full format
     * @param {Person} person - Person entity
     * @param {Object} skeletonData - Skeleton data
     * @param {Object|null} toJson - Existing Body25 Full JSON to merge with
     * @returns {Object} Body25 Full JSON
     */
    createBODY25(person, skeletonData, toJson=null) {
        return this.createBODY18(person, skeletonData, toJson);
    };



    /**
     * Export keypoints from person data for any body part
     * @param {Object} keypointDict - Person entity
     * @param {string} keypointType - 'Face', 'LHand', or 'RHand'
     * @returns {Array<number>} Keypoints array [x, y, confidence, ...] or empty array if no valid keypoints
     */
    exportKeypoints(keypointDict, keypointType) {
        const keypoints = [];
        let hasValidKeypoints = false;
        
        // Check if person has this type of keypoints
        for (const keypointName of Object.keys(keypointDict)) {
            // Loop through all available keypoints dynamically
            if (!keypointName.startsWith(keypointType + '_')){
                continue;
            }
            const keypoint = keypointDict[keypointName];
            const pos = keypoint.getPosition();
            if (keypoint && pos) {
                const confidence = keypoint.getVisible()? 1.0 : 0.
                keypoints.push(pos.x, pos.y, confidence);
                hasValidKeypoints = true;
            } else {
                keypoints.push(0, 0, 0);
            }
        };
        
        // Return empty array if no valid keypoints (all positions are 0,0)
        return hasValidKeypoints ? keypoints : [];
    }

    /**
     * Extract general COCO format keypoints from person data
     * @param {Object<string, number[]>} personData - Person data from OpenPose JSON
     * @param {string} cocoFormat - COCO format: BODY18, BODY25...
     * @return {Promise<Object>} skeletonData
     */
    async _extractCOCO(personData, cocoFormat) {
        const baseSkeletonData = await this.loadSkeletonData(cocoFormat);
        const skeletonData = {...baseSkeletonData, positions: new Array(baseSkeletonData.positions.length)};
        const bodyKpPositions = await this._importCOCOPartKeypoints(personData, "pose_keypoints_2d");
        skeletonData.positions.splice(0, bodyKpPositions.length, ...bodyKpPositions);
        const entries = [
            ['Face', 'face_keypoints_2d'],
            ['RHand', 'hand_right_keypoints_2d'],
            ['LHand', 'hand_left_keypoints_2d']
        ];
        await Promise.all(
            entries.map(async ([name, key]) => {
                const kpPositions = await this._importCOCOPartKeypoints(personData, key);
                for (let i = 0; i < kpPositions.length / 2; i++) {
                    this.setVertexPosition(
                        skeletonData,
                        `${name}_${i}`,
                        [kpPositions[i * 2], kpPositions[i * 2 + 1]]
                    );
                }
            })
        );
        return skeletonData;

    }

    /**
     * Extract BODY18 format keypoints from person data
     * @param {Object} personData - Person data from OpenPose JSON
     * @return {Object} skeletonData
     */
    async _extractBODY18(personData) {
        return this._extractCOCO(personData, 'BODY18');
    }

    /**
     * Extract BODY25 format keypoints from person data
     * @param {Object} personData - Person data from OpenPose JSON
     * @return {Object} skeletonData
     */
    async _extractBODY25(personData) {
        return this._extractCOCO(personData, 'BODY25');
    }

    /**
     * Extract BODY18COMFYUI format keypoints from person data
     * @param {Object} personData - Person data from OpenPose JSON
     * @return {Object} skeletonData
     */
    async _extractBODY18COMFYUI(personData) {
        return this._extractBODY18(personData);
    }



    /**
     * Import keypoints for given part if present
     * @param {Object<string, number[]>} personData - Person data from OpenPose JSON
     * @param {string} partName - name of body parts: "pose_keypoints_2d", "face_keypoints_2d", "hand_left_keypoints_2d", "hand_right_keypoints_2d"
     * @return {number[]} keypointPositions - Keypoint positions
     */
    async _importCOCOPartKeypoints(personData, partName) {
        const keypoints = personData[partName];
        if (!keypoints) return new Array();
        const numKeypoints = keypoints.length / 3
        const positions = new Array(numKeypoints * 2);
        
        for (let i = 0; i < numKeypoints; i++) {
            const x = keypoints[i * 3];
            const y = keypoints[i * 3 + 1];
            const confidence = keypoints[i * 3 + 2];
            
            if (confidence > 0 && (x > 0 || y > 0)) {
                positions[i * 2] = x;
                positions[i * 2 + 1] = y;
            } else {
                positions[i * 2] = null;
                positions[i * 2 + 1] = null;
            }
        }
        return positions;
    }

    /**
     * Extract keypoints from a single OpenPose person data
     * @param {Object<string, number[]>} personData - Person data from OpenPose JSON
     * @param {string} targetFormat - Target format (BODY18, BODY25, etc.)
     * @return {Object} skeletonData
     */
    async extractPerson(personData, targetFormat) {
        // Call format-specific extraction function
        switch (targetFormat) {
            case 'BODY18':
                return await this._extractBODY18(personData);
            case 'BODY25':
                return await this._extractBODY25(personData);
            case 'BODY18COMFYUI':
                return await this._extractBODY18COMFYUI(personData);

            default:
                throw new Error(`Unsupported format for keypoint extraction: ${targetFormat}`);
        }
    }

    /**
     * Load OpenPose JSON data and convert to internal skeleton data format
     * @param {Object|Object[]} openPoseJsonData - OpenPose JSON data
     * @returns {Promise<Object[]>} Array of skeleton data objects (one per person)
     */
    async loadOpenPoseJsonToSkeletonData(openPoseJsonData) {
        try {
            // Identify format
            const formatInfo = identifyPoseFormat(openPoseJsonData);
            if (formatInfo.id === 'UNKNOWN') {
                throw new Error('Unknown OpenPose JSON format - cannot identify structure');
            }
            
            const targetFormat = formatInfo.id;
            const results = [];
            
            // Handle array of canvas objects (ComfyUI multi-canvas format)
            const canvases = Array.isArray(openPoseJsonData) ? openPoseJsonData : [openPoseJsonData];
            let currentLayerId = 0;
            
            for (const canvas of canvases) {
                // Get people from this canvas
                const people = canvas.people || [];
                
                for (const personData of people) {
                    // Skip if this is a canvas object without person data
                    if (!personData || !personData.pose_keypoints_2d) {
                        continue;
                    }
                    
                    // Extract person keypoints
                    const skeletonData = await this.extractPerson(personData, targetFormat);
                    skeletonData.layer_id = currentLayerId;
                    
                    results.push(skeletonData);
                }
                currentLayerId++;
            }
            
            if (results.length === 0) {
                throw new Error('No valid person data found in OpenPose JSON');
            }
            
            return results;
            
        } catch (error) {
            throw new Error(`Failed to load OpenPose JSON data: ${error.message}`);
        }
    }

    /**
     * Distinguishes specific OpenPose flavor.
     * @param {Object} data - The parsed JSON content.
     * @returns {Object} - Returns (format, develop, description) from Enum.
     */
    static identifyPoseFormat(data) {identifyPoseFormat(data)};

    static _getLimbMap(limbData) {
        const pathDict = {};

        // 1. Identify every node that is "pointed to"
        // We must track exactly what strings are used as children.
        const pointedTo = new Set();
        for (const key in limbData) {
            const children = limbData[key];
            for (let i = 0; i < children.length; i++) {
                pointedTo.add(children[i]);
            }
        }

        // 2. Identify Roots
        // A key is a root ONLY if neither its exact name nor its symbolic name 
        // (with or without dot) appears in the pointedTo set.
        const roots = Object.keys(limbData).filter(key => {
            const altKey = key.startsWith('.') ? key.slice(1) : '.' + key;
            return !pointedTo.has(key) && !pointedTo.has(altKey);
        });

        // 3. Recursive Traversal
        const traverse = (nodeName, currentPath) => {
            // Use your lookup logic: Exact match, or strip the dot
            let lookupKey = nodeName;
            if (!Object.hasOwn(limbData, lookupKey) && lookupKey.startsWith('.')) {
                lookupKey = lookupKey.slice(1);
            }

            const children = limbData[lookupKey];

            if (children) {
                // BRANCH: Continue down. Basename cannot be symbolic, so strip dot.
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    const segment = child.startsWith('.') ? child.slice(1) : child;
                    traverse(child, `${currentPath}/${segment}`);
                }
            } else {
                // LEAF: Face_0, RHand_5, etc.
                // These are the keys in your final pathDict.
                if (!pathDict[nodeName]) pathDict[nodeName] = [];
                pathDict[nodeName].push(currentPath);
            }
        };

        // 4. Start from True Roots
        for (let i = 0; i < roots.length; i++) {
            const root = roots[i];
            const rootName = root.startsWith('.') ? root.slice(1) : root;
            traverse(root, `/${rootName}`);
        }

        return pathDict;
    }

    async buildLimbMap(formatId) {
        try {
            const response = await fetch(`${this.dataPath}${formatId}.json`);
            if (!response.ok) {
                throw new Error(`Failed to load ${formatId}.json: ${response.statusText}`);
            }
            
            const data = await response.json();
            return SkeletonDataAccess._getLimbMap(data.limbs);
        } catch (error) {
            console.error('Error loading limbMap data:', error);
        }
    }

}

export const dataAccessManager = new SkeletonDataAccess();