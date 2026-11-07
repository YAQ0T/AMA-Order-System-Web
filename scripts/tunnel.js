#!/usr/bin/env node
/**
 * The online link (Cloudflare Tunnel) on this computer: connect, start, stop,
 * test, show the log, remove. Behind "Cloudflare AMA (Windows).cmd" and
 * "Cloudflare AMA (Mac).command". The steps in Cloudflare's own dashboard are
 * in ONLINE-ACCESS.md.
 *
 *   node scripts/tunnel.js           menu
 *   node scripts/tunnel.js test      check everything, print what to fix (exit 1 if something is wrong)
 *   node scripts/tunnel.js connect|start|stop|status|log|remove
 *
 * Windows asks for administrator permission (a UAC prompt) to connect, start,
 * stop or remove, because the tunnel runs as a Windows service. A Mac asks for
 * your password (sudo) for the same reason.
 *
 * The tunnel token is a secret: it is only ever handed to cloudflared, never
 * printed or saved by this script.
 *
 * Node built-ins only.
 */
const { spawnSync } = require('child_process');
const dns = require('dns').promises;
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'server', '.env');
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

const WIN_SERVICE = 'cloudflared';
const MAC_LABEL = 'com.cloudflare.cloudflared';
const MAC_PLIST = `/Library/LaunchDaemons/${MAC_LABEL}.plist`;
const MAC_LOGS = [`/Library/Logs/${MAC_LABEL}.err.log`, `/Library/Logs/${MAC_LABEL}.out.log`];
const DOWNLOAD_PAGE = 'https://github.com/cloudflare/cloudflared/releases/latest';

const say = (line = '') => console.log(line);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ask a question; end of input counts as an empty answer. */
function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        let answered = false;
        rl.on('close', () => {
            if (!answered) resolve('');
        });
        rl.question(question, (a) => {
            answered = true;
            rl.close();
            resolve(a.trim());
        });
    });
}

// ---------------------------------------------------------------------------
// server/.env

function readEnv() {
    const values = {};
    if (!fs.existsSync(ENV_FILE)) return values;
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (m) values[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    return values;
}

function writeEnvValue(key, value) {
    const text = fs.readFileSync(ENV_FILE, 'utf8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
    const next = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.replace(/\s*$/, '')}${eol}${key}=${value}${eol}`;
    fs.writeFileSync(ENV_FILE, next);
}

const appUrl = (env) => String(env.APP_URL || '').trim().replace(/\/$/, '');
const serverPort = (env) => Number(process.env.PORT || env.PORT) || 6001;

async function healthAt(base, timeoutMs = 4000) {
    try {
        const res = await fetch(`${base.replace(/\/$/, '')}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return null;
        const body = await res.json();
        return body && body.ok ? body : null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// cloudflared: where it is, and its service

function findCloudflared() {
    const candidates = [];
    if (IS_WIN) {
        // The installer's folder first: a Windows service should point at a
        // program in Program Files, not into one user's profile.
        for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
            if (base) candidates.push(path.join(base, 'cloudflared', 'cloudflared.exe'));
        }
        const where = spawnSync('where', ['cloudflared'], { encoding: 'utf8' });
        if (where.status === 0) candidates.push(...where.stdout.split(/\r?\n/).filter(Boolean));
        if (process.env.LOCALAPPDATA) {
            candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'));
        }
    } else {
        // Absolute paths matter: sudo does not search /opt/homebrew/bin.
        candidates.push('/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared');
        const which = spawnSync('which', ['cloudflared'], { encoding: 'utf8' });
        if (which.status === 0) candidates.push(which.stdout.trim());
    }
    return candidates.find((c) => c && fs.existsSync(c)) || null;
}

function versionOf(bin) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    return ((r.stdout || r.stderr || '').split(/\r?\n/)[0] || '').replace(/^cloudflared version\s*/i, '').trim() || 'unknown version';
}

