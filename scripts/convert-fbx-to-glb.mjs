// ============================================================
// FBX -> GLB offline converter.
//
// El FBX original (assets/3d/handbag/handbag.fbx) pesa ~3MB.
// GLB con geometria pura (sin texturas embedidas) + meshopt-friendly
// suele caer a 500-900KB. Texturas siguen servidas aparte como .webp
// con el mismo esquema de nombres; el GLB solo trae meshes + material
// refs que hero.js remapea a nuestros MeshStandardMaterial.
//
// Uso: npm run convert:3d
//
// Requiere: three (devDependency, misma version que el importmap del browser).
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- Node no tiene DOM. FBXLoader internamente llama a TextureLoader ->
// ImageLoader -> document.createElementNS('img'). Shimeamos un document
// minimo: los <img> devueltos nunca disparan onload, asi las texturas del
// FBX quedan vacias (.image = undefined). Eso esta BIEN — el hero remapea
// materiales por nombre de mesh en runtime, no necesita las texturas
// embedidas del FBX (ya estan como .webp aparte).
globalThis.document = {
  createElementNS(_ns, tag) {
    if (tag === 'img' || tag === 'image') {
      return {
        src: '', onload: null, onerror: null, crossOrigin: null,
        addEventListener() {}, removeEventListener() {}, dispatchEvent() {}
      };
    }
    if (tag === 'canvas') {
      return {
        width: 1, height: 1, style: {},
        getContext() { return null; },
        toDataURL() { return ''; }
      };
    }
    return { style: {} };
  }
};
globalThis.window = globalThis.window || {
  innerWidth: 1024, innerHeight: 768,
  devicePixelRatio: 1,
  addEventListener() {}, removeEventListener() {}
};

// Node 18+ expone Blob/File global, pero no FileReader. GLTFExporter lo usa
// cuando procesa blobs de imagen. Shim minimo contra Blob.arrayBuffer().
if (!globalThis.FileReader) {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null;
      this.onloadend = null;
      this.onerror = null;
    }
    readAsArrayBuffer(blob) {
      blob.arrayBuffer()
        .then((buf) => { this.result = buf; this.onloadend && this.onloadend(); })
        .catch((e) => { this.onerror && this.onerror(e); });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer()
        .then((buf) => {
          const b64 = Buffer.from(buf).toString('base64');
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
          this.onloadend && this.onloadend();
        })
        .catch((e) => { this.onerror && this.onerror(e); });
    }
  };
}

import { DOMParser } from 'xmldom';
globalThis.DOMParser = globalThis.DOMParser || DOMParser;

// Three expone FBXLoader y GLTFExporter desde examples/jsm
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FBX_PATH = path.join(ROOT, 'assets/3d/handbag/handbag.fbx');
const GLB_PATH = path.join(ROOT, 'assets/3d/handbag/handbag.glb');

