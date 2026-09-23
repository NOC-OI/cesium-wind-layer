export const calculateSpeedShader = /*glsl*/`#version 300 es

// the size of UV textures: width = lon, height = lat
uniform sampler2D U; // eastward wind
uniform sampler2D V; // northward wind
uniform sampler2D currentParticlesPosition; // (lon, lat, normalized elevation, reset flag)

uniform vec2 uRange; // (min, max)
uniform vec2 vRange; // (min, max)
uniform vec2 speedRange; // (min, max)
uniform vec3 dimension; // (lon, lat, elevation)
uniform vec2 atlasDimension;
uniform vec2 atlasGrid;
uniform vec2 minimum; // minimum of each dimension
uniform vec2 maximum; // maximum of each dimension

uniform float speedScaleFactor;
uniform float frameRateAdjustment;

in vec2 v_textureCoordinates;

vec2 getInterval(vec2 maximum, vec2 minimum, vec2 gridDimension) {
    return (maximum - minimum) / (gridDimension - 1.0);
}

vec2 mapPositionToAtlasUV(vec3 position) {
    vec2 lonLat = position.xy;
    // ensure the range of longitude and latitude
    lonLat.x = clamp(lonLat.x, minimum.x, maximum.x);
    lonLat.y = clamp(lonLat.y,  minimum.y, maximum.y);

    vec2 interval = getInterval(maximum, minimum, dimension.xy);
    
    vec2 index2D = vec2(0.0);
    index2D.x = (lonLat.x - minimum.x) / interval.x;
    index2D.y = (lonLat.y - minimum.y) / interval.y;

    float level = dimension.z <= 1.0 ? 0.0 : floor(clamp(position.z, 0.0, 1.0) * (dimension.z - 1.0) + 0.5);
    float atlasColumn = mod(level, atlasGrid.x);
    float atlasRow = floor(level / atlasGrid.x);
    vec2 atlasPixel = vec2(
      atlasColumn * dimension.x + index2D.x + 0.5,
      atlasRow * dimension.y + index2D.y + 0.5
    );
    return atlasPixel / atlasDimension;
}

vec2 getWindComponents(vec3 position) {
    vec2 atlasUV = mapPositionToAtlasUV(position);
    float u = texture(U, atlasUV).r;
    float v = texture(V, atlasUV).r;
    return vec2(u, v);
}

vec2 bilinearInterpolation(vec3 position) {
    float lon = position.x;
    float lat = position.y;

    vec2 interval = getInterval(maximum, minimum, dimension.xy);

    // Calculate grid cell coordinates
    float lon0 = floor((lon - minimum.x) / interval.x) * interval.x + minimum.x;
    float lon1 = lon0 + interval.x;
    float lat0 = floor((lat - minimum.y) / interval.y) * interval.y + minimum.y;
    float lat1 = lat0 + interval.y;

    // Get wind vectors at four corners
    vec2 v00 = getWindComponents(vec3(lon0, lat0, position.z));
    vec2 v10 = getWindComponents(vec3(lon1, lat0, position.z));
    vec2 v01 = getWindComponents(vec3(lon0, lat1, position.z));
    vec2 v11 = getWindComponents(vec3(lon1, lat1, position.z));

    // Check if all wind vectors are zero
    if (length(v00) == 0.0 && length(v10) == 0.0 && length(v01) == 0.0 && length(v11) == 0.0) {
        return vec2(0.0, 0.0);
    }

    // Calculate interpolation weights
    float s = (lon - lon0) / interval.x;
    float t = (lat - lat0) / interval.y;

    // Perform bilinear interpolation on vector components
    vec2 v0 = mix(v00, v10, s);
    vec2 v1 = mix(v01, v11, s);
    return mix(v0, v1, t);
}

vec2 lengthOfLonLat(vec2 lonLat) {
    // unit conversion: meters -> longitude latitude degrees
    // see https://en.wikipedia.org/wiki/Geographic_coordinate_system#Length_of_a_degree for detail

    // Calculate the length of a degree of latitude and longitude in meters
    float latitude = radians(lonLat.y);

    float term1 = 111132.92;
    float term2 = 559.82 * cos(2.0 * latitude);
    float term3 = 1.175 * cos(4.0 * latitude);
    float term4 = 0.0023 * cos(6.0 * latitude);
    float latLength = term1 - term2 + term3 - term4;

    float term5 = 111412.84 * cos(latitude);
    float term6 = 93.5 * cos(3.0 * latitude);
    float term7 = 0.118 * cos(5.0 * latitude);
    float longLength = term5 - term6 + term7;

    return vec2(longLength, latLength);
}

vec2 convertSpeedUnitToLonLat(vec2 lonLat, vec2 speed) {
    vec2 lonLatLength = lengthOfLonLat(lonLat);
    float u = speed.x / lonLatLength.x;
    float v = speed.y / lonLatLength.y;
    vec2 windVectorInLonLat = vec2(u, v);

    return windVectorInLonLat;
}

vec2 calculateSpeedByRungeKutta2(vec3 position) {
    // see https://en.wikipedia.org/wiki/Runge%E2%80%93Kutta_methods#Second-order_methods_with_two_stages for detail
    const float h = 0.5;

    vec2 y_n = position.xy;
    vec2 f_n = bilinearInterpolation(position);
    vec2 midpoint = y_n + 0.5 * h * convertSpeedUnitToLonLat(y_n, f_n) * speedScaleFactor;
    vec2 speed = h * bilinearInterpolation(vec3(midpoint, position.z)) * speedScaleFactor;

    return speed;
}


vec2 calculateWindNorm(vec2 speed) {
    float speedLength = length(speed.xy);
    if(speedLength == 0.0){
      return vec2(0.0);
    }

    // Clamp speedLength to range
    float clampedSpeed = clamp(speedLength, speedRange.x, speedRange.y);
    float normalizedSpeed = (clampedSpeed - speedRange.x) / (speedRange.y - speedRange.x);
    return vec2(speedLength, normalizedSpeed);
}

out vec4 fragColor;

void main() {
    // texture coordinate must be normalized
    vec3 position = texture(currentParticlesPosition, v_textureCoordinates).rgb;
    vec2 speedOrigin = bilinearInterpolation(position);
    vec2 speed = calculateSpeedByRungeKutta2(position) * frameRateAdjustment;
    vec2 speedInLonLat = convertSpeedUnitToLonLat(position.xy, speed);

    fragColor = vec4(speedInLonLat, calculateWindNorm(speedOrigin));
}
`;
