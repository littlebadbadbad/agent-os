/**
 * backend/lib/local-proxy-server.js — Zero-conf local proxy server.
 *
 * Starts an HTTP proxy on 127.0.0.1:0 (OS-assigned free port) and forwards
 * all traffic to the upstream proxy (with credentials). Plugins connect to
 * the local address and never see upstream credentials.
 *
 * Architecture:
 *   Plugin → LocalProxy(:0) → UpstreamProxy(with auth) → Internet
 *
 * Supports both plain HTTP forwarding and HTTPS CONNECT tunneling through
 * the upstream proxy chain. No external dependencies — uses Node.js built-in
 * http/net modules.
 *
 * Lifecycle:
 *   const proxy = new LocalProxyServer();
 *   await proxy.start(upstreamConfig);   // bind port 0
 *   const addr = proxy.getAddress();     // { host, port }
 *   await proxy.restart(newConfig);      // close + restart
 *   proxy.stop();                        // close on shutdown
 */

/** @import { ProxyConfig } from '../../agent-type/plugin.ts' */

import http from 'http';
import net from 'net';

export class LocalProxyServer {
  /** @type {http.Server|null} */
  #server = null;

  /** @type {{ host: string; port: number }|null} */
  #address = null;

  /** @type {ProxyConfig|null} */
  #upstream = null;

  /** @returns {{ host: string; port: number }|null} */
  getAddress() {
    return this.#address;
  }

  /**
   * Start the local proxy server. Binds to 127.0.0.1:0 (OS-assigned port).
   * Resolves once the server is listening.
   * @param {ProxyConfig} upstream
   * @returns {Promise<{ host: string; port: number }>}
   */
  async start(upstream) {
    this.#upstream = upstream;
    this.#server = http.createServer((req, res) => this.#onHttp(req, res));
    this.#server.on('connect', (req, client, head) => this.#onConnect(req, client, head));

    return new Promise((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(0, '127.0.0.1', () => {
        const addr = /** @type {import('net').AddressInfo} */ (this.#server.address());
        this.#address = { host: '127.0.0.1', port: addr.port };
        this.#server.removeAllListeners('error');
        resolve(this.#address);
      });
    });
  }

  /**
   * Restart with a new upstream config. Closes the old server first,
   * then binds a new port-0 socket. Safe to call when not yet started.
   * @param {ProxyConfig} upstream
   * @returns {Promise<{ host: string; port: number }>}
   */
  async restart(upstream) {
    this.#upstream = upstream;
    if (this.#server) {
      this.#server.removeAllListeners('connect');
      await new Promise((resolve) => this.#server.close(resolve));
      this.#server = null;
      this.#address = null;
    }
    return this.start(upstream);
  }

  /** Stop the server. Safe to call multiple times. */
  stop() {
    if (!this.#server) return;
    this.#server.removeAllListeners('connect');
    this.#server.close();
    this.#server = null;
    this.#address = null;
    this.#upstream = null;
  }

  /** Build Proxy-Authorization header value, or null if no credentials. */
  #auth() {
    const { username, password } = this.#upstream;
    if (!username) return null;
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  /** Forward a plain HTTP request through the upstream proxy. */
  #onHttp(req, res) {
    const { host, port } = this.#upstream;

    const options = {
      hostname: host,
      port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers },
    };
    const auth = this.#auth();
    if (auth) options.headers['Proxy-Authorization'] = auth;

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => {
      res.statusCode = 502;
      res.end('Bad Gateway');
    });
    req.pipe(proxyReq);
  }

  /** Tunnel an HTTPS CONNECT request through the upstream proxy. */
  #onConnect(req, client, head) {
    const { host, port } = this.#upstream;
    const upstream = net.connect(port, host);

    upstream.on('error', () => client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
    client.on('error', () => upstream.destroy());

    let connectReq = `CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\n`;
    const auth = this.#auth();
    if (auth) connectReq += `Proxy-Authorization: ${auth}\r\n`;
    connectReq += '\r\n';

    upstream.write(connectReq);
    upstream.once('data', (data) => {
      const text = data.toString();
      if (text.startsWith('HTTP/1.1 200') || text.startsWith('HTTP/1.0 200')) {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const idx = text.indexOf('\r\n\r\n');
        if (idx !== -1) {
          const leftover = data.subarray(idx + 4);
          if (leftover.length > 0) client.write(leftover);
        }
        upstream.pipe(client);
        client.pipe(upstream);
      } else {
        client.write(data);
        client.end();
      }
    });
  }
}
