/**
 * Script to set up the canvas with:
 * - Layer 1: example.png (image)
 * - Layer 2: Person 1 from example.json
 * - Layer 3: Person 2 from example.json
 * 
 * Usage: 
 * 1. Enable DEV_MODE in js/app.js (set DEV_MODE = true)
 * 2. Open index.html in browser
 * 3. Include this script or run in browser console
 */

(async function setupCanvas() {
    // Wait for app to be ready
    const waitForApp = () => {
        return new Promise((resolve) => {
            const check = () => {
                if (window.openposeCanvasApp && window.openposeCanvasApp.canvasManager) {
                    resolve(window.openposeCanvasApp);
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    };

    const app = await waitForApp();
    const canvasManager = app.canvasManager;
    const dataAccessManager = app.toolboxManager.dataAccessManager;
    
    console.log('App ready, setting up canvas...');

    const widthInput = document.getElementById('pageWidth')
    widthInput.value = 960;
    widthInput.dispatchEvent(new Event('change')); // Trigger change event to update canvas width
    const heightInput = document.getElementById('pageHeight');
    heightInput.value = 1290;
    heightInput.dispatchEvent(new Event('change')); // Trigger change event to update canvas height

    // Create Layer 2 and Layer 3 (Layer 1 exists by default)
    canvasManager.addLayer(); // Layer 2
    canvasManager.addLayer(); // Layer 3
    
    // Ensure we have 3 layers (index 0, 1, 2)
    const layers = canvasManager.getLayers();
    console.log(`Created ${layers.length} layers`);

    // Import example.png to Layer 1 (index 0)
    canvasManager.setCurrentLayer(0);
    const imagePath = 'example/example.jpg';
    canvasManager.addImage({ x: 0, y: 0 }, imagePath);
    console.log('Added image to Layer 1');

    // Load example.json and parse persons
    const jsonPath = 'example/example.json';
    const response = await fetch(jsonPath);
    const jsonData = await response.json();
    
    const personDataArr = await dataAccessManager.loadOpenPoseJsonToSkeletonData(jsonData);
    
    console.log(`Found ${personDataArr.length} persons in JSON`);
    
    // Add Person 1 to Layer 2 (index 1)
    canvasManager.setCurrentLayer(1);
    const person1 = await canvasManager.addPerson({ x: 0, y: 0 }, personDataArr[0], {strokeColor: '#FF0000'});
    console.log('Added Person 1 to Layer 2');
    
    // Add Person 2 to Layer 3 (index 2)
    canvasManager.setCurrentLayer(2);
    const person2 = await canvasManager.addPerson({ x: 0, y: 0 }, personDataArr[1]);
    console.log('Added Person 2 to Layer 3');

    // Rename layers for clarity
    canvasManager.renameLayer(0, 'Layer 1');
    canvasManager.renameLayer(1, 'Layer 2');
    canvasManager.renameLayer(2, 'Layer 3');

    console.log('Setup complete!');
    console.log('Layer 1: Image (example.jpg)');
    console.log('Layer 2: Person 1');
    console.log('Layer 3: Person 2');

    await app.queryManager.setCurrentDrawable(person1);
    app.queryManager.handleQuery('/RightHand');
    const nodeNames = Object.values(app.queryManager._groups).flatMap(matches => matches.map(m => m.nodeName));
    const shapes = [];
    for (const limb of person1.limbs) {
        for (const bone of limb.children) {
            let found = 0;
            for (const kp of bone.getAllKeypoints()) {
                if (nodeNames.includes(kp.name)) {
                    shapes.push(kp.shape);
                    found +=1;
                }
            if (found >= 2) shapes.push(bone.shape);
            }
        }
    }
    canvasManager.selectShapes(shapes);
    canvasManager.fitToPage();
})();
