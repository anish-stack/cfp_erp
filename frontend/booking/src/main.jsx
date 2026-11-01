import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { captureUtm } from './store/patient';
import './index.css';
import { toast } from 'sonner';
import { registerSW } from './components/pwa/pwa';

captureUtm();
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);

registerSW((update) => toast('A new version is available', { duration: Infinity, action: { label: 'Update', onClick: update } }));