/** 'missing' (not connected here), 'running' or 'stopped'. */
function serviceState() {
    if (IS_WIN) {
        const r = spawnSync('sc', ['query', WIN_SERVICE], { encoding: 'utf8' });
        const out = r.stdout || '';
        if (/1060/.test(out) || (r.status !== 0 && !/STATE/.test(out))) return 'missing';
        if (/STATE\s*:\s*4\s+RUNNING/i.test(out)) return 'running';
        return 'stopped';
    }
    if (IS_MAC) {
        if (!fs.existsSync(MAC_PLIST)) return 'missing';
        return spawnSync('pgrep', ['-x', 'cloudflared'], { stdio: 'ignore' }).status === 0 ? 'running' : 'stopped';
    }
    return 'missing';
}

const isWinAdmin = () => IS_WIN && spawnSync('net', ['session'], { stdio: 'ignore' }).status === 0;
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Windows: run a program as administrator. Windows shows its permission
 * prompt (UAC) unless this window already runs as administrator.
 */
function runAsAdmin(file, args) {
    if (isWinAdmin()) return spawnSync(file, args, { stdio: 'inherit' }).status;
    const command = [
        `$p = Start-Process -FilePath ${psQuote(file)} -ArgumentList @(${args.map(psQuote).join(',')})`,
        '-Verb RunAs -Wait -PassThru -WindowStyle Hidden;',
        'exit $p.ExitCode',
    ].join(' ');
    return spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'inherit' }).status;
}

/** Mac: run with sudo (asks for this Mac's password in the window). */
const runSudo = (args) => spawnSync('sudo', args, { stdio: 'inherit' }).status;

async function waitForState(wanted, seconds = 15) {
    for (let i = 0; i < seconds * 2; i++) {
        if (serviceState() === wanted) return true;
        await sleep(500);
    }
    return serviceState() === wanted;
}

// ---------------------------------------------------------------------------
// Actions

async function install() {
    if (findCloudflared()) return true;
    say('  cloudflared is not installed on this computer. Installing it...');
    if (IS_WIN && spawnSync('where', ['winget'], { stdio: 'ignore' }).status === 0) {
        // winget may ask you to accept its terms - answer it in this window.
        spawnSync('winget', ['install', '--id', 'Cloudflare.cloudflared', '-e'], { stdio: 'inherit' });
    } else if (IS_MAC && spawnSync('which', ['brew'], { stdio: 'ignore' }).status === 0) {
        spawnSync('brew', ['install', 'cloudflared'], { stdio: 'inherit' });
    }
    if (findCloudflared()) {
        say(`  OK  cloudflared installed (${versionOf(findCloudflared())}).`);
        return true;
    }
    say();
    say('  Could not install cloudflared automatically.');
    say(IS_MAC
        ? '  Install Homebrew from https://brew.sh and choose this option again,'
        : '  Download the Windows 64-bit installer (cloudflared-windows-amd64.msi) from:');
    say(IS_MAC ? `  or download cloudflared for macOS from: ${DOWNLOAD_PAGE}` : `  ${DOWNLOAD_PAGE}`);
    say('  then choose this option again.');
    return false;
}

/** The token in a pasted line - the whole install command or just the token. */
function extractToken(text) {
    const found = String(text || '').match(/eyJ[A-Za-z0-9+/=_-]{40,}/g) || [];
    return found.sort((a, b) => b.length - a.length)[0] || null;
}

