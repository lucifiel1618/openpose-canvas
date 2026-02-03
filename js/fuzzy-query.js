import { dataAccessManager } from './openpose-probe.js';

/* ================================
* Public API
* ================================ */

function fuzzyPathSearch(query, pathMap, options = {}) {
    const {
        cutoff = 0,
        maxNum = undefined
    } = options;
    
    const qSegs = splitPath(query);
    const hasSlash = query.includes("/");
    
    const results = [];
    
    for (const nodeName of Object.keys(pathMap)) {
        for (const path of pathMap[nodeName]) {
            const data = preprocessPath(path);
            const score = scorePath(qSegs, hasSlash, data);
            
            if (score >= cutoff) {
                results.push({nodeName, path, score });
            }
        }
    }
    
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxNum);
}

/* ================================
* Path scoring
* ================================ */

function scorePath(qSegs, hasSlash, data) {
    let score = 0;
    
    // Path-aware matching
    const pathScore = matchPathSegments(qSegs, data.segments);
    if (pathScore === -Infinity) return -Infinity;
    
    score += pathScore;
    
    // Basename bias (VS Code magic)
    if (!hasSlash) {
        const baseScore = scoreFuzzy(qSegs[0], data.basenameNoExt);
        if (baseScore > 0) score += baseScore * 1.5;
    }
    
    // Exact basename bonus
    if (data.basenameNoExt.toLowerCase() === qSegs.at(-1).toLowerCase()) {
        score += 30;
    }
    
    // Shorter paths win ties
    score -= data.full.length * 0.05;
    
    return score;
}

function matchPathSegments(qSegs, pathSegs) {
    let score = 0;
    let pi = 0;
    
    for (let qi = 0; qi < qSegs.length; qi++) {
        let best = -Infinity;
        let bestIndex = -1;
        
        for (let j = pi; j < pathSegs.length; j++) {
            const s = scoreFuzzy(qSegs[qi], pathSegs[j]);
            if (s > best) {
                best = s;
                bestIndex = j;
            }
        }
        
        if (bestIndex === -1) return -Infinity;
        
        score += best;
        score -= (bestIndex - pi) * 6; // skip penalty
        pi = bestIndex + 1;
    }
    
    return score;
}

/* ================================
* VS Code–style fuzzy scorer
* ================================ */

function scoreFuzzy(query, target) {
    if (!query || !target) return -Infinity;
    
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    
    let qi = 0;
    let lastMatch = -1;
    let score = 0;
    
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (q[qi] === t[ti]) {
            score += 10; // base
            
            if (ti === 0) score += 15; // start of segment
            if (ti === lastMatch + 1) score += 8; // contiguous
            if (isWordBoundary(target, ti)) score += 12;
            
            lastMatch = ti;
            qi++;
        }
    }
    
    if (qi !== q.length) return -Infinity;
    
    score -= (t.length - q.length); // gap penalty
    return score;
}

function isWordBoundary(str, i) {
    if (i === 0) return true;
    const prev = str[i - 1];
    const curr = str[i];
    
    if (prev === '/' || prev === '_' || prev === '-' || prev === '.') return true;
    if (isLower(prev) && isUpper(curr)) return true;
    
    return false;
}

/* ================================
* Helpers
* ================================ */

function splitPath(path) {
    return path.split("/").filter(Boolean);
}

function preprocessPath(path) {
    const segments = splitPath(path);
    const basename = segments.at(-1) || "";
    const basenameNoExt = basename.replace(/\.[^/.]+$/, "");
    
    return {
        full: path,
        segments,
        basename,
        basenameNoExt
    };
}

function isLower(c) {
    return c >= 'a' && c <= 'z';
}

function isUpper(c) {
    return c >= 'A' && c <= 'Z';
}

