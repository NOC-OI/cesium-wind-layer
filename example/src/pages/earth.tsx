import { useEffect, useRef, useState } from 'react';
import { Viewer, Rectangle, ArcGisMapServerImageryProvider, ImageryLayer, Ion, CesiumTerrainProvider } from 'cesium';
import { WindLayer, WindLayerOptions } from 'cube-cesium-wind-layer';
import { ControlPanel } from '@/components/ControlPanel';
import styled from 'styled-components';
import { colorSchemes } from '@/components/ColorTableInput';
import { SpeedQuery } from '@/components/SpeedQuery';
import { loadGlobalZarrCurrents } from '@/data/zarrCurrents';

Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJhY2IzNzQzNi1iOTVkLTRkZjItOWVkZi1iMGUyYTUxN2Q5YzYiLCJpZCI6NTUwODUsImlhdCI6MTcyNTQyMDE4NX0.yHbHpszFexPrxX6_55y0RgNrHjBQNu9eYkW9cXKUTPk';

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
`;

const CesiumContainer = styled.div`
  flex: 1;
  position: relative;
  overflow: hidden;
`;

const LoadingMessage = styled.div`
  position: absolute;
  top: 20px;
  right: 20px;
  padding: 8px 16px;
  color: #222;
  background-color: rgba(255, 255, 255, 0.9);
  border: 1px solid #ccc;
  border-radius: 4px;
  z-index: 1000;
`;

const currentOptions = {
  domain: { min: 0, max: 0.7 },
  speedFactor: 10,
  // Keep slow currents legible when the complete globe is visible.
  lineWidth: { min: 1.5, max: 10.0 },
  lineLength: { min: 100, max: 1000 },
  particleHeight: 100,
};

const defaultOptions: Partial<WindLayerOptions> = {
  ...WindLayer.defaultOptions,
  // Particle count is size squared: 200 gives 40,000 particles globally.
  particlesTextureSize: 400,
  colors: colorSchemes.find(item => item.value === 'cool')?.colors.reverse(),
  flipY: true,
  // Keep a persistent global particle distribution while zooming. When true,
  // recycled particles become concentrated in the last zoomed-in region.
  useViewerBounds: false,
  dynamic: true,
};

export function Earth() {
  const viewerRef = useRef<Viewer | null>(null);
  const windLayerRef = useRef<WindLayer | null>(null);
  const [, setIsWindLayerReady] = useState(false);
  const isFirstLoadRef = useRef(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [options, setOptions] = useState<WindLayerOptions>({
    ...defaultOptions,
    ...currentOptions
  } as WindLayerOptions);

  useEffect(() => {
    let isComponentMounted = true;

    // Create viewer only if it doesn't exist
    if (!viewerRef.current) {
      viewerRef.current = new Viewer('cesiumContainer', {
        baseLayer: ImageryLayer.fromProviderAsync(ArcGisMapServerImageryProvider.fromUrl(
          'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
          { enablePickFeatures: false }
        ), {}),
        baseLayerPicker: false,
        animation: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        selectionIndicator: true,
        timeline: false,
        navigationHelpButton: false,
        shouldAnimate: true,
        useBrowserRecommendedResolution: false,
        sceneModePicker: false,
      });
    }
    // Add terrain
    CesiumTerrainProvider.fromIonAssetId(1).then(terrainProvider => {
      if (viewerRef.current) {
        viewerRef.current.terrainProvider = terrainProvider;
      }
    });

    viewerRef.current.scene.globe.depthTestAgainstTerrain = true;
    // Optional: Add exaggeration to make terrain features more visible
    // viewerRef.current.scene.verticalExaggeration = 2;
    // viewerRef.current.sceneModePicker.viewModel.duration = 0;

    const initWindLayer = async () => {
      try {
        const windData = await loadGlobalZarrCurrents();

        if (!isComponentMounted || !viewerRef.current) return;

        const initialOptions = {
          ...defaultOptions,
          ...currentOptions
        };
        setOptions(initialOptions as WindLayerOptions);

        if (isFirstLoadRef.current && windData.bounds) {
          const rectangle = Rectangle.fromDegrees(
            windData.bounds.west,
            windData.bounds.south,
            windData.bounds.east,
            windData.bounds.north
          );
          viewerRef.current.camera.flyTo({
            destination: rectangle,
            duration: 0,
          });
          isFirstLoadRef.current = false;
        }

        const layer = new WindLayer(viewerRef.current, windData, initialOptions);

        // Add event listeners
        layer.addEventListener('dataChange', (data) => {
          console.log('Wind data updated:', data);
          // Handle data change
        });

        layer.addEventListener('optionsChange', (options) => {
          console.log('Options updated:', options);
          // Handle options change
        });

        windLayerRef.current = layer;
        setIsWindLayerReady(true);
      } catch (error) {
        console.error('Failed to initialize wind layer:', error);
        if (isComponentMounted) {
          setLoadError(error instanceof Error ? error.message : 'Unable to load currents');
        }
      }
    };

    // Initialize wind layer
    initWindLayer();

    return () => {
      isComponentMounted = false;
      isFirstLoadRef.current = true;

      if (windLayerRef.current) {
        windLayerRef.current.destroy();
        windLayerRef.current = null;
        setIsWindLayerReady(false);
      }

      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  const handleOptionsChange = (changedOptions: Partial<WindLayerOptions>) => {
    setOptions({
      ...options,
      ...changedOptions
    });
  };

  return (
    <PageContainer>
      <SpeedQuery windLayer={windLayerRef.current} viewer={viewerRef.current} />
      <CesiumContainer id="cesiumContainer">
        {!windLayerRef.current && (
          <LoadingMessage>{loadError ? `Failed to load currents: ${loadError}` : 'Loading global Zarr currents…'}</LoadingMessage>
        )}
        <ControlPanel
          windLayer={windLayerRef.current}
          initialOptions={options}
          onOptionsChange={handleOptionsChange}
        />
      </CesiumContainer>
    </PageContainer>
  );
}
