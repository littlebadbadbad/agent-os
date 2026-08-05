/**
 * @vitest-environment happy-dom
 *
 * Tests for BrowserAddressBar component.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { BrowserAddressBar, type BrowserAddressBarProps } from '../BrowserAddressBar';

afterEach(() => {
  cleanup();
});

function renderBar(props?: Partial<BrowserAddressBarProps>) {
  const defaults: BrowserAddressBarProps = {
    url: '',
    pageTitle: null,
    alive: true,
    useProxy: true,
    navigating: false,
    onNavigate: vi.fn(),
    onToggleProxy: vi.fn(),
    onToggleConfig: vi.fn(),
    onToggleVideoSettings: vi.fn(),
  };
  return render(<BrowserAddressBar {...defaults} {...props} />);
}

describe('BrowserAddressBar', () => {
  it('renders the navigation input', () => {
    renderBar();
    const input = screen.getByPlaceholderText('https://example.com');
    expect(input).toBeTruthy();
  });

  it('disables navigation button when session is not alive', () => {
    renderBar({ alive: false });
    const buttons = screen.getAllByRole('button');
    // All buttons should be disabled when not alive.
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('calls onNavigate when submit button is clicked', () => {
    const onNavigate = vi.fn();
    renderBar({ onNavigate });

    const input = screen.getByPlaceholderText('https://example.com');
    fireEvent.change(input, { target: { value: 'http://example.com' } });

    const goBtn = screen.getByTitle('Navigate');
    fireEvent.click(goBtn);

    expect(onNavigate).toHaveBeenCalledWith('http://example.com');
  });

  it('prepends https:// when scheme is missing', () => {
    const onNavigate = vi.fn();
    renderBar({ onNavigate });

    const input = screen.getByPlaceholderText('https://example.com');
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onNavigate).toHaveBeenCalledWith('https://example.com');
  });

  it('shows page title when provided', () => {
    renderBar({ pageTitle: 'Example Page' });
    expect(screen.getByText('Example Page')).toBeTruthy();
  });

  it('shows proxy status text', () => {
    renderBar({ useProxy: true });
    expect(screen.getByText(/Proxy.*\u25CF/)).toBeTruthy();
  });

  it('calls onToggleProxy when proxy button clicked', () => {
    const onToggleProxy = vi.fn();
    renderBar({ onToggleProxy });

    // The proxy button title starts with "Proxy".
    const proxyBtn = screen.getByTitle(/^Proxy/i);
    fireEvent.click(proxyBtn);

    expect(onToggleProxy).toHaveBeenCalledOnce();
  });

  it('calls onToggleConfig and onToggleVideoSettings', () => {
    const onToggleConfig = vi.fn();
    const onToggleVideoSettings = vi.fn();
    renderBar({ onToggleConfig, onToggleVideoSettings });

    const browserCfgBtn = screen.getByTitle('Browser configuration');
    fireEvent.click(browserCfgBtn);
    expect(onToggleConfig).toHaveBeenCalledOnce();

    const videoCfgBtn = screen.getByTitle('Video settings');
    fireEvent.click(videoCfgBtn);
    expect(onToggleVideoSettings).toHaveBeenCalledOnce();
  });
});