export class FuzzyQueryManager {
    constructor(canvasManager) {
        this.canvasManager = canvasManager;
        this.currentDrawable = null;
        this.formatId = null;
        this.limbMap = new Map();
        this.allPaths = [];
        this.cutoff = 1;
        
        // UI Elements
        this.container = document.getElementById('fuzzy-search-container');
        this.input = document.getElementById('fuzzy-search-input');
        this.resultsElement = document.getElementById('fuzzy-search-results');
        this.label = document.getElementById('drawable-label');
        this.labelText = this.label?.querySelector('.label-text');
        this.labelClose = this.label?.querySelector('.label-close');
        this.closeSearch = document.getElementById('close-search');
        this.toggleBtn = document.getElementById('fuzzy-search-toggle-btn');
    }

    init() {
        this.setupEvents();
    }

    async setCurrentDrawable(drawable = null) {
        this.currentDrawable = drawable;
        if (drawable) {
            this.labelText.textContent = drawable.name;
            this.label.classList.remove('hidden');
            this.input.placeholder = "Search limbs (e.g. 'Hand')...";
            await this.setFormat(drawable.format);
        } else {
            this.label.classList.add('hidden');
            this.input.placeholder = "Select a drawable...";
            this.formatId = null;
            this.allPaths = [];
        }
        this.input.value = "";
        this.resultsElement.innerHTML = ''; // Clear any previous styling
        this.renderInitialState();
    }

    async setFormat(formatId) {
        if (!this.limbMap.has(formatId)) {
            // Assuming dataAccessManager is imported as before
            const limbs = await dataAccessManager.buildLimbMap(formatId);
            this.limbMap.set(formatId, limbs);
        }
        this.formatId = formatId;
        this.allPaths = this.limbMap.get(formatId) || [];
    }

