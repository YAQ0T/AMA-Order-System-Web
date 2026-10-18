const net = require('net');

/**
 * Answer only the local network - and this computer itself.
 *
 * Reaching the system from outside goes through a tunnel or VPN (Cloudflare
 * Tunnel, Tailscale), never through a port opened on the router. Those deliver
 * outside visitors from THIS computer (cloudflared connects to localhost) or
 * from the VPN's private range, so they pass. A direct connection from a public
 * address is refused: that only happens when a router port is forwarded to this
 * machine - as it was for the old system - which would put logins on the
 * internet unencrypted.
 *
 * The check uses the TCP connection's own address, never X-Forwarded-For,
 * which anyone can write.
 *
 * LAN_ONLY=off in server/.env switches it off.
 */

const V4_RANGES = [
    ['127.0.0.0', 8], // this computer (and where a tunnel delivers visitors)
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['169.254.0.0', 16], // link-local
    ['100.64.0.0', 10], // shared range used by VPNs such as Tailscale
];

const toInt = (ip) => ip.split('.').reduce((n, part) => ((n << 8) + Number(part)) >>> 0, 0);
const inRange = (ip, [base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((toInt(ip) & mask) >>> 0) === ((toInt(base) & mask) >>> 0);
};

function isLocalAddress(raw) {
    if (!raw) return false;
    let ip = String(raw).trim();
    const zone = ip.indexOf('%'); // fe80::1%en0
    if (zone >= 0) ip = ip.slice(0, zone);
    if (ip.toLowerCase().startsWith('::ffff:') && net.isIPv4(ip.slice(7))) ip = ip.slice(7); // IPv4-mapped

    if (net.isIPv4(ip)) return V4_RANGES.some((range) => inRange(ip, range));
    if (net.isIPv6(ip)) {
        const lower = ip.toLowerCase();
        if (lower === '::1') return true;
        const first = parseInt(lower.split(':')[0] || '0', 16);
        if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
        if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    }
    return false;
}

const REFUSAL = [
    'هذا النظام متاح من شبكة الشركة، أو من خلال رابطه الآمن (https) فقط.',
    'This system only answers on the company network, or through its secure (https) link.',
].join('\n');

function lanOnly({ enabled = (process.env.LAN_ONLY || '').trim().toLowerCase() !== 'off' } = {}) {
    const lastLogged = new Map(); // address -> time, so a scanner does not flood the log
    return (req, res, next) => {
        if (!enabled) return next();
        const address = req.socket?.remoteAddress;
        if (isLocalAddress(address)) return next();

        const now = Date.now();
        if (!lastLogged.has(address) || now - lastLogged.get(address) > 60 * 60 * 1000) {
            lastLogged.set(address, now);
            if (lastLogged.size > 1000) lastLogged.clear();
            console.warn(`[lan-only] refused a connection from ${address} (not the local network). A router port is probably forwarded to this computer - remove that forward; use the tunnel instead.`);
        }
        res.status(403).type('text/plain; charset=utf-8').send(REFUSAL);
    };
}

module.exports = { lanOnly, isLocalAddress };
