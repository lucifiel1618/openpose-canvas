export const GeomPrimitive = Base => class extends Base {
    constructor(config = {}) {
        super({...config});
        this.isGeomPrimitive = true;
    }
};

export class Point extends GeomPrimitive(Konva.Circle) {
    constructor(config = {}) {
        super({
            radius: 5,
            fill: 'yellow',
            stroke: 'black',
            strokeWidth: 2,
            draggable: true,
            strokeScaleEnabled: false,
            ...config
        });
        
        this.className = 'Point';
        this.type = 'point';

        this.baseRadius = this.radius();
        this.baseStrokeWidth = this.strokeWidth();
    }

    setStageScale(scaleFactor) {
        this.radius(this.baseRadius * scaleFactor);
        this.strokeWidth(this.baseStrokeWidth * (scaleFactor > 1 ? 1 : scaleFactor));
    }
}

export class Line extends GeomPrimitive(Konva.Line) {
    constructor(config = {}) {
        // Destructure with default values
        let { nodes = [], points = [], ...rest } = config;
        
        // Initialize points array based on nodes
        if (nodes.length > 0) {
            // If nodes are provided but points aren't, create points from nodes
            points = nodes.flatMap(p => [p.x(), p.y()]);
        } else if (points.length > 0) {
            // If points are provided but nodes aren't, create nodes from points
            for (let i = 0; i < points.length; i += 2) {
                nodes.push(new Point({ 
                    x: points[i], 
                    y: points[i + 1],
                    draggable: true
                }));
            }
        }

        // Initialize with standard defaults + any extra config
        super({
            stroke: 'black',
            strokeWidth: 4,
            draggable: true,
            strokeScaleEnabled: false,
            points: points,
            ...rest
        });

        this.className = 'Line';
        this.type = 'line';
        this.nodes = nodes;

        this.baseStrokeWidth = this.strokeWidth();
        this.setupDragListeners();
    }

    setStageScale(scaleFactor) {
        this.strokeWidth(this.baseStrokeWidth * (scaleFactor > 1 ? 1 : scaleFactor));
    }

    setupDragListeners() {
        this.nodes.forEach((point) => {
            point.on('xChange yChange', () => {
                // Update the line's visual points based on current node positions
                // console.log(`Dragging Line Node to (${point.x()}, ${point.y()})`);
                this.points(this.nodes.flatMap(p => [p.x(), p.y()]));
                // Force redraw of the layer if needed
                // this.getLayer()?.batchDraw();
            });
            
            // Track visibility changes - hide line if any node becomes hidden
            point.on('visibleChange', () => {
                this._updateVisibilityFromNodes();
            });
        });
    }
    
    /**
     * Update line visibility based on node visibility.
     * Line is hidden if any node is not visible.
     */
    _updateVisibilityFromNodes() {
        const allNodesVisible = this.nodes.every(node => node.visible());
        this.visible(allNodesVisible);
        this.getLayer()?.batchDraw();
    }
    
    // Optional: Helper method to add a node to the line
    addNode(x, y) {
        const node = new Point({ x, y, draggable: true });
        this.nodes.push(node);
        this.points(this.nodes.flatMap(p => [p.x(), p.y()]));
        this.setupDragListeners();
        return node;
    }
}