async function connect() {
    say('\n  Connect this computer to your Cloudflare tunnel\n');
    if (serviceState() !== 'missing') {
        say('  This computer is already connected. To connect it to a different tunnel,');
        say('  choose "Remove" first, then connect again.');
        return;
    }
    if (!(await install())) return;
    const bin = findCloudflared();

    say();
    say('  In Cloudflare: Networking > Tunnels > your tunnel (or Create a tunnel),');
    say(`  choose ${IS_MAC ? 'macOS' : 'Windows'}, and copy the install command it shows.`);
    say('  Paste it here (the whole command or just the long token). It is a secret:');
    say('  do not send it to anyone.');
    const token = extractToken(await ask('\n  Paste: '));
    if (!token) {
        say('\n  That does not contain a tunnel token (it starts with "eyJ"). Nothing was changed.');
        return;
    }

    say('\n  Installing the tunnel as a service (it then starts with the computer)...');
    say(IS_MAC ? '  Enter this Mac\'s password if asked.' : '  Windows will ask for permission - choose Yes.');
    const code = IS_WIN ? runAsAdmin(bin, ['service', 'install', token]) : runSudo([bin, 'service', 'install', token]);
    if (code !== 0 || !(await waitForState('running', 20))) {
        say(`\n  The tunnel did not start (code ${code}). Try "Test" for details, or "Show the log".`);
        return;
    }
    say('  OK  The tunnel is connected and running.');

    const env = readEnv();
    if (!appUrl(env) && fs.existsSync(ENV_FILE)) {
        const link = (await ask('\n  Your link, e.g. https://amaorders.work (Enter to skip): ')).replace(/\/$/, '');
        if (/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(link)) {
            writeEnvValue('APP_URL', link);
            say(`  OK  APP_URL=${link} saved in server/.env.`);
            const again = (await ask('  Restart the system now so it uses the link? (y/n): ')).toLowerCase();
            if (again === 'y' || again === 'yes') {
                spawnSync(process.execPath, [path.join(__dirname, 'launch.js'), 'stop'], { stdio: 'inherit', env: { ...process.env, AMA_NO_BROWSER: '1' } });
                spawnSync(process.execPath, [path.join(__dirname, 'launch.js'), 'start'], { stdio: 'inherit', env: { ...process.env, AMA_NO_BROWSER: '1' } });
            }
        } else if (link) {
            say('  That is not an https link - skipped. You can set APP_URL in server/.env later.');
        }
    }
    await test();
}

async function start() {
    const state = serviceState();
    if (state === 'missing') return say('\n  This computer is not connected yet - choose "Connect" first.');
    if (state === 'running') return say('\n  OK  The tunnel is already running.');
    say(IS_MAC ? '\n  Starting the tunnel (enter this Mac\'s password if asked)...' : '\n  Starting the tunnel (Windows will ask for permission)...');
    if (IS_WIN) runAsAdmin('sc.exe', ['start', WIN_SERVICE]);
    else if (runSudo(['launchctl', 'bootstrap', 'system', MAC_PLIST]) !== 0) runSudo(['launchctl', 'kickstart', '-k', `system/${MAC_LABEL}`]);
    say((await waitForState('running')) ? '  OK  The tunnel is running. The link works again.' : '  The tunnel did not start - see "Show the log".');
}

async function stop() {
    const state = serviceState();
    if (state === 'missing') return say('\n  This computer is not connected - nothing to stop.');
    if (state === 'stopped') return say('\n  OK  The tunnel is already stopped.');
    say(IS_MAC ? '\n  Stopping the tunnel (enter this Mac\'s password if asked)...' : '\n  Stopping the tunnel (Windows will ask for permission)...');
    if (IS_WIN) runAsAdmin('sc.exe', ['stop', WIN_SERVICE]);
    else runSudo(['launchctl', 'bootout', `system/${MAC_LABEL}`]);
    if (await waitForState('stopped')) {
        say('  OK  Stopped. The online link no longer works; the system still works inside the company.');
        say('      (The tunnel starts again with the computer - use "Remove" to take it off for good.)');
    } else {
        say('  The tunnel is still running - see "Show the log".');
    }
}

async function remove() {
    if (serviceState() === 'missing') return say('\n  This computer is not connected - nothing to remove.');
    const sure = (await ask('\n  Remove the tunnel from this computer? The online link stops until you connect again. (y/n): ')).toLowerCase();
    if (sure !== 'y' && sure !== 'yes') return say('  Nothing changed.');
    const bin = findCloudflared();
    if (!bin) return say('  cloudflared itself is missing - remove the service from Windows Services / launchd by hand.');
    if (IS_WIN) runAsAdmin(bin, ['service', 'uninstall']);
    else runSudo([bin, 'service', 'uninstall']);
    await sleep(2000);
    say(serviceState() === 'missing'
        ? '  OK  Removed. Connect again from this menu (or on the other computer) when needed.'
        : '  It is still installed - try again, or see "Show the log".');
}

