import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Register shared service worker (covers push notifications for both office and field)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}

createRoot(document.getElementById('root')).render(<App />);
