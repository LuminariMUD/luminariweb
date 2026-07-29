import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  getServiceWorkerCapability,
  getServiceWorkerRegistrationErrorMessage,
} from '../shared/pwa-support.ts';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

const SERVICE_WORKER_URL = '/service-worker.js';
const SERVICE_WORKER_REGISTRATION_TIMEOUT_MS = 5000;

void registerServiceWorker();

async function registerServiceWorker() {
  const capability = getServiceWorkerCapability({
    hasServiceWorker: 'serviceWorker' in navigator,
    isSecureContext: window.isSecureContext,
  });

  if (!capability.supported) {
    console.info(capability.message);
    return;
  }

  try {
    await withTimeout(
      navigator.serviceWorker.register(SERVICE_WORKER_URL),
      SERVICE_WORKER_REGISTRATION_TIMEOUT_MS,
      'Timed out while registering the service worker.',
    );
  } catch (error) {
    console.warn(getServiceWorkerRegistrationErrorMessage(error));
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(resolve, reject).finally(() => {
      window.clearTimeout(timeoutId);
    });
  });
}
