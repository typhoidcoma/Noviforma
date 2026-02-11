/**
 * WebGPU Renderer for Noviforma Grid and Viewer
 */

import gridShaderCode from '../shaders/grid.wgsl?raw';
import viewerShaderCode from '../shaders/viewer.wgsl?raw';

export interface TileInstance {
  x: number;
  y: number;
  w: number;
  h: number;
  textureIndex: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ViewerParams {
  textureIndex: number;
  aspectRatio: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

// Quad vertices (two triangles forming a unit square: 0,0 to 1,1)
const QUAD_VERTICES = new Float32Array([
  // Triangle 1
  0.0, 0.0,  // bottom-left
  1.0, 0.0,  // bottom-right
  0.0, 1.0,  // top-left
  // Triangle 2
  1.0, 0.0,  // bottom-right
  1.0, 1.0,  // top-right
  0.0, 1.0,  // top-left
]);

interface TextureCacheEntry {
  slot: number;
  url: string;
  lastUsed: number;
  assetId: number;
}

/**
 * LRU texture cache for managing limited GPU texture slots
 */
class TextureCache {
  private entries = new Map<number, TextureCacheEntry>(); // assetId -> entry
  private slotUsage = new Map<number, number>(); // slot -> assetId
  private freeSlots: number[] = [];
  private maxSlots: number;
  private device: GPUDevice;
  private textureArray: GPUTexture;

  constructor(maxSlots: number, device: GPUDevice, textureArray: GPUTexture) {
    this.maxSlots = maxSlots;
    this.device = device;
    this.textureArray = textureArray;
    // Initialize free slots
    for (let i = 0; i < maxSlots; i++) {
      this.freeSlots.push(i);
    }
  }

  /**
   * Get texture slot for an asset (if loaded)
   */
  getSlot(assetId: number): number | undefined {
    const entry = this.entries.get(assetId);
    if (entry) {
      // Update last used timestamp
      entry.lastUsed = Date.now();
      return entry.slot;
    }
    return undefined;
  }

  /**
   * Allocate a slot for a new texture
   * Evicts LRU texture if no free slots available
   */
  allocateSlot(assetId: number, url: string): number {
    // Check if already allocated
    const existing = this.entries.get(assetId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.slot;
    }

    // Get free slot or evict LRU
    let slot: number;
    if (this.freeSlots.length > 0) {
      slot = this.freeSlots.pop()!;
    } else {
      slot = this.evictLRU()!;
    }

    // Create new entry
    const entry: TextureCacheEntry = {
      slot,
      url,
      lastUsed: Date.now(),
      assetId,
    };

    this.entries.set(assetId, entry);
    this.slotUsage.set(slot, assetId);

    return slot;
  }

  /**
   * Find and evict the least recently used texture
   */
  private evictLRU(): number | null {
    if (this.entries.size === 0) {
      return null;
    }

    // Find LRU entry
    let oldestEntry: TextureCacheEntry | null = null;
    let oldestAssetId = -1;

    for (const [assetId, entry] of this.entries) {
      if (!oldestEntry || entry.lastUsed < oldestEntry.lastUsed) {
        oldestEntry = entry;
        oldestAssetId = assetId;
      }
    }

    if (!oldestEntry) {
      return null;
    }

    const slot = oldestEntry.slot;
    console.log(`Evicting texture: assetId=${oldestAssetId}, slot=${slot}, url=${oldestEntry.url}`);

    // Clear the texture slot
    this.clearTextureSlot(slot);

    // Remove from maps
    this.entries.delete(oldestAssetId);
    this.slotUsage.delete(slot);

    return slot;
  }

  /**
   * Clear a texture slot by uploading transparent data
   */
  private clearTextureSlot(slot: number): void {
    const clearData = new Uint8Array(256 * 256 * 4).fill(0);
    this.device.queue.writeTexture(
      { texture: this.textureArray, origin: [0, 0, slot] },
      clearData,
      { bytesPerRow: 256 * 4, rowsPerImage: 256 },
      [256, 256, 1]
    );
  }

  /**
   * Mark textures as recently used (prevents eviction)
   */
  markUsed(assetIds: number[]): void {
    const now = Date.now();
    for (const assetId of assetIds) {
      const entry = this.entries.get(assetId);
      if (entry) {
        entry.lastUsed = now;
      }
    }
  }

  /**
   * Get URL for an asset (if cached)
   */
  getUrl(assetId: number): string | undefined {
    return this.entries.get(assetId)?.url;
  }

  /**
   * Clear all textures
   */
  clear(): void {
    this.entries.clear();
    this.slotUsage.clear();
    this.freeSlots = [];
    for (let i = 0; i < this.maxSlots; i++) {
      this.freeSlots.push(i);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      used: this.entries.size,
      free: this.freeSlots.length,
      total: this.maxSlots,
      utilization: (this.entries.size / this.maxSlots) * 100,
    };
  }
}

/**
 * WebGPU renderer for grid of image thumbnails and fullscreen viewer
 */
export class WebGPURenderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;

  // Grid pipeline
  private gridPipeline!: GPURenderPipeline;
  private gridBindGroupLayout!: GPUBindGroupLayout;
  private gridBindGroup!: GPUBindGroup;

  // Viewer pipeline
  private viewerPipeline!: GPURenderPipeline;
  private viewerBindGroup!: GPUBindGroup;

  // Buffers
  private quadVertexBuffer!: GPUBuffer;
  private instanceBuffer!: GPUBuffer;
  private instanceCapacity = 10000; // Start with capacity for 10k tiles
  private viewportBuffer!: GPUBuffer;

  // Texture management
  private textureArray!: GPUTexture;
  private textureView!: GPUTextureView;
  private sampler!: GPUSampler;
  private textureArraySize = 256; // Max textures (GPU limitation)
  private textureCache: TextureCache;

  // State
  private tiles: TileInstance[] = [];
  private viewportWidth = 0;
  private viewportHeight = 0;
  private mode: 'grid' | 'viewer' = 'grid';
  private viewerParams: ViewerParams | null = null;

  /**
   * Initialize WebGPU device, pipelines, and resources
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    // Check WebGPU support
    console.log('WebGPU availability check:', {
      gpu: navigator.gpu,
      userAgent: navigator.userAgent
    });

    if (!navigator.gpu) {
      const msg = 'WebGPU is not supported in this webview. Tauri WebView2 may not have WebGPU enabled by default.';
      console.error(msg);
      alert(msg + '\n\nPlease check the console for more information.');
      throw new Error(msg);
    }

    // Request adapter
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get WebGPU adapter');
    }

    // Request device
    this.device = await adapter.requestDevice();

    // Get canvas context
    const context = canvas.getContext('webgpu');
    if (!context) {
      throw new Error('Failed to get WebGPU canvas context');
    }
    this.context = context;

    // Configure surface
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });

    // Create resources
    this.createBuffers();
    this.createTextures();
    await this.createPipelines();

    // Initialize texture cache
    this.textureCache = new TextureCache(this.textureArraySize, this.device, this.textureArray);

    console.log('WebGPU renderer initialized successfully');
  }

  /**
   * Create GPU buffers
   */
  private createBuffers(): void {
    // Quad vertex buffer (shared by both pipelines)
    this.quadVertexBuffer = this.device.createBuffer({
      label: 'Quad Vertex Buffer',
      size: QUAD_VERTICES.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.quadVertexBuffer, 0, QUAD_VERTICES);

    // Instance buffer for tile data
    const instanceSize = 9 * 4; // 9 floats * 4 bytes
    this.instanceBuffer = this.device.createBuffer({
      label: 'Instance Buffer',
      size: this.instanceCapacity * instanceSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Viewport uniform buffer
    this.viewportBuffer = this.device.createBuffer({
      label: 'Viewport Uniform Buffer',
      size: 2 * 4, // 2 floats (width, height)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Create texture array and sampler
   */
  private createTextures(): void {
    // Create 2D texture array for thumbnails
    // Using 256x256 as standard thumbnail size
    this.textureArray = this.device.createTexture({
      label: 'Thumbnail Texture Array',
      size: {
        width: 256,
        height: 256,
        depthOrArrayLayers: this.textureArraySize,
      },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      dimension: '2d',
    });

    this.textureView = this.textureArray.createView({
      dimension: '2d-array',
    });

    // Create sampler for texture filtering
    this.sampler = this.device.createSampler({
      label: 'Texture Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  /**
   * Create render pipelines for grid and viewer modes
   */
  private async createPipelines(): Promise<void> {
    // Load shaders
    const gridShader = this.device.createShaderModule({
      label: 'Grid Shader',
      code: gridShaderCode,
    });

    const viewerShader = this.device.createShaderModule({
      label: 'Viewer Shader',
      code: viewerShaderCode,
    });

    // Create bind group layout (shared by both pipelines)
    this.gridBindGroupLayout = this.device.createBindGroupLayout({
      label: 'Texture Bind Group Layout',
      entries: [
        // Binding 0: Viewport uniform
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
        // Binding 1: Sampler
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        // Binding 2: Texture array
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d-array' },
        },
      ],
    });

    // Create bind group
    this.gridBindGroup = this.device.createBindGroup({
      label: 'Texture Bind Group',
      layout: this.gridBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.viewportBuffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.textureView },
      ],
    });

    // Viewer uses same bind group
    this.viewerBindGroup = this.gridBindGroup;

    // Create pipeline layout
    const pipelineLayout = this.device.createPipelineLayout({
      label: 'Pipeline Layout',
      bindGroupLayouts: [this.gridBindGroupLayout],
    });

    // Grid pipeline
    this.gridPipeline = this.device.createRenderPipeline({
      label: 'Grid Render Pipeline',
      layout: pipelineLayout,
      vertex: {
        module: gridShader,
        entryPoint: 'vs_main',
        buffers: [
          // Quad vertices
          {
            arrayStride: 2 * 4, // 2 floats
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
          // Instance data
          {
            arrayStride: 9 * 4, // 9 floats
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32' },   // pos_x
              { shaderLocation: 2, offset: 4, format: 'float32' },   // pos_y
              { shaderLocation: 3, offset: 8, format: 'float32' },   // size_w
              { shaderLocation: 4, offset: 12, format: 'float32' },  // size_h
              { shaderLocation: 5, offset: 16, format: 'float32' },  // texture_index
              { shaderLocation: 6, offset: 20, format: 'float32' },  // color_r
              { shaderLocation: 7, offset: 24, format: 'float32' },  // color_g
              { shaderLocation: 8, offset: 28, format: 'float32' },  // color_b
              { shaderLocation: 9, offset: 32, format: 'float32' },  // color_a
            ],
          },
        ],
      },
      fragment: {
        module: gridShader,
        entryPoint: 'fs_main',
        targets: [
          {
            format: this.format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
    });

    // Viewer pipeline (same structure, different shader)
    this.viewerPipeline = this.device.createRenderPipeline({
      label: 'Viewer Render Pipeline',
      layout: pipelineLayout,
      vertex: {
        module: viewerShader,
        entryPoint: 'vs_main',
        buffers: [
          // Quad vertices
          {
            arrayStride: 2 * 4,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
          // Instance data (viewer params)
          {
            arrayStride: 5 * 4, // 5 floats
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32' },   // aspect_ratio
              { shaderLocation: 2, offset: 4, format: 'float32' },   // scale
              { shaderLocation: 3, offset: 8, format: 'float32' },   // offset_x
              { shaderLocation: 4, offset: 12, format: 'float32' },  // offset_y
              { shaderLocation: 5, offset: 16, format: 'float32' },  // texture_index
            ],
          },
        ],
      },
      fragment: {
        module: viewerShader,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
    });
  }

  /**
   * Resize viewport
   */
  resize(width: number, height: number, dpr: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;

    // Update canvas size (physical pixels)
    const canvas = this.context.canvas as HTMLCanvasElement;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    // Update CSS size
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    // Update viewport uniform
    const viewportData = new Float32Array([width * dpr, height * dpr]);
    this.device.queue.writeBuffer(this.viewportBuffer, 0, viewportData);
  }

  /**
   * Load a texture from URL with LRU caching
   */
  async loadTexture(assetId: number, imageUrl: string): Promise<number> {
    // Check if already loaded in cache
    const cachedSlot = this.textureCache.getSlot(assetId);
    if (cachedSlot !== undefined) {
      return cachedSlot;
    }

    try {
      // Fetch and decode image
      const response = await fetch(imageUrl);
      const blob = await response.blob();

      // Load image to get dimensions for aspect ratio preservation
      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);
      img.src = objectUrl;
      await img.decode();

      // Calculate aspect-preserving dimensions that fit in 256x256
      const maxSize = 256;
      const aspectRatio = img.width / img.height;
      let width, height;

      if (aspectRatio > 1) {
        // Landscape
        width = maxSize;
        height = Math.round(maxSize / aspectRatio);
      } else {
        // Portrait or square
        height = maxSize;
        width = Math.round(maxSize * aspectRatio);
      }

      // Create image bitmap with aspect-preserving dimensions
      const imageBitmap = await createImageBitmap(blob, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: 'high',
      });

      // Allocate slot (may evict LRU texture if full)
      const textureSlot = this.textureCache.allocateSlot(assetId, imageUrl);

      // Copy to texture array with correct dimensions
      this.device.queue.copyExternalImageToTexture(
        { source: imageBitmap },
        { texture: this.textureArray, origin: [0, 0, textureSlot] },
        { width, height, depthOrArrayLayers: 1 }
      );

      // Clean up
      URL.revokeObjectURL(objectUrl);
      imageBitmap.close();

      return textureSlot;
    } catch (error) {
      console.error('Failed to load texture:', imageUrl, error);
      return -1;
    }
  }

  /**
   * Load multiple textures in parallel
   */
  async loadTexturesBatch(assets: Array<{ id: number; url: string }>): Promise<number[]> {
    const promises = assets.map(asset => this.loadTexture(asset.id, asset.url));
    return await Promise.all(promises);
  }

  /**
   * Mark visible textures as recently used (prevents eviction)
   */
  markVisibleTextures(assetIds: number[]): void {
    this.textureCache.markUsed(assetIds);
  }

  /**
   * Get current texture slot for asset, accounting for LRU eviction
   */
  getCurrentTextureSlot(assetId: number): number {
    return this.textureCache.getSlot(assetId) ?? -1;
  }

  /**
   * Update tiles for grid rendering
   */
  updateTiles(tiles: TileInstance[]): void {
    this.tiles = tiles;
    this.mode = 'grid';

    // Resize instance buffer if needed
    if (tiles.length > this.instanceCapacity) {
      const newCapacity = Math.max(tiles.length * 2, 1000);
      console.log(`Resizing instance buffer: ${this.instanceCapacity} -> ${newCapacity}`);

      const instanceSize = 9 * 4;
      this.instanceBuffer.destroy();
      this.instanceBuffer = this.device.createBuffer({
        label: 'Instance Buffer',
        size: newCapacity * instanceSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.instanceCapacity = newCapacity;
    }

    // Write instance data
    if (tiles.length > 0) {
      const instanceData = new Float32Array(tiles.length * 9);
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        const offset = i * 9;
        instanceData[offset + 0] = tile.x;
        instanceData[offset + 1] = tile.y;
        instanceData[offset + 2] = tile.w;
        instanceData[offset + 3] = tile.h;
        instanceData[offset + 4] = tile.textureIndex;
        instanceData[offset + 5] = tile.r;
        instanceData[offset + 6] = tile.g;
        instanceData[offset + 7] = tile.b;
        instanceData[offset + 8] = tile.a;
      }
      this.device.queue.writeBuffer(this.instanceBuffer, 0, instanceData);
    }
  }

  /**
   * Set viewer mode parameters
   */
  setViewerParams(params: ViewerParams): void {
    this.viewerParams = params;
    this.mode = 'viewer';

    // Write viewer instance data
    const viewerData = new Float32Array([
      params.aspectRatio,
      params.scale,
      params.offsetX,
      params.offsetY,
      params.textureIndex,
    ]);
    this.device.queue.writeBuffer(this.instanceBuffer, 0, viewerData);
  }

  /**
   * Render current frame
   */
  render(): void {
    // Get current texture
    const currentTexture = this.context.getCurrentTexture();
    const textureView = currentTexture.createView();

    // Create render pass
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.04, g: 0.04, b: 0.04, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    if (this.mode === 'grid' && this.tiles.length > 0) {
      // Render grid
      pass.setPipeline(this.gridPipeline);
      pass.setBindGroup(0, this.gridBindGroup);
      pass.setVertexBuffer(0, this.quadVertexBuffer);
      pass.setVertexBuffer(1, this.instanceBuffer);
      pass.draw(6, this.tiles.length, 0, 0);
    } else if (this.mode === 'viewer' && this.viewerParams) {
      // Render viewer
      pass.setPipeline(this.viewerPipeline);
      pass.setBindGroup(0, this.viewerBindGroup);
      pass.setVertexBuffer(0, this.quadVertexBuffer);
      pass.setVertexBuffer(1, this.instanceBuffer);
      pass.draw(6, 1, 0, 0);
    }

    pass.end();

    // Submit
    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * Get texture index for an asset (if already loaded)
   */
  getTextureIndex(assetId: number): number | undefined {
    return this.textureCache.getSlot(assetId);
  }

  /**
   * Clear all textures
   */
  clearTextures(): void {
    this.textureCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.textureCache.getStats();
  }
}
