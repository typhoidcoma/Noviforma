// Viewport uniform (screen dimensions)
struct Viewport {
    width: f32,
    height: f32,
}

@group(0) @binding(0)
var<uniform> viewport: Viewport;

@group(0) @binding(1)
var texture_sampler: sampler;

@group(0) @binding(2)
var tile_texture: texture_2d_array<f32>;

@group(0) @binding(3)
var<uniform> transform: mat4x4<f32>;

@group(0) @binding(4)
var hires_texture: texture_2d_array<f32>;

@group(0) @binding(5)
var<uniform> time: f32;

// Vertex input: unit quad (0,0 to 1,1)
struct VertexInput {
    @location(0) position: vec2<f32>,
}

// Instance input: tile position, size, texture, and color
struct InstanceInput {
    @location(1) pos_x: f32,
    @location(2) pos_y: f32,
    @location(3) size_w: f32,
    @location(4) size_h: f32,
    @location(5) texture_index: f32,
    @location(6) color_r: f32,
    @location(7) color_g: f32,
    @location(8) color_b: f32,
    @location(9) color_a: f32,
}

// Vertex output / Fragment input
struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) texture_index: f32,
    @location(2) color: vec4<f32>,
}

// Vertex shader: transforms unit quad to screen space using instance data
@vertex
fn vs_main(
    vertex: VertexInput,
    instance: InstanceInput,
) -> VertexOutput {
    var out: VertexOutput;

    // Calculate pixel position: instance position + vertex position * instance size
    let pixel_x = instance.pos_x + vertex.position.x * instance.size_w;
    let pixel_y = instance.pos_y + vertex.position.y * instance.size_h;

    // Apply transform (zoom and pan)
    let transformed = transform * vec4<f32>(pixel_x, pixel_y, 0.0, 1.0);

    // Convert transformed coordinates to clip space [-1, 1]
    // X: 0 -> -1, viewport.width -> 1
    // Y: 0 -> 1, viewport.height -> -1 (flip Y axis)
    let clip_x = (transformed.x / viewport.width) * 2.0 - 1.0;
    let clip_y = 1.0 - (transformed.y / viewport.height) * 2.0;

    out.clip_position = vec4<f32>(clip_x, clip_y, 0.0, 1.0);
    out.uv = vertex.position; // Unit quad position is already valid UV (0,0 to 1,1)
    out.texture_index = instance.texture_index;
    out.color = vec4<f32>(instance.color_r, instance.color_g, instance.color_b, instance.color_a);

    return out;
}

// Rounded rectangle SDF in UV space (0,0 to 1,1)
// Returns signed distance: negative inside, positive outside
fn roundedRectSDF(uv: vec2<f32>, radius: f32) -> f32 {
    let half = vec2<f32>(0.5, 0.5);
    let p = abs(uv - half) - half + vec2<f32>(radius);
    return length(max(p, vec2<f32>(0.0))) - radius;
}

// Fragment shader: samples from low-res or high-res texture array
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Rounded corners: 0.0625 in UV space = 8px on a 128px tile
    let corner_radius = 0.0625;
    let d = roundedRectSDF(in.uv, corner_radius);
    if (d > 0.0) {
        discard;
    }

    // Determine which texture tier to sample from
    // texture_index < 0: no texture (solid color)
    // texture_index 0 to HIRES_OFFSET-1: low-res array
    // texture_index HIRES_OFFSET+: high-res array
    let is_hires = in.texture_index >= f32(HIRES_OFFSET);
    let hires_idx = clamp(i32(in.texture_index - f32(HIRES_OFFSET)), 0, MAX_HIRES_LAYERS);
    let lores_idx = clamp(i32(in.texture_index), 0, MAX_LOWRES_LAYERS);

    let hires_sample = textureSample(hires_texture, texture_sampler, in.uv, hires_idx);
    let lores_sample = textureSample(tile_texture, texture_sampler, in.uv, lores_idx);

    // Select high-res or low-res sample
    let tex_color = select(lores_sample, hires_sample, is_hires);

    // Use texture if texture_index >= 0, otherwise use animated placeholder
    if (in.texture_index < 0.0) {
      // Animated placeholder: fade alpha with smooth sine wave
      let cycle_duration = 2.0;  // 2 seconds per fade cycle
      let min_alpha = 0.4;
      let max_alpha = 0.8;
      let phase = (time % cycle_duration) / cycle_duration;  // 0.0 to 1.0
      let sine_wave = sin(phase * 2.0 * 3.14159);  // -1.0 to 1.0
      let alpha = min_alpha + (max_alpha - min_alpha) * (sine_wave * 0.5 + 0.5);  // 0.4 to 0.8

      return vec4<f32>(in.color.r, in.color.g, in.color.b, alpha);
    }

    // Texture is tinted by in.color (1,1,1 = no tint; >1 = brighten)
    let textured_result = tex_color * in.color;
    return textured_result;
}
