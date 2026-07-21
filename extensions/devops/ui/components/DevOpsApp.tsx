import { DevOpsProvider, useDevOps } from '../store/devopsStore';
import { LoginPage } from './LoginPage';
import { AppLayout } from './layout/AppLayout';
import { PreAuthLayout } from './layout/PreAuthLayout';
import { BridgeRegistration } from './BridgeRegistration';

function AppShell() {
  const { state } = useDevOps();
  if (state.config) return <AppLayout />;
  return (
    <PreAuthLayout>
      <LoginPage />
    </PreAuthLayout>
  );
}

export default function DevOpsApp() {
  return (
    <DevOpsProvider>
      <BridgeRegistration />
      <AppShell />
    </DevOpsProvider>
  );
}