function showLog() {
    say('\n  Tunnel log (most recent last)\n');
    if (IS_MAC) {
        let shown = false;
        for (const file of MAC_LOGS) {
            if (!fs.existsSync(file)) continue;
            const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(-25);
            say(`  --- ${file} ---`);
            for (const line of lines) say(`  ${line}`);
            shown = true;
        }
        if (!shown) say('  No log files yet (the tunnel has not run on this Mac).');
        return;
    }
    if (IS_WIN) {
        const ps = [
            "$e = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'cloudflared' } -MaxEvents 25 -ErrorAction SilentlyContinue;",
            "if ($e) { $e | Sort-Object TimeCreated | ForEach-Object { '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f $_.TimeCreated, ($_.Message -split [Environment]::NewLine)[0] } }",
            "else { 'No tunnel entries in the Windows event log yet.' }",
        ].join(' ');
        spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' });
        say('\n  (Full details: Event Viewer > Windows Logs > Application, source "cloudflared".)');
    }
}

function status() {
    const bin = findCloudflared();
    const state = serviceState();
    const env = readEnv();
    say(`  cloudflared:  ${bin ? `installed (${versionOf(bin)})` : 'not installed'}`);
    say(`  Tunnel here:  ${state === 'missing' ? 'not connected' : state}`);
    say(`  Link:         ${appUrl(env) || '(APP_URL not set in server/.env)'}`);
}

// ---------------------------------------------------------------------------
// The full check

const apexOf = (host) => host.split('.').slice(-2).join('.');

