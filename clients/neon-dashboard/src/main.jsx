import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ModuleHealthProvider } from './context/ModuleHealthContext.jsx';
import { ProviderAvailabilityProvider } from './context/ProviderAvailabilityContext.jsx';
import './styles/global.css';

const RootWrapper =
  import.meta.env.VITE_DISABLE_STRICT_MODE === 'true' ? React.Fragment : React.StrictMode;

ReactDOM.createRoot(document.getElementById('root')).render(
  <RootWrapper>
    <ProviderAvailabilityProvider>
      <ModuleHealthProvider>
        <App />
      </ModuleHealthProvider>
    </ProviderAvailabilityProvider>
  </RootWrapper>
);
