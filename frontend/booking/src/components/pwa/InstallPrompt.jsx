import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { canInstall, onInstallChange, promptInstall, isStandalone, isIos } from './pwa';

const KEY = 'cpf-install-dismissed';
const dismissedRecently = () => { try { return Date.now() - Number(localStorage.getItem(KEY) || 0) < 7 * 864e5; } catch { return false; } };

/** Small "Install app" card: native prompt on Android/desktop Chrome, Add-to-Home-Screen hint on iPhone. */
export default function InstallPrompt({ title = 'Install the app', text = 'Open it from your home screen, faster and full-screen.' }) {
  const [, force] = useState(0);
  const [hidden, setHidden] = useState(() => isStandalone() || dismissedRecently());
  useEffect(() => onInstallChange(() => force((n) => n + 1)), []);
  const ios = isIos() && !isStandalone();
  if (hidden || (!canInstall() && !ios)) return null;
  const close = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } setHidden(true); };
  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border bg-card p-3 text-card-foreground shadow-xl sm:left-auto sm:right-4 sm:mx-0" role="dialog" aria-label={title}>
      <img src="/icons/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{ios ? <>Tap <Share className="inline h-3.5 w-3.5" /> Share, then “Add to Home Screen”.</> : text}</p>
      </div>
      {!ios && <button onClick={async () => { if (!(await promptInstall())) close(); }} className="flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"><Download className="h-4 w-4" /> Install</button>}
      <button onClick={close} aria-label="Dismiss" className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
    </div>
  );
}
