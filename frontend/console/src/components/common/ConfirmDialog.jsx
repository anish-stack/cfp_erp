import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Confirm with optional required reason */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmText = 'Confirm', destructive, reason, reasonLabel = 'Reason', onConfirm, loading }) {
  const [text, setText] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setText(''); onOpenChange(o); }}>
      <DialogContent title={title} description={description} size="sm">
        {reason && (
          <div className="space-y-1.5">
            <Label>{reasonLabel}</Label>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={destructive ? 'destructive' : 'default'} loading={loading} disabled={reason && text.trim().length < 3} onClick={() => onConfirm(text.trim())}>{confirmText}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
