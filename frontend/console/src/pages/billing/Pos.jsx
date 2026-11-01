import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ReceiptText } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Switch } from '@/components/ui/checkbox';
import { printThermal } from '@/lib/thermalReceipt';
import { Composer } from './Composer';

const KEY = 'cpf-pos-thermal';
const read = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };

export default function Pos() {
  const nav = useNavigate();
  const [k, setK] = useState(0);
  const [thermal, setThermal] = useState(read);
  const toggle = (v) => { setThermal(v); try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ } };
  return (
    <div>
      <PageHeader title="Pharmacy POS" description="Scan or search, then checkout. Stock is deducted FEFO (first-expiry-first-out)."
        actions={<label className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"><ReceiptText className="h-4 w-4" /> Thermal receipt after checkout <Switch checked={thermal} onCheckedChange={toggle} /></label>} />
      <Composer key={k} source="pos" onDone={(inv, o) => {
        if (thermal && !o?.collect) printThermal(inv._id).catch((e) => toast.error(`Receipt print failed: ${e?.response?.data?.message || e.message}`));
        setK(k + 1);
        nav(`/billing/${inv._id}${o?.collect ? '?collect=1' : ''}`);
      }} />
    </div>
  );
}
