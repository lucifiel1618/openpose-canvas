# [OpenposeCanvas]

[OpenposeCanvas] is a standalone, lightweight, browser-based [OpenPose] skeleton data editor, powered by [Konva.js][konva]. This tool allows users to load, view, and modify [OpenPose] JSON data directly in the browser using an intuitive canvas interface.

## Motivation

[OpenposeCanvas] is vastly inspired by [openpose-editor]. Its predecessors, however, due to their plugin nature, are pretty limited in features that users would typically expect from a graphics program—such as undo/redo and auto zoom features. This often becomes problematic when the pose detection tool fails miserably at its job and then extensive manual editing is required.

[OpenposeCanvas] attempts to address such issues and improve user experience in this scenario by re-introducing those ordinary drawing/editing tools from typical graphics programs.

## Features

- **Lightweight**: [OpenposeCanvas] is a static web application. No server required, runs entirely in the browser
- **Interactive editing** of keypoints on a canvas
- **Drag selection tool** to move, scale, and rotate multiple objects at once 
- **Layer/Object control**: lock/unlock & show/hide
- **Undo/Redo** features
- **Import/Export** [OpenPose] keypoints to/from various JSON formats

## Usage

1. **Start the Application**:
   * **Web**: Access [OpenposeCanvas]
   * **Local**: Run `python3 -m http.server 8000` then open `http://localhost:8000`
2. **Drag & drop** [OpenPose] JSON & image files
3. **Edit keypoints** by dragging them on the canvas
4. **Export** your changes as JSON


## Contribution

Contributions are highly appreciated! Whether it's a feature recommendation, bug report, or code improvement via GitHub Issues or Pull Requests, your input is welcome.

## License & Reuse

This project is open-source and available under the [MIT License](LICENSE). You are free to use, modify, distribute, and incorporate this software into your own projects—including commercial applications—without asking for permission, provided you comply with the license terms.

[OpenPose]: https://doi.org/10.1109/tpami.2019.2929257
[konva]: https://konvajs.org/
[openpose-editor]: https://github.com/huchenlei/sd-webui-openpose-editor
[OpenposeCanvas]: https://lucifiel1618.github.io/openpose-canvas/