export class LayoutManager {
    constructor() {
        this.wrapper = document.getElementById('toolbox-canvas-wrapper');
        this.toolbox = document.getElementById('toolbox');
        this.inspector = document.getElementById('object-inspector');
        this.toolboxHandle = document.getElementById('toolbox-handle');
        this.inspectorHandle = document.getElementById('inspector-handle');
        
        this.init();
    }

    init() {
        if (this.toolboxHandle) {
            this.toolboxHandle.addEventListener('click', () => this.toggleToolbox());
        }
        if (this.inspectorHandle) {
            this.inspectorHandle.addEventListener('click', () => this.toggleInspector());
        }
        
        // Initial state check - if we wanted to restore from localStorage, we would do it here
    }

    toggleToolbox() {
        this.toolbox.classList.toggle('collapsed');
        this.wrapper.classList.toggle('toolbox-collapsed');
        
        const isCollapsed = this.toolbox.classList.contains('collapsed');
        const span = this.toolboxHandle.querySelector('span');
        if (span) span.textContent = isCollapsed ? '›' : '‹';
    }

    toggleInspector() {
        this.inspector.classList.toggle('collapsed');
        this.wrapper.classList.toggle('inspector-collapsed');
        
        const isCollapsed = this.inspector.classList.contains('collapsed');
        const span = this.inspectorHandle.querySelector('span');
        if (span) span.textContent = isCollapsed ? '‹' : '›';
    }
}