async function main() {
  const fbxBuf = await fs.readFile(FBX_PATH);
  console.log(`[convert] FBX leido: ${(fbxBuf.length / 1024).toFixed(1)} KB`);

  // FBXLoader espera un ArrayBuffer, no Buffer. Copiamos la slice.
  const arrayBuffer = fbxBuf.buffer.slice(
    fbxBuf.byteOffset,
    fbxBuf.byteOffset + fbxBuf.byteLength
  );

  const loader = new FBXLoader();
  const model = loader.parse(arrayBuffer, '');
  console.log('[convert] FBX parseado, bake de materiales...');

  // Barrido de luces embedidas (el FBX de Blender trae 7 PointLights que
  // revientan la escena del hero). Lo hacemos aca tambien para que el GLB
  // salga limpio y el hero.js no tenga que filtrarlas en runtime.
  const stray = [];
  model.traverse((c) => { if (c.isLight) stray.push(c); });
  stray.forEach((l) => l.parent && l.parent.remove(l));
  console.log(`[convert] luces embedidas removidas: ${stray.length}`);

  // Diagnostico: contamos meshes + vertices totales para entender que trae
  // el FBX. Ayuda a decidir si vale la pena comprimir (Draco) o si hay
  // sub-meshes escondidos que podemos descartar antes de exportar.
  let meshCount = 0;
  let totalVerts = 0;
  model.traverse((c) => {
    if (c.isMesh && c.geometry?.attributes?.position) {
      meshCount++;
      const verts = c.geometry.attributes.position.count;
      totalVerts += verts;
      console.log(`  mesh "${c.name}" — ${verts} vertices, attrs: ${Object.keys(c.geometry.attributes).join(',')}`);
    }
  });
  console.log(`[convert] total: ${meshCount} meshes, ${totalVerts} vertices`);

  // Materiales: el hero remapea por nombre de mesh (lower/metal/upper), asi
  // que el GLB puede llevar materiales placeholder — solo importa que las
  // mesh conserven sus nombres. Limpiamos mapas ausentes para que el GLTF
  // exporter no genere advertencias.
  model.traverse((c) => {
    if (!c.isMesh) return;
    if (Array.isArray(c.material)) {
      c.material = c.material.map(stripMat);
    } else if (c.material) {
      c.material = stripMat(c.material);
    }
  });

  // Antes de exportar: descartar atributos del geometry que no usamos
  // (color vertex, uv2, skinIndex, skinWeight) — el hero solo lee position,
  // normal y uv para aplicar materiales PBR externos. Cada atributo son
  // 12+ bytes/vertice y el FBX viene con uv2 duplicado y colores a 1.0.
  model.traverse((c) => {
    if (!c.isMesh || !c.geometry) return;
    const g = c.geometry;
    ['color', 'uv2', 'uv1', 'skinIndex', 'skinWeight', 'tangent'].forEach((a) => {
      if (g.attributes[a]) g.deleteAttribute(a);
    });
  });

  // El FBX viene como triangle soup sin indices (cada vertice duplicado por
  // cara). mergeVertices colapsa los duplicados contra una tolerancia y
  // agrega un index buffer. Tipicamente reduce 30-50% el tamano final del
  // GLB porque los vertices unicos son pocos vs las copias por cara.
  //
  // Tolerancia 1e-4: suficientemente apretada para no colapsar vertices
  // semanticamente distintos (hard edges donde normales difieren), pero
  // laxa para comer el ruido float. En handbag realista (no procedural),
  // 1e-4 suele ser sweet spot.
  model.traverse((c) => {
    if (!c.isMesh || !c.geometry) return;
    const before = c.geometry.attributes.position.count;
    c.geometry = mergeVertices(c.geometry, 1e-4);
    const after = c.geometry.attributes.position.count;
    console.log(`  merge "${c.name}": ${before} -> ${after} verts (-${((1 - after/before) * 100).toFixed(1)}%)`);
  });

  const exporter = new GLTFExporter();
  const glbBuffer = await new Promise((resolve, reject) => {
    exporter.parse(
      model,
      (result) => {
        // result es ArrayBuffer cuando binary=true
        resolve(Buffer.from(result));
      },
      (err) => reject(err),
      {
        binary: true,
        onlyVisible: true,
        embedImages: false,
        forceIndices: true,            // merge de vertices duplicados
        truncateDrawRange: true,
        includeCustomExtensions: false
      }
    );
  });

  await fs.writeFile(GLB_PATH, glbBuffer);
  const reduction = (1 - glbBuffer.length / fbxBuf.length) * 100;
  console.log(`[convert] GLB escrito: ${(glbBuffer.length / 1024).toFixed(1)} KB  (-${reduction.toFixed(1)}%)`);
  console.log(`[convert] destino: ${GLB_PATH}`);
}

// Devuelve un MeshStandardMaterial minimo — el hero.js lo reemplaza en runtime.
// Conservamos el nombre para el remapeo por regex en el hero.
function stripMat(mat) {
  const m = new THREE.MeshStandardMaterial({ name: mat.name || '' });
  return m;
}

main().catch((err) => {
  console.error('[convert] fallo:', err);
  process.exit(1);
});
