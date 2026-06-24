'use client';

import { WEATHER } from '@/lib/weather';
import SnowEffect from './SnowEffect';
import RainEffect from './RainEffect';

export default function WeatherEffect() {
    if (WEATHER === 'rain') return <RainEffect />;
    if (WEATHER === 'snow') return <SnowEffect />;
    return null;
}
