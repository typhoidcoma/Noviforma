// Viewport uniform (screen dimensions)
struct Viewport {
    width: f32,
    height: f32,
}

@group(0) @binding(0)
var<uniform> viewport: Viewport;

// Vertex input: unit quad (0,0 to 1,1)
struct VertexInput {
    @location(0) position: vec2<f32>,
}

// Instance input: tile position, size, and color
struct InstanceInput {
    @location(1) pos_x: f32,
    @location(2) pos_y: f32,
    @location(3) size_w: f32,
    @location(4) size_h: f32,
    @location(5) color_r: f32,
    @location(6) color_g: f32,
    @location(7) color_b: f32,
    @location(8) color_a: f32,
}

// Vertex output / Fragment input
struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
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

    // Convert pixel coordinates to clip space [-1, 1]
    // X: 0 -> -1, viewport.width -> 1
    // Y: 0 -> 1, viewport.height -> -1 (flip Y axis)
    let clip_x = (pixel_x / viewport.width) * 2.0 - 1.0;
    let clip_y = 1.0 - (pixel_y / viewport.height) * 2.0;

    out.clip_position = vec4<f32>(clip_x, clip_y, 0.0, 1.0);
    out.color = vec4<f32>(instance.color_r, instance.color_g, instance.color_b, instance.color_a);

    return out;
}

// Fragment shader: outputs the color passed from vertex shader
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return in.color;
}