async function test() {
    say('\n  Checking the online link\n');
    let problems = 0;
    let warnings = 0;
    const check = (result, label, fix) => {
        if (result === true) say(`  OK   ${label}`);
        else if (result === 'warn') {
            warnings += 1;
            say(`  !    ${label}`);
        } else {
            problems += 1;
            say(`  XX   ${label}`);
        }
        if (result !== true && fix) say(`       -> ${fix}`);
    };

    const bin = findCloudflared();
    check(Boolean(bin), bin ? `cloudflared is installed (${versionOf(bin)})` : 'cloudflared is not installed',
        'Menu option 1 installs it and connects the tunnel.');

    const state = serviceState();
    check(state !== 'missing', state === 'missing' ? 'The tunnel is not connected on this computer' : 'The tunnel is connected on this computer',
        'Menu option 1 - paste the install command from Cloudflare.');
    if (state !== 'missing') {
        check(state === 'running', state === 'running' ? 'The tunnel is running' : 'The tunnel is stopped', 'Menu option 2 starts it.');
    }

    const env = readEnv();
    const port = serverPort(env);
    const local = await healthAt(`http://127.0.0.1:${port}`, 2500);
    check(local?.db === 'ready',
        !local ? 'The system is not running on this computer'
            : local.db === 'ready' ? `The system is running on this computer (port ${port})`
                : `The system is running, but its database is not ready (${local.dbCode || local.db})`,
        local ? 'See .ama_runtime/server.log, or run Stop AMA then Start AMA.' : 'Start it with Start AMA.');

    const link = appUrl(env);
    check(/^https:\/\//.test(link), link ? `APP_URL is ${link}` : 'APP_URL is not set in server/.env',
        link ? 'APP_URL should be the https link, e.g. https://amaorders.work'
            : 'Put APP_URL=https://your-domain in server/.env, then Stop AMA and Start AMA.');

    if (link) {
        const host = new URL(link).hostname;
        const resolver = new dns.Resolver();
        resolver.setServers(['1.1.1.1', '8.8.8.8']);

        let ns = [];
        try {
            ns = await resolver.resolveNs(apexOf(host));
        } catch {
            /* reported below */
        }
        const onCloudflare = ns.some((n) => n.toLowerCase().endsWith('.ns.cloudflare.com'));
        check(onCloudflare || 'warn',
            ns.length ? `${apexOf(host)} is managed by: ${ns.join(', ')}` : `Could not look up who manages ${apexOf(host)}`,
            'The domain must use Cloudflare\'s two nameservers (set them at GoDaddy). Changes can take a few hours.');

        let addresses = [];
        try {
            addresses = await resolver.resolve4(host);
        } catch {
            /* reported below */
        }
        check(addresses.length > 0, addresses.length ? `${host} has an address` : `${host} has no address yet`,
            'In the tunnel, add a route (Published application) for this name -> HTTP localhost:6001.');

        const remote = await healthAt(link, 10000);
        if (remote && local && remote.instance === local.instance) {
            check(true, `${link} reaches the system on this computer`);
        } else if (remote && local) {
            check(false, `${link} answers from ANOTHER computer`,
                'Two copies = two databases. Stop AMA and the tunnel on one of the computers.');
        } else if (remote) {
            check('warn', `${link} works, but it reaches another computer (nothing runs here)`,
                'Fine if the system is meant to run on that other computer.');
        } else {
            // Cloudflare's own answer says which link in the chain is broken.
            let code = null;
            try {
                code = (await fetch(link, { signal: AbortSignal.timeout(10000) })).status;
            } catch {
                /* no answer at all */
            }
            const why = {
                530: 'Cloudflare says no computer has the tunnel connected (error 530).',
                502: 'The tunnel is connected, but nothing answers at localhost:6001 on that computer (error 502).',
                404: 'The tunnel has no route for this name (error 404).',
            }[code];
            check(false, `${link} does not reach the system${why ? ` - ${why}` : ''}`,
                code === 530 ? (state === 'missing' ? 'Connect this computer (option 1).' : 'Start the tunnel (option 2) - or start it on the computer that runs the system.')
                    : code === 502 ? 'Start the system with Start AMA on the computer with the tunnel.'
                        : code === 404 ? 'In Cloudflare, add the route: Published application, this name -> HTTP localhost:6001.'
                            : state !== 'running' ? 'Start the tunnel (option 2).'
                                : !local ? 'Start the system with Start AMA.'
                                    : 'In Cloudflare, check the route: Service HTTP, URL localhost:6001.');
        }

        try {
            const res = await fetch(`http://${host}/`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
            const to = res.headers.get('location') || '';
            check(([301, 302, 307, 308].includes(res.status) && to.startsWith('https://')) || 'warn',
                to.startsWith('https://') ? 'http:// is sent on to https://' : 'http:// is NOT sent on to https://',
                'Cloudflare: SSL/TLS > Edge Certificates > turn on "Always Use HTTPS".');
        } catch {
            check('warn', `Could not check whether http://${host} goes to https`);
        }
    }

    say();
    if (problems === 0) {
        say(warnings
            ? `  Working, with ${warnings} thing(s) worth fixing above.`
            : `  Everything works. Staff can open ${link} from anywhere.`);
    } else {
        say(`  ${problems} problem(s) - see the arrows above.`);
    }
    process.exitCode = problems ? 1 : 0;
}

// ---------------------------------------------------------------------------

async function menu() {
    for (;;) {
        say('\nAMA Order System - online link (Cloudflare)\n');
        status();
        say();
        say('  1) Connect this computer (installs cloudflared, asks for the token)');
        say('  2) Start the tunnel');
        say('  3) Stop the tunnel');
        say('  4) Test - is everything working?');
        say('  5) Show the tunnel log');
        say('  6) Remove the tunnel from this computer');
        say('  0) Exit');
        const choice = await ask('\n  Choose a number: ');
        if (choice === '' || choice === '0') return;
        const action = { 1: connect, 2: start, 3: stop, 4: test, 5: showLog, 6: remove }[choice];
        if (!action) {
            say('  Choose 0-6.');
            continue;
        }
        await action();
        await ask('\n  Press Enter to go back to the menu...');
    }
}

if (require.main === module) {
    if (!IS_WIN && !IS_MAC) {
        console.error('This script is for Windows and macOS.');
        process.exit(2);
    }
    const commands = { connect, start, stop, test, log: showLog, status, remove, menu };
    const command = commands[process.argv[2] || 'menu'];
    if (!command) {
        console.error('usage: node scripts/tunnel.js [menu|connect|start|stop|test|status|log|remove]');
        process.exit(2);
    }
    Promise.resolve(command()).catch((err) => {
        console.error('\n  Unexpected error:', err.message || err);
        process.exitCode = 1;
    });
}

module.exports = { extractToken };
