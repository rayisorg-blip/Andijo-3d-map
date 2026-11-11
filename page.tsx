'use client';
import dynamic from 'next/dynamic';
const CityApp = dynamic(() => import('@/components/CityApp'), { ssr: false });
export default function Page() { return <CityApp />; }
