import { Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ProductSearch } from '@/pages/billing/Composer';

/**
 * cols: subset of ['qty','rate','gstRate','batchNo','expiry','purchasePrice','mrp','sellPrice']
 */
export function LineEditor({ lines, setLines, cols, types = 'medicine,consumable,product', defaults = {} }) {
  const add = (p) => setLines((ls) => (ls.some((l) => l.product === p._id && !cols.includes('batchNo')) ? ls : [...ls, { product: p._id, name: p.name, qty: 1, rate: p.purchasePrice || 0, gstRate: p.gstRate, purchasePrice: p.purchasePrice || 0, mrp: p.mrp, sellPrice: p.sellPrice, batchNo: '', expiry: '', ...defaults }]));
  const upd = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const LABEL = { qty: 'Qty', rate: 'Rate', gstRate: 'GST %', batchNo: 'Batch', expiry: 'Expiry', purchasePrice: 'Cost', mrp: 'MRP', sellPrice: 'Sell' };
  return (
    <div className="space-y-2">
      <ProductSearch onPick={add} types={types} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-2">Product</th>{cols.map((c) => <th key={c} className="px-1">{LABEL[c]}</th>)}<th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1.5 pr-2 font-medium">{l.name}{l.ordered != null && <span className="block text-xs text-muted-foreground">ordered {l.ordered}, received {l.received}</span>}</td>
                {cols.map((c) => (
                  <td key={c} className="px-1">
                    <Input className="h-8 min-w-[80px]" type={c === 'expiry' ? 'date' : c === 'batchNo' ? 'text' : 'number'} value={l[c] ?? ''} onChange={(e) => upd(i, c, e.target.value)} />
                  </td>
                ))}
                <td><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lines.length && <p className="py-4 text-center text-sm text-muted-foreground">Search to add products.</p>}
      </div>
    </div>
  );
}

export const toNum = (v) => (v === '' || v == null ? undefined : Number(v));
