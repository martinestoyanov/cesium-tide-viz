import { useState, useEffect } from 'react';
import { type TideRecord } from '@/types/tide';

export function useTideData(stationId: string): TideRecord[] | null {
  const [data, setData] = useState<TideRecord[] | null>(null);

  useEffect(() => {
    fetch(`./data/tidal_data_station_${stationId}.csv`)
      .then((res) => res.text())
      .then((text) => {
        const lines = text.trim().split('\n');
        const headers = lines[0].split(',').map((h) => h.trim());
        const records: TideRecord[] = lines.slice(1).map((line) => {
          const values = line.split(',').map((v) => v.trim());
          const row: Record<string, string> = {};
          headers.forEach((h, i) => {
            row[h] = values[i];
          });
          return {
            Date: row['Date'],
            Time: row['Time'],
            Height_cm: parseFloat(row['Height_cm']),
            Tide_Type: row['Tide_Type'] as 'High' | 'Low',
          };
        });
        setData(records);
      })
      .catch((err) => {
        console.error(`Failed to load tide data for station ${stationId}:`, err);
      });
  }, [stationId]);

  return data;
}
