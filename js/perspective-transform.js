const { mat3 } = glMatrix;

/* =========================================================
 * OffsetImage
 * ========================================================= */

export class OffsetImage {
    constructor(image, offset) {
        this.image = image;
        this.offset = offset;
    }

    get size() {
        return [this.image.width, this.image.height];
    }

    toKonvaConfig() {
        return {
            image: this.image,
            x: this.offset[0],
            y: this.offset[1],
        };
    }
}

/* =========================================================
 * Public API
 * ========================================================= */

export function offsetImageProjected(input, quad, options = {}) {
    const {
        useGPU = false,
        interpolation = "bilinear",
    } = options;

    const image = input instanceof OffsetImage ? input.image : input;

    const xs = quad.map(p => p[0]);
    const ys = quad.map(p => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);

    const adjusted = quad.map(([x, y]) => [x - minX, y - minY]);
    const outW = Math.ceil(Math.max(...xs) - minX);
    const outH = Math.ceil(Math.max(...ys) - minY);

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;

    const src = [
        [0, 0],
        [image.width, 0],
        [image.width, image.height],
        [0, image.height],
    ];

    // Canonical homography: src → dst
    const Hs2d = computeHomography(src, adjusted);

    // Inverse for CPU rasterization
    const Hd2s = mat3.invert(mat3.create(), Hs2d);

    if (useGPU && window.WebGLRenderingContext) {
        try {
            if (drawPerspectiveWebGL(canvas, image, Hs2d, outW, outH, interpolation)) {
                return new OffsetImage(canvas, [minX, minY]);
            }
        } catch (e) {
            console.warn("WebGL failed, falling back to CPU", e);
        }
    }

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    drawPerspectiveCPU(ctx, image, Hd2s, outW, outH, interpolation);

    return new OffsetImage(canvas, [minX, minY]);
}

/* =========================================================
 * Homography math
 * ========================================================= */

function computeHomography(src, dst) {
    const A = [];
    const b = [];

    for (let i = 0; i < 4; i++) {
        const [x, y] = src[i];
        const [u, v] = dst[i];

        A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
        A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
        b.push(u, v);
    }

    const h = solveLinearSystem(A, b);

    return mat3.fromValues(
        h[0], h[1], h[2],
        h[3], h[4], h[5],
        h[6], h[7], 1
    );
}

function solveLinearSystem(A, b) {
    const n = b.length;
    const M = A.map((r, i) => [...r, b[i]]);

    for (let i = 0; i < n; i++) {
        let max = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(M[k][i]) > Math.abs(M[max][i])) max = k;
        }
        [M[i], M[max]] = [M[max], M[i]];

        const pivot = M[i][i];
        if (Math.abs(pivot) < 1e-9) throw new Error("Degenerate homography");

        for (let j = i; j <= n; j++) M[i][j] /= pivot;

        for (let k = 0; k < n; k++) {
            if (k === i) continue;
            const f = M[k][i];
            for (let j = i; j <= n; j++) {
                M[k][j] -= f * M[i][j];
            }
        }
    }
    return M.map(r => r[n]);
}

/* =========================================================
 * CPU rasterization (inverse mapping)
 * ========================================================= */

function drawPerspectiveCPU(ctx, image, H, width, height, interpolation) {
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = image.width;
    srcCanvas.height = image.height;

    const sctx = srcCanvas.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(image, 0, 0);

    const srcData = sctx.getImageData(0, 0, image.width, image.height).data;
    const dstImage = ctx.createImageData(width, height);
    const dst = dstImage.data;

    const sw = image.width;
    const sh = image.height;

    const h00 = H[0], h01 = H[1], h02 = H[2];
    const h10 = H[3], h11 = H[4], h12 = H[5];
    const h20 = H[6], h21 = H[7], h22 = H[8];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const d = h20 * x + h21 * y + h22;
            if (d === 0) continue;

            const sx = (h00 * x + h01 * y + h02) / d;
            const sy = (h10 * x + h11 * y + h12) / d;
            const di = (y * width + x) * 4;

            if (sx >= 0 && sy >= 0 && sx < sw - 1 && sy < sh - 1) {
                const ix = Math.floor(sx);
                const iy = Math.floor(sy);
                const fx = sx - ix;
                const fy = sy - iy;

                const i00 = (iy * sw + ix) * 4;
                const i10 = i00 + 4;
                const i01 = i00 + sw * 4;
                const i11 = i01 + 4;

                for (let c = 0; c < 4; c++) {
                    dst[di + c] =
                        srcData[i00 + c] * (1 - fx) * (1 - fy) +
                        srcData[i10 + c] * fx * (1 - fy) +
                        srcData[i01 + c] * (1 - fx) * fy +
                        srcData[i11 + c] * fx * fy;
                }
            } else {
                dst[di + 3] = 0;
            }
        }
    }
    ctx.putImageData(dstImage, 0, 0);
}

/* =========================================================
 * WebGL (correct coordinate space)
 * ========================================================= */

function drawPerspectiveWebGL(canvas, image, H, width, height, interpolation) {
    const gl = canvas.getContext("webgl");
    if (!gl) return false;

    const vs = `
        attribute vec2 aPos;
        attribute vec2 aUV;
        varying vec2 vUV;
        void main() {
            gl_Position = vec4(aPos, 0.0, 1.0);
            vUV = aUV;
        }
    `;

    const fs = `
        precision mediump float;
        uniform sampler2D uTex;
        uniform mat3 uH;
        uniform vec2 uOutSize;
        uniform vec2 uImgSize;
        varying vec2 vUV;

        void main() {
            vec2 dstPx = vUV * uOutSize;
            vec3 src = uH * vec3(dstPx, 1.0);
            vec2 uv = (src.xy / src.z) / uImgSize;

            if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
                gl_FragColor = vec4(0.0);
            } else {
                gl_FragColor = texture2D(uTex, uv);
            }
        }
    `;

    const prog = createProgram(gl, vs, fs);
    gl.useProgram(prog);

    const quad = new Float32Array([
        -1,-1, 0,0,
         1,-1, 1,0,
        -1, 1, 0,1,
         1, 1, 1,1,
    ]);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const stride = 16;
    gl.enableVertexAttribArray(gl.getAttribLocation(prog, "aPos"));
    gl.vertexAttribPointer(gl.getAttribLocation(prog, "aPos"), 2, gl.FLOAT, false, stride, 0);

    gl.enableVertexAttribArray(gl.getAttribLocation(prog, "aUV"));
    gl.vertexAttribPointer(gl.getAttribLocation(prog, "aUV"), 2, gl.FLOAT, false, stride, 8);

    gl.uniformMatrix3fv(gl.getUniformLocation(prog, "uH"), false, new Float32Array([
        H[0], H[3], H[6],
        H[1], H[4], H[7],
        H[2], H[5], H[8],
    ]));

    gl.uniform2f(gl.getUniformLocation(prog, "uOutSize"), width, height);
    gl.uniform2f(gl.getUniformLocation(prog, "uImgSize"), image.width, image.height);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
        interpolation === "nearest" ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER,
        interpolation === "nearest" ? gl.NEAREST : gl.LINEAR);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    gl.viewport(0, 0, width, height);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    return true;
}

/* =========================================================
 * GL helpers
 * ========================================================= */

function createProgram(gl, vsSrc, fsSrc) {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc);
    gl.compileShader(fs);

    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    return p;
}
