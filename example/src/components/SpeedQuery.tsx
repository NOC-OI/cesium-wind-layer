import React, { useState, useEffect, useRef } from 'react';
import { Typography, Space, Button } from 'antd';
import styled from 'styled-components';
import { WindDataAtLonLat, WindLayer } from 'cube-cesium-wind-layer';
import { Viewer, ScreenSpaceEventHandler, ScreenSpaceEventType, Cartographic, Math as CesiumMath } from 'cesium';
import { GithubOutlined } from '@ant-design/icons';

const { Text } = Typography;

const Container = styled.div`
  background-color: rgba(255, 255, 255, 0.98);
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(8px);
  border-radius: 4px;
  margin: 4px;
  padding: 4px 8px;
  z-index: 1000;
  transition: all 0.3s ease;
  min-height: 32px;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }

  @media (max-width: 768px) {
    margin: 4px;
    padding: 4px 6px;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
`;

const QueryInfo = styled(Space)`
  flex: 1;
  font-size: 13px;
  
  @media (max-width: 768px) {
    width: 100%;
  }
`;

const DataItem = styled(Text)`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.02);
  transition: all 0.3s ease;
  font-size: 13px;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
  }
`;

const GithubLink = styled.a`
  display: flex;
  align-items: center;
  gap: 4px;
  color: #24292e;
  text-decoration: none;
  padding: 2px 6px;
  border-radius: 3px;
  transition: all 0.3s ease;
  background: rgba(0, 0, 0, 0.02);
  white-space: nowrap;
  font-size: 13px;

  &:hover {
    background: rgba(0, 0, 0, 0.06);
    transform: translateY(-1px);
  }

  .stats {
    display: flex;
    align-items: center;
    gap: 4px;
    
    img {
      height: 16px;
      transition: transform 0.3s ease;
    }
  }

  &:hover .stats img {
    transform: scale(1.05);
  }

  @media (max-width: 768px) {
    width: 100%;
    justify-content: space-between;
    border-top: 1px solid rgba(0, 0, 0, 0.06);
    padding-top: 4px;
    background: transparent;
  }
`;

const DirectionArrow = styled.span<{ $angle: number }>`
  display: inline-block;
  transform: rotate(${props => props.$angle}deg);
  transition: transform 0.3s ease;
  font-family: "Segoe UI Symbol", "Noto Color Emoji", sans-serif;
`;

const DataContainer = styled(Space)`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
`;

const DataGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const ToggleButton = styled(Button)`
  font-size: 12px;
  padding: 2px 8px;
  height: 24px;
`;

interface WindData extends WindDataAtLonLat {
  direction?: number;
}

interface SpeedQueryProps {
  windLayer: WindLayer | null;
  viewer: Viewer | null;
}

