'use client';

import { useEffect, useState } from 'react';
import PersonTable from '@/components/PersonTable';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const DEFAULT_FIELDS = ['name', 'email', 'address', 'phone_number'];

export default function Home() {
  const [data, setData] = useState<Record<string, string>[]>([]);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetch(`${API_URL}/persons`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`API returned status ${res.status}`);
        }
        return res.json();
      })
      .then((json) => {
        setData(json);
      })
      .catch(() => {
        setError(
          'Could not load person data. Please check that the API is running.'
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <main>
      <h1>Person Data Viewer</h1>
      {loading && <p>Loading person records...</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && (
        <PersonTable fields={DEFAULT_FIELDS} data={data} />
      )}
    </main>
  );
}