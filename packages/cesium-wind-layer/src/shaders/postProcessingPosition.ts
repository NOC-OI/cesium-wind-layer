export const postProcessingPositionFragmentShader = /*glsl*/`#version 300 es
precision highp float;

uniform sampler2D nextParticlesPosition;
uniform sampler2D particlesSpeed; // (u, v, norm)

// range (min, max)
uniform vec2 lonRange;
uniform vec2 latRange;

// range (min, max)
uniform vec2 dataLonRange;
uniform vec2 dataLatRange;

uniform float randomCoefficient;
uniform float dropRate;
uniform float dropRateBump;

// 添加新的 uniform 变量
uniform bool useViewerBounds;
uniform float depth;
uniform float elevationStep;

in vec2 v_textureCoordinates;

// pseudo-random generator
const vec3 randomConstants = vec3(12.9898, 78.233, 4375.85453);
const vec2 normalRange = vec2(0.0, 1.0);
float rand(vec2 seed, vec2 range) {
    vec2 randomSeed = randomCoefficient * seed;
    float temp = dot(randomConstants.xy, randomSeed);
    temp = fract(sin(temp) * (randomConstants.z + temp));
    return temp * (range.y - range.x) + range.x;
}

vec3 generateRandomParticle(vec2 seed, float particleOrdinal) {
    vec2 range;
    float randomLon, randomLat;
    
    if (useViewerBounds) {
        // 在当前视域范围内生成粒子
        randomLon = rand(seed, lonRange);
        randomLat = rand(-seed, latRange);
    } else {
        // 在数据范围内生成粒子
        randomLon = rand(seed, dataLonRange);
        randomLat = rand(-seed, dataLatRange);
    }

    float availableLevels = ceil(depth / elevationStep);
    // Assign levels deterministically so every enabled level is populated even
    // with small particle textures. Longitude/latitude remain randomized.
    float selectedLevel = min(depth - 1.0, mod(particleOrdinal, availableLevels) * elevationStep);
    float normalizedLevel = depth <= 1.0 ? 0.0 : selectedLevel / (depth - 1.0);
    return vec3(randomLon, randomLat, normalizedLevel);
}

bool particleOutbound(vec3 particle) {
    return particle.y < dataLatRange.x || particle.y > dataLatRange.y || particle.x < dataLonRange.x || particle.x > dataLonRange.y;
}

out vec4 fragColor;

void main() {
    vec4 nextParticleState = texture(nextParticlesPosition, v_textureCoordinates);
    vec3 nextParticle = nextParticleState.rgb;
    vec4 nextSpeed = texture(particlesSpeed, v_textureCoordinates);
    float speedNorm = nextSpeed.a;
    float particleDropRate = dropRate + dropRateBump * speedNorm;

    vec2 seed1 = nextParticle.xy + v_textureCoordinates;
    vec2 seed2 = nextSpeed.rg + v_textureCoordinates;
    ivec2 particleCoordinate = ivec2(gl_FragCoord.xy);
    int particleTextureWidth = textureSize(nextParticlesPosition, 0).x;
    float particleOrdinal = float(particleCoordinate.y * particleTextureWidth + particleCoordinate.x);
    vec3 randomParticle = generateRandomParticle(seed1, particleOrdinal);
    float randomNumber = rand(seed2, normalRange);

    bool uninitialized = nextParticle.x == 0.0 && nextParticle.y == 0.0;
    if (uninitialized || randomNumber < particleDropRate || particleOutbound(nextParticle)) {
        fragColor = vec4(randomParticle, 1.0); // 1.0 means this is a random particle
    } else {
        fragColor = vec4(nextParticle, 0.0);
    }
}
`;