    setupEvents() {
        this.input.oninput = (e) => this.handleQuery(e.target.value);
        
        this.labelClose.onclick = () => this.setCurrentDrawable();
        
        this.closeSearch.onclick = () => this.toggle(false);
        
        // Toggle button functionality
        this.toggleBtn.onclick = () => {
            const isHidden = this.container.classList.contains('hidden');
            this.toggle(isHidden);
        };
        
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                this.toggle(true);
            }
        });
    }

    toggle(show) {
        this.container.classList.toggle('hidden', !show);
        this.toggleBtn.classList.toggle('active', show);
        if (show) {
            this.input.focus();
            this.renderInitialState();
        } else {
            // Reset state when closed
            // this.setCurrentDrawable();
        }
    }

    renderInitialState() {
        this.resultsElement.innerHTML = '';
        if (!this.currentDrawable) {
            const drawables = this.canvasManager.scene.drawables;
            drawables.forEach(d => {
                const item = document.createElement('div');
                item.className = 'group-header'; // Reusing style for consistency
                item.innerHTML = `<span>📂 ${d.name}</span> <small style="margin-left:8px; color: #888;">${d.format}</small>`;
                item.onclick = () => this.setCurrentDrawable(d);
                this.resultsElement.appendChild(item);
            });
        }
    }

    handleQuery(query) {
        if (!this.currentDrawable) {
            // If no drawable selected, filter the layer list instead
            this.filterDrawables(query);
            return;
        }

        if (!query) {
            this.resultsElement.innerHTML = '';
            return;
        }

        const matches = fuzzyPathSearch(query, this.allPaths, { cutoff: this.cutoff });
        const groups = this.groupByRoot(matches);
        this.renderGroups(groups);
    }

    filterDrawables(query) {
        this.resultsElement.innerHTML = '';
        const drawables = this.canvasManager.scene.drawables.filter(d => 
            d.name.toLowerCase().includes(query.toLowerCase())
        );
        drawables.forEach(d => {
            const item = document.createElement('div');
            item.className = 'group-header';
            item.innerHTML = `<span>📂 ${d.name}</span>`;
            item.onclick = () => this.setCurrentDrawable(d);
            this.resultsElement.appendChild(item);
        });
    }

    groupByRoot(matches) {
        const groups = {};
        matches.forEach(m => {
            const root = m.path.split('/')[1]; // Assume path starts with /
            if (!groups[root]) groups[root] = [];
            groups[root].push(m);
        });
        return groups;
    }

    getLowestSharedParent(paths) {
        if (paths.length === 0) return "";
        const splitPaths = paths.map(p => p.split('/'));
        let common = [];
        let first = splitPaths[0];

        for (let i = 0; i < first.length; i++) {
            const segment = first[i];
            if (splitPaths.every(p => p[i] === segment)) {
                common.push(segment);
            } else {
                break;
            }
        }
        return common.join('/') || "/";
    }

    renderGroups(groups) {
        this.resultsElement.innerHTML = '';
        
        Object.entries(groups).forEach(([root, matches]) => {
            const paths = matches.map(m => m.path);
            const sharedParent = this.getLowestSharedParent(paths);
            const groupDiv = document.createElement('div');
            groupDiv.className = 'result-group';
            
            // Header showing the shared parent
            const header = document.createElement('div');
            header.className = 'group-header';
            header.innerHTML = `<span class="toggle-arrow">▶</span> <span>${sharedParent}</span> <small> (${paths.length} nodes)</small>`;
            
            // Collapsible container for children
            const childrenList = document.createElement('div');
            childrenList.className = 'group-children hidden';
            
            const missingNodePromises = [];
            matches.forEach(m => {
                const child = document.createElement('div');
                child.className = 'child-path';
                
                // Check if this child is missing and apply styling
                missingNodePromises.push(this.handleMissingChildAsync(m.nodeName, child));
                
                // Show only the unique part of the child path
                child.textContent = "..." + m.path.replace(sharedParent, "");
                child.onclick = () => {
                    this.selectShapesForNodeNames([m.nodeName]);
                    this.toggle(false);
                };
                childrenList.appendChild(child);
            });

            this.handleMissingGroupAsync(missingNodePromises, header);

            // Click on arrow to toggle dropdown
            const arrow = header.querySelector('.toggle-arrow');
            arrow.onclick = (e) => {
                e.stopPropagation();
                childrenList.classList.toggle('hidden');
                arrow.textContent = childrenList.classList.contains('hidden') ? '▶' : '▼';
            };
            
            // Single-click on header (not arrow) to select all shapes in this group
            header.onclick = (e) => {
                if (e.target !== arrow) {
                    e.stopPropagation();
                    this.selectShapesForNodeNames(matches.map(m => m.nodeName));
                    this.toggle(false);
                }
            };
            
            groupDiv.appendChild(header);
            groupDiv.appendChild(childrenList);
            this.resultsElement.appendChild(groupDiv);
        });
        

    }
    
    async isChildMissing(nodeName) {
        if (!this.currentDrawable || !this.currentDrawable.keypointsDict[nodeName]) {
            return true; // Missing if keypoint doesn't exist
        }
        return this.currentDrawable.keypointsDict[nodeName].getPosition() === null;
    }

    async handleMissingChildAsync(nodeName, element) {
        // Check if this child is missing and apply styling
        if (await this.isChildMissing(nodeName)) {
            element.style.backgroundColor = '#ffebee'; // Light red background
            return 1;
        }
        return 0;
    }

    async handleMissingGroupAsync(missingNodePromises, element) {
        // Apply header styling based on missing children count
        const totalCount = missingNodePromises.length;
        const missingCount = (await Promise.all(missingNodePromises)).reduce((total, value) => total + value, 0);
        
        if (missingCount === totalCount && totalCount > 0) {
            element.style.backgroundColor = '#ffcdd2'; // Red - all missing
        } else if (missingCount > 0) {
            element.style.backgroundColor = '#fff9c4'; // Yellow - some missing
        }
    }

    selectShapesForNodeNames(nodeNames) {
        if (!this.currentDrawable) return;
        
        const shapes = [];
        
        // Check keypoints
        for (const nodeName of nodeNames) {
            if (this.currentDrawable.keypointsDict[nodeName]) {
                const kp = this.currentDrawable.keypointsDict[nodeName];
                if (kp.shape) shapes.push(kp.shape);
            }
        }

        this.canvasManager.selectShapes(shapes, false);

    }
}