import { CanvasManager } from './canvas.js';
import { SelectionTransformer } from './selectionbox.js';
import { ToolboxManager } from './toolbox.js';
import { ToolbarManager } from './toolbar.js';
import { StatusBarManager } from './statusbar.js';
import { ObjectInspector } from './object-inspector.js';
import { LayoutManager } from './layout.js';
import { NodeEditManager } from './node-edit.js';
import { FuzzyQueryManager } from './fuzzy-query.js';
import { RevisionManager } from './revision_manager.js';

const DEV_MODE = true; // this is only for debugging purposes. Make sure it's false for deployed version

class App {
    constructor() {
        this.canvasManager = new CanvasManager('openpose-canvas');
        this.selectionTransformer = new SelectionTransformer(this.canvasManager);
        this.toolboxManager = new ToolboxManager(this.canvasManager);
        this.toolbarManager = new ToolbarManager(this.canvasManager);
        this.statusBarManager = new StatusBarManager(this.canvasManager);
        this.objectInspector = new ObjectInspector(this.canvasManager);
        this.nodeEditManager = new NodeEditManager(this.canvasManager);
        this.queryManager = new FuzzyQueryManager(this.canvasManager);
        this.revisionManager = new RevisionManager(this.canvasManager);
        this.layoutManager = new LayoutManager();
        this.init();
    }

    init() {
        this.canvasManager.init();
        this.selectionTransformer.init();
        this.toolboxManager.init();
        this.toolbarManager.init();
        this.statusBarManager.init();
        this.queryManager.init();
        this.revisionManager.init();
        // this.queryManager.toggle(true);

        // const poseLayer = this.canvasManager.getCurrentPoseLayer();
        // let person = this.canvasManager.addPerson({x: 400, y: 300}, null, {format: 'BODY18'});
        // let image = this.canvasManager.addImage({x: 100, y: 200}, 'https://picsum.photos/200/300');
    }

    activateDevMode() {
        console.warn("OpenposeCanvas: Developer mode for debugging purposes. Make sure it's deactivated for your data security!");
        window.openposeCanvasApp = this;
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const openposeCanvasApp = new App();
    if (DEV_MODE) {
        openposeCanvasApp.activateDevMode();
    }
});