import { DevOpsProvider, useDevOps } from '../store/devopsStore';
import { LoginPage } from './LoginPage';
import { AppLayout } from './layout/AppLayout';
import { PreAuthLayout } from './layout/PreAuthLayout';
import '../../agent-UI/styles/global.scss';

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
      <AppShell />
    </DevOpsProvider>
  );
}