export const SpeedQuery: React.FC<SpeedQueryProps> = ({ windLayer, viewer }) => {
  const [queryResult, setQueryResult] = useState<WindData | null>(null);
  const [location, setLocation] = useState<{ lon: number; lat: number } | null>(null);
  const [showInterpolated, setShowInterpolated] = useState(true);
  const lastLocationRef = useRef<{ lon: number; lat: number } | null>(null);

  const calculateWindDirection = (u: number, v: number): number => {
    // 使用 atan2 计算角度，注意参数顺序：atan2(y, x)
    // v 代表南北方向（y轴），u 代表东西方向（x轴）
    let angle = Math.atan2(v, u) * 180 / Math.PI;
    
    // 转换为地理坐标系的角度：
    // 1. atan2 得到的角度是数学坐标系（东为0°，逆时针为正）
    // 2. 转换为地理方向：逆时针旋转90度（或顺时针旋转270度）
    // 3. 加360°并取模确保在0-360范围内
    angle = (450 - angle) % 360;
    
    return angle;
  };

  const getCardinalDirection = (angle: number): string => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(angle / 45) % 8;
    return directions[index];
  };

  useEffect(() => {
    if (!windLayer) return;

    const handleDataChange = () => {
      if (lastLocationRef.current) {
        try {
          const result = windLayer.getDataAtLonLat(lastLocationRef.current.lon, lastLocationRef.current.lat);
          if (result) {
            const data = showInterpolated ? result.interpolated : result.original;
            const direction = calculateWindDirection(data.u, data.v);
            setQueryResult({ ...result, direction });
          } else {
            setQueryResult(null);
          }
        } catch (error) {
          console.error('Failed to get wind data:', error);
          setQueryResult(null);
        }
      }
    };

    // Add event listener for data changes
    windLayer.addEventListener('dataChange', handleDataChange);

    return () => {
      // Remove event listener when component unmounts or windLayer changes
      windLayer.removeEventListener('dataChange', handleDataChange);
    };
  }, [windLayer, showInterpolated]);

  useEffect(() => {
    if (!location || !windLayer) return;
    
    lastLocationRef.current = location;
    
    try {
      const result = windLayer.getDataAtLonLat(location.lon, location.lat);
      if (result) {
        const data = showInterpolated ? result.interpolated : result.original;
        const direction = calculateWindDirection(data.u, data.v);
        setQueryResult({ ...result, direction });
      } else {
        setQueryResult(null);
      }
    } catch (error) {
      console.error('Failed to get wind data:', error);
      setQueryResult(null);
    }
  }, [windLayer, location, showInterpolated]);

  useEffect(() => {
    if (!viewer || !windLayer) return;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    const handleClick = (movement: any) => {
      const cartesian = viewer.camera.pickEllipsoid(movement.position);
      if (cartesian) {
        const cartographic = Cartographic.fromCartesian(cartesian);
        const lon = CesiumMath.toDegrees(cartographic.longitude);
        const lat = CesiumMath.toDegrees(cartographic.latitude);
        setLocation({ lon, lat });
      }
    };

    handler.setInputAction(handleClick, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(handleClick, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    return () => {
      handler.destroy();
    };
  }, [viewer, windLayer]);

  const currentData = queryResult ? (showInterpolated ? queryResult.interpolated : queryResult.original) : null;

  return (
    <Container>
      <QueryInfo>
        {!location && (
          <Text style={{ fontSize: '13px' }}>
            <span style={{ opacity: 0.7 }}>👆</span> Click to query wind info
          </Text>
        )}
        
        {location && (
          <DataContainer>
            <DataGroup>
              <DataItem>
                📍 {location.lon.toFixed(1)}°, {location.lat.toFixed(1)}°
              </DataItem>
              
              {queryResult && currentData && (
                <ToggleButton 
                  type={showInterpolated ? "primary" : "default"}
                  onClick={() => setShowInterpolated(!showInterpolated)}
                >
                  {showInterpolated ? "Interpolated" : "Original"}
                </ToggleButton>
              )}
            </DataGroup>
            
            {!queryResult && (
              <Text type="secondary" style={{ fontSize: '13px' }}>No data</Text>
            )}
            
            {queryResult && currentData && (
              <DataGroup>
                <DataItem title="Wind Speed">
                  💨 Speed: {currentData.speed.toFixed(1)} m/s
                </DataItem>
                
                {currentData.speed > 0 && (
                  <DataItem title="Wind Direction">
                    <DirectionArrow $angle={(queryResult.direction || 0) - 90}>➤</DirectionArrow>
                    {' '}Direction: {queryResult.direction?.toFixed(0)}° ({getCardinalDirection(queryResult.direction || 0)})
                  </DataItem>
                )}
                
                <DataItem title="UV Vector">
                  UV Vector: {currentData.u.toFixed(3)}, {currentData.v.toFixed(3)}
                </DataItem>
              </DataGroup>
            )}
          </DataContainer>
        )}
      </QueryInfo>

      <GithubLink
        href="https://github.com/NOC-OI/cesium-wind-layer"
        target="_blank"
        rel="noopener noreferrer"
      >
        <GithubOutlined style={{ fontSize: '14px' }} />
        <span>cube-cesium-wind-layer</span>
        <div className="stats">
          <img 
            src="https://img.shields.io/github/stars/NOC-OI/cesium-wind-layer?style=flat&logo=github"
            alt="GitHub stars" 
          />
        </div>
      </GithubLink>
    </Container>
  );
};
