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

// Vertex input: unit quad (0,0 to 1,1)
struct VertexInput {
    @location(0) position: vec2<f32>,
}

// Instance input: viewer parameters
struct InstanceInput {
    @location(1) aspect_ratio: f32,
    @location(2) scale: f32,
    @location(3) offset_x: f32,
    @location(4) offset_y: f32,
    @location(5) texture_index: f32,
}

// Vertex output / Fragment input
struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) texture_index: f32,
}

@vertex
fn vs_main(
    vertex: VertexInput,
    instance: InstanceInput,
) -> VertexOutput {
    var out: VertexOutput;

    // Calculate viewport aspect ratio
    let viewport_aspect = viewport.width / viewport.height;

    // Calculate image display size with aspect ratio preservation
    var display_width: f32;
    var display_height: f32;

    if instance.aspect_ratio > viewport_aspect {
        // Image wider than viewport - fit to width
        display_width = viewport.width * instance.scale;
        display_height = (viewport.width / instance.aspect_ratio) * instance.scale;
    } else {
        // Image taller than viewport - fit to height
        display_width = (viewport.height * instance.aspect_ratio) * instance.scale;
        display_height = viewport.height * instance.scale;
    }

    // Center the image and apply pan offset
    let center_x = viewport.width * 0.5;
    let center_y = viewport.height * 0.5;

    let pixel_x = center_x - (display_width * 0.5) + (vertex.position.x * display_width) + instance.offset_x;
    let pixel_y = center_y - (display_height * 0.5) + (vertex.position.y * display_height) + instance.offset_y;

    // Convert to clip space
    let clip_x = (pixel_x / viewport.width) * 2.0 - 1.0;
    let clip_y = 1.0 - (pixel_y / viewport.height) * 2.0;

    out.clip_position = vec4<f32>(clip_x, clip_y, 0.0, 1.0);
    out.uv = vertex.position;
    out.texture_index = instance.texture_index;

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let array_index = i32(in.texture_index);
    return textureSample(tile_texture, texture_sampler, in.uv, array_index);
}
