import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { Composer } from './Composer';

export default function Pos() {
  const nav = useNavigate();
  const [k, setK] = useState(0);
  return (
    <div>
      <PageHeader title="Pharmacy POS" description="Scan or search, then checkout. Stock is deducted FEFO (first-expiry-first-out)." />
      <Composer key={k} source="pos" onDone={(inv) => { setK(k + 1); nav(`/billing/${inv._id}`); }} />
    </div>
  );
}
