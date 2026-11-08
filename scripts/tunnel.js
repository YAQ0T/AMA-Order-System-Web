#!/usr/bin/env node
/**
 * The online link (Cloudflare Tunnel) on this computer: connect, start, stop,
 * test, show the log, remove, update. Behind "Cloudflare AMA (Windows).cmd"
 * and "Cloudflare AMA (Mac).command". The step-by-step guide is CLOUDFLARE.md.
 *
 *   node scripts/tunnel.js           the menu
 *   node scripts/tunnel.js test      check everything, print what to fix (exit 1 if something is wrong)
 *   node scripts/tunnel.js connect|start|stop|status|log|remove|update
 *
 * How the tunnel runs: "cloudflared service install <token>" makes it a
 * service of the computer, so it starts by itself whenever the computer does.
 *   Windows: a service named "Cloudflared" (the same name in the event log).
 *            Changing it needs administrator permission: Windows shows its
 *            "allow this app to make changes?" prompt - choose Yes.
 *   Mac:     a launchd daemon, /Library/LaunchDaemons/com.cloudflare.cloudflared.plist,
 *            logging to /Library/Logs/com.cloudflare.cloudflared.err.log / .out.log.
 *            Changing it uses sudo: Terminal asks for this Mac's password.
 * (These names were checked against cloudflared's own source code:
 * cmd/cloudflared/windows_service.go and macos_service.go.)
 *
 * cloudflared itself is installed with winget / Homebrew when they are there,
 * otherwise straight from Cloudflare's GitHub releases (the .msi on Windows,
 * the .tgz into /usr/local/bin on a Mac).
 *
 * The tunnel token is a secret: it is only handed to cloudflared - never
 * printed or saved by this script, and hidden in any log line it shows.
 *
 * Node built-ins only. scripts/tunnel.test.js runs all of this on a pretend
 * Mac and a pretend Windows PC.
 */
const { spawnSync } = require('child_process');
const dns = require('dns').promises;
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'server', '.env');
const RUNTIME = path.join(ROOT, '.ama_runtime');
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
// scripts/tunnel.test.js sets this: state changes happen at once, so no waiting.
const TESTING = process.env.AMA_TUNNEL_TEST === '1';

const WIN_SERVICE = 'Cloudflared';
const WIN_PACKAGE = 'Cloudflare.cloudflared'; // winget
const MAC_LABEL = 'com.cloudflare.cloudflared';
const MAC_PLIST = `/Library/LaunchDaemons/${MAC_LABEL}.plist`;
const MAC_LOGS = [`/Library/Logs/${MAC_LABEL}.err.log`, `/Library/Logs/${MAC_LABEL}.out.log`];
const MAC_BIN = '/usr/local/bin/cloudflared'; // where a downloaded copy goes
const RELEASES = 'https://github.com/cloudflare/cloudflared/releases/latest/download';
const LATEST_API = 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest';
const DASHBOARD = 'Cloudflare (dash.cloudflare.com) > Networking > Tunnels';

const say = (line = '') => console.log(line);
const sleep = (ms) => new Promise((r) => setTimeout(r, TESTING ? 0 : ms));

/** Tunnel tokens never reach the screen, not even inside a log line. */
const hideTokens = (text) => String(text ?? '').replace(/eyJ[A-Za-z0-9+/=_-]{20,}/g, 'eyJ...(hidden)');

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
// cloudflared: where it is, its version, and its service

function findCloudflared() {
    const candidates = [];
    if (IS_WIN) {
        // The installer's folder first (%ProgramFiles(x86)%\cloudflared for the
        // .msi): a Windows service should run a program from Program Files.
        for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
            if (base) candidates.push(path.join(base, 'cloudflared', 'cloudflared.exe'));
        }
        const where = spawnSync('where', ['cloudflared'], { encoding: 'utf8' });
        if (where.status === 0) candidates.push(...String(where.stdout || '').split(/\r?\n/).filter(Boolean));
        if (process.env.LOCALAPPDATA) {
            candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'));
        }
    } else {
        // Absolute paths matter: sudo does not search /opt/homebrew/bin.
        candidates.push('/opt/homebrew/bin/cloudflared', MAC_BIN);
        const which = spawnSync('which', ['cloudflared'], { encoding: 'utf8' });
        if (which.status === 0) candidates.push(String(which.stdout || '').trim());
    }
    return candidates.find((c) => c && fs.existsSync(c)) || null;
}

function versionOf(bin) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    return ((r.stdout || r.stderr || '').split(/\r?\n/)[0] || '').replace(/^cloudflared version\s*/i, '').trim() || 'unknown version';
}

// cloudflared versions are dates: 2026.10.7 = October 2026.
const versionNumbers = (text) => (/(\d{4})\.(\d{1,2})\.(\d+)/.exec(String(text)) || []).slice(1).map(Number);
const isNewer = (a, b) => {
    for (let i = 0; i < 3; i++) {
        if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return false;
};

/** The newest cloudflared on GitHub, e.g. "2026.10.7" - or null without internet. */
async function latestVersion() {
    try {
        const res = await fetch(LATEST_API, {
            headers: { 'User-Agent': 'ama-order-system', Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return null;
        return String((await res.json()).tag_name || '').trim() || null;
    } catch {
        return null;
    }
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

/**
 * The program the installed service runs - only the path, the rest of that
 * line may hold the token. Null when it cannot be read.
 */
function serviceProgram() {
    if (IS_WIN) {
        const out = spawnSync('sc', ['qc', WIN_SERVICE], { encoding: 'utf8' }).stdout || '';
        const line = (/BINARY_PATH_NAME\s*:\s*(.+)/.exec(out) || [])[1] || '';
        const m = /^"([^"]+)"/.exec(line.trim()) || /^(.+?\.exe)\b/i.exec(line.trim());
        return m ? m[1] : null;
    }
    if (IS_MAC) {
        try {
            const xml = fs.readFileSync(MAC_PLIST, 'utf8');
            return (/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/.exec(xml) || [])[1] || null;
        } catch {
            return null;
        }
    }
    return null;
}

const isWinAdmin = () => IS_WIN && spawnSync('net', ['session'], { stdio: 'ignore' }).status === 0;
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * cmd.exe arguments that run `file args`, all output into `log`. /s: cmd
 * strips just the outer pair of quotes. Every argument is quoted except
 * switches like /i or /qn, which msiexec wants bare.
 */
const cmdArg = (a) => (/^\/[A-Za-z]+$/.test(a) ? a : `"${a}"`);
const adminCmdArgs = (file, args, log) => `/d /s /c ""${file}" ${args.map(cmdArg).join(' ')} > "${log}" 2>&1"`;

/**
 * PowerShell that runs cmd.exe as administrator, waits, and passes on its exit
 * code - or 1223 when the person chose No at Windows' question.
 */
const elevateScript = (cmdArgs, { elevate = true } = {}) => [
    'try {',
    `$p = Start-Process -FilePath 'cmd.exe' -ArgumentList ${psQuote(cmdArgs)} ${elevate ? '-Verb RunAs ' : ''}-Wait -PassThru -WindowStyle Hidden;`,
    'exit $p.ExitCode',
    '} catch {',
    '$w = $_.Exception; while ($w -and -not ($w -is [System.ComponentModel.Win32Exception])) { $w = $w.InnerException };',
    'if ($w -and $w.NativeErrorCode -eq 1223) { exit 1223 } else { Write-Host $_.Exception.Message; exit 1 }',
    '}',
].join(' ');

/**
 * Windows: run a program as administrator. Windows shows its permission
 * prompt (UAC) unless this window already runs as administrator. The
 * program's output goes to a file - an elevated window would close before it
 * could be read - and is shown, tokens hidden, when something went wrong.
 * Returns { code, cancelled, output }; cancelled = the person chose No.
 */
function runAsAdmin(file, args) {
    fs.mkdirSync(RUNTIME, { recursive: true });
    const log = path.join(RUNTIME, 'admin-command.log');
    fs.rmSync(log, { force: true });
    const cmdArgs = adminCmdArgs(file, args, log);
    const code = isWinAdmin()
        ? spawnSync('cmd.exe', [cmdArgs], { stdio: 'ignore', windowsVerbatimArguments: true }).status
        : spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', elevateScript(cmdArgs)], { encoding: 'utf8' }).status;
    let output = '';
    try {
        output = hideTokens(fs.readFileSync(log, 'utf8')).trim();
    } catch {
        /* nothing was written */
    }
    fs.rmSync(log, { force: true });
    if (output && code !== 0) {
        for (const line of output.split(/\r?\n/)) say(`     ${line}`);
    }
    return { code, cancelled: code === 1223, output };
}

/** Mac: run with sudo - Terminal asks for this Mac's password (typing shows nothing). */
const runSudo = (args, { quiet = false } = {}) =>
    spawnSync('sudo', args, { stdio: quiet ? ['inherit', 'ignore', 'ignore'] : 'inherit' }).status;

async function waitForState(wanted, seconds = 15) {
    if (TESTING) return serviceState() === wanted;
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
        if (serviceState() === wanted) return true;
        await sleep(500);
    }
    return serviceState() === wanted;
}

// ---------------------------------------------------------------------------
// Installing cloudflared

async function download(url, file) {
    const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new Error(`The download failed (HTTP ${res.status}): ${url}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** Apple silicon or Intel - asked of the Mac itself (right even if Node runs under Rosetta). */
const macArch = () =>
    String(spawnSync('sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8' }).stdout || '').trim() === '1' ? 'arm64' : 'amd64';

function findFile(dir, name) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const hit = findFile(full, name);
            if (hit) return hit;
        } else if (entry.name === name) {
            return full;
        }
    }
    return null;
}

async function install() {
    if (findCloudflared()) return true;
    say('  cloudflared is not installed on this computer. Installing it (this needs the internet)...');
    try {
        if (IS_WIN) await installWindows();
        else await installMac();
    } catch (err) {
        say(`  ${hideTokens(err.message)}`);
    }
    const bin = findCloudflared();
    if (bin) {
        say(`  OK  cloudflared installed (${versionOf(bin)}).`);
        return true;
    }
    say();
    say('  Could not install cloudflared automatically. Install it by hand, then choose 1 again:');
    say(IS_WIN
        ? `    download ${RELEASES}/cloudflared-windows-amd64.msi and double-click it (answer Yes).`
        : '    see CLOUDFLARE.md, "Installing cloudflared by hand".');
    return false;
}

async function installWindows() {
    if (spawnSync('where', ['winget'], { stdio: 'ignore' }).status === 0) {
        say('  Using winget. If Windows asks for permission, choose Yes.');
        spawnSync('winget', ['install', '--id', WIN_PACKAGE, '-e', '--accept-source-agreements', '--accept-package-agreements'], { stdio: 'inherit' });
        if (findCloudflared()) return;
        say('  winget did not install it - getting Cloudflare\'s installer directly instead...');
    }
    await installWindowsMsi();
}

/**
 * Download Cloudflare's .msi and run it as administrator - also how "Update"
 * works. With restartService, one permission prompt covers stopping the
 * tunnel, installing over it and starting it again.
 */
async function installWindowsMsi({ restartService = false } = {}) {
    fs.mkdirSync(RUNTIME, { recursive: true });
    const msi = path.join(RUNTIME, 'cloudflared-windows-amd64.msi');
    const script = path.join(RUNTIME, 'update-cloudflared.cmd');
    say('  Downloading cloudflared-windows-amd64.msi from Cloudflare...');
    try {
        await download(`${RELEASES}/cloudflared-windows-amd64.msi`, msi);
        say('  Installing it. Windows asks for permission - choose Yes.');
        let r;
        if (restartService) {
            fs.writeFileSync(script, [
                '@echo off',
                `sc stop ${WIN_SERVICE}`,
                'ping -n 4 127.0.0.1 >nul',
                `msiexec /i "${msi}" /qn /norestart`,
                'set RC=%ERRORLEVEL%',
                `sc start ${WIN_SERVICE}`,
                'exit /b %RC%',
                '',
            ].join('\r\n'));
            r = runAsAdmin(script, []);
        } else {
            r = runAsAdmin('msiexec.exe', ['/i', msi, '/qn', '/norestart']);
        }
        if (r.cancelled) throw new Error('You chose No at Windows\' question - nothing was installed.');
        // 3010: installed, Windows would like a restart some time.
        if (r.code !== 0 && r.code !== 3010) throw new Error(`The installer stopped with code ${r.code}.`);
    } finally {
        fs.rmSync(msi, { force: true });
        fs.rmSync(script, { force: true });
    }
}

async function installMac() {
    if (spawnSync('which', ['brew'], { stdio: 'ignore' }).status === 0) {
        say('  Using Homebrew...');
        spawnSync('brew', ['install', 'cloudflared'], { stdio: 'inherit' });
        if (findCloudflared()) return;
        say('  Homebrew did not install it - getting it from Cloudflare directly instead...');
    }
    await installMacDownload();
}

/** Cloudflare's own build for this Mac, into /usr/local/bin - also how "Update" works without Homebrew. */
async function installMacDownload(target = MAC_BIN) {
    const arch = macArch();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ama-cloudflared-'));
    try {
        const tgz = path.join(dir, 'download.tgz');
        say(`  Downloading cloudflared for this Mac (${arch === 'arm64' ? 'Apple silicon' : 'Intel'})...`);
        await download(`${RELEASES}/cloudflared-darwin-${arch}.tgz`, tgz);
        if (spawnSync('tar', ['-xzf', tgz, '-C', dir], { stdio: 'inherit' }).status !== 0) throw new Error('Could not unpack the download.');
        const file = findFile(dir, 'cloudflared');
        if (!file) throw new Error('The download did not contain cloudflared.');
        const folder = path.posix.dirname(target);
        say(`  Putting it in ${folder} - enter this Mac's password if asked (typing shows nothing).`);
        if (runSudo(['mkdir', '-p', folder]) !== 0 || runSudo(['install', '-m', '755', file, target]) !== 0) {
            throw new Error('Could not copy it into place (a wrong password also ends here).');
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const isHomebrew = (bin) => {
    try {
        return fs.realpathSync(bin).includes('/Cellar/');
    } catch {
        return false;
    }
};

// ---------------------------------------------------------------------------
// Actions

/** The token in a pasted line - the whole install command or just the token. */
function extractToken(text) {
    const found = String(text || '').match(/eyJ[A-Za-z0-9+/=_-]{40,}/g) || [];
    return found.sort((a, b) => b.length - a.length)[0] || null;
}

async function connect() {
    say('\n  Connect this computer to your Cloudflare tunnel\n');
    if (serviceState() !== 'missing') {
        say('  This computer is already connected. To connect it to a different tunnel,');
        say('  choose 6 (Remove) first, then 1 again.');
        return;
    }
    if (!(await install())) return;
    const bin = findCloudflared();

    say();
    say(`  In ${DASHBOARD}:`);
    say('    - no tunnel yet:       Create a tunnel > name it (e.g. ama-orders) > Create Tunnel');
    say('    - tunnel made before:  click it > Overview > Add a replica');
    say(`  choose ${IS_MAC ? 'macOS' : 'Windows'}, and copy the command it shows (it holds a long code, the token).`);
    say(`  Paste it here (${IS_MAC ? 'Cmd+V' : 'right-click, or Ctrl+V'}) - the whole command or just the token - then press Enter.`);
    say('  The token is a secret: do not send it to anyone.');
    const token = extractToken(await ask('\n  Paste: '));
    if (!token) {
        say('\n  That does not contain a tunnel token (it starts with "eyJ"). Nothing was changed.');
        return;
    }

    say('\n  Installing the tunnel as a service (it then starts with the computer)...');
    let failed = null;
    if (IS_WIN) {
        say('  Windows asks for permission - choose Yes.');
        const r = runAsAdmin(bin, ['service', 'install', token]);
        if (r.cancelled) {
            say('\n  You chose No at Windows\' question - nothing was changed. Choose 1 again and click Yes.');
            return;
        }
        if (r.code !== 0) failed = `code ${r.code}`;
    } else {
        say('  Enter this Mac\'s password if asked (typing shows nothing - that is normal).');
        const code = runSudo([bin, 'service', 'install', token]);
        if (code !== 0) failed = `code ${code} - a wrong password also ends here`;
    }
    if (failed || !(await waitForState('running', 20))) {
        say(`\n  The tunnel did not start${failed ? ` (${failed})` : ''}. Choose 4 (Test) for details, or 5 (log).`);
        return;
    }
    say('  OK  The tunnel is connected and running. From now on it starts by itself with the computer.');

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
    if (state === 'missing') return say('\n  This computer is not connected yet - choose 1 (Connect) first.');
    if (state === 'running') return say('\n  OK  The tunnel is already running.');
    if (IS_WIN) {
        say('\n  Starting the tunnel. Windows asks for permission - choose Yes.');
        if (runAsAdmin('sc.exe', ['start', WIN_SERVICE]).cancelled) return say('  You chose No - the tunnel was not started.');
    } else {
        say('\n  Starting the tunnel (enter this Mac\'s password if asked)...');
        // Loaded again if "Stop" took it out of launchd; if it is still loaded, just started.
        if (runSudo(['launchctl', 'bootstrap', 'system', MAC_PLIST], { quiet: true }) !== 0) {
            runSudo(['launchctl', 'kickstart', '-k', `system/${MAC_LABEL}`], { quiet: true });
        }
    }
    say((await waitForState('running')) ? '  OK  The tunnel is running. The link works again.' : '  The tunnel did not start - choose 5 (log), or 4 (Test).');
}

async function stop() {
    const state = serviceState();
    if (state === 'missing') return say('\n  This computer is not connected - nothing to stop.');
    if (state === 'stopped') return say('\n  OK  The tunnel is already stopped.');
    if (IS_WIN) {
        say('\n  Stopping the tunnel. Windows asks for permission - choose Yes.');
        if (runAsAdmin('sc.exe', ['stop', WIN_SERVICE]).cancelled) return say('  You chose No - the tunnel keeps running.');
    } else {
        say('\n  Stopping the tunnel (enter this Mac\'s password if asked)...');
        runSudo(['launchctl', 'bootout', `system/${MAC_LABEL}`], { quiet: true });
    }
    if (await waitForState('stopped')) {
        say('  OK  Stopped. The online link no longer works; inside the company the system still works.');
        say('      (The tunnel starts again with the computer - use 6 (Remove) to take it off for good.)');
    } else {
        say('  The tunnel is still running - choose 5 (log).');
    }
}

async function remove() {
    if (serviceState() === 'missing') return say('\n  This computer is not connected - nothing to remove.');
    const sure = (await ask('\n  Remove the tunnel from this computer? The online link stops until a computer connects again. (y/n): ')).toLowerCase();
    if (sure !== 'y' && sure !== 'yes') return say('  Nothing changed.');
    const bin = findCloudflared();
    if (IS_WIN) {
        say('  Windows asks for permission - choose Yes.');
        const r = bin ? runAsAdmin(bin, ['service', 'uninstall']) : runAsAdmin('sc.exe', ['delete', WIN_SERVICE]);
        if (r.cancelled) return say('  You chose No - nothing was removed.');
    } else {
        say('  Enter this Mac\'s password if asked.');
        // cloudflared's uninstall runs "launchctl unload" and gives up when
        // that fails - which it does after "Stop" took the tunnel out of
        // launchd. So load it first (an error just means it already was), and
        // if the file is still there afterwards, take it away directly.
        runSudo(['launchctl', 'bootstrap', 'system', MAC_PLIST], { quiet: true });
        if (bin) runSudo([bin, 'service', 'uninstall']);
        if (fs.existsSync(MAC_PLIST)) {
            runSudo(['launchctl', 'bootout', `system/${MAC_LABEL}`], { quiet: true });
            runSudo(['rm', '-f', MAC_PLIST]);
        }
    }
    say((await waitForState('missing'))
        ? '  OK  Removed. Connect again from this menu (or on the other computer) when needed.'
        : '  It is still installed - try again, or choose 5 (log).');
}

async function update() {
    const bin = findCloudflared();
    if (!bin) return say('\n  cloudflared is not installed here - choose 1 (Connect).');
    const installed = versionOf(bin);
    say(`\n  Installed here:  cloudflared ${installed}`);
    const latest = await latestVersion();
    say(latest ? `  Newest:          cloudflared ${latest}` : '  (Could not ask GitHub for the newest version - updating anyway.)');
    if (latest && !isNewer(versionNumbers(latest), versionNumbers(installed))) {
        return say('  OK  Already the newest version - nothing to do.');
    }
    const state = serviceState();
    try {
        if (IS_WIN) {
            await installWindowsMsi({ restartService: state === 'running' });
        } else {
            if (isHomebrew(bin)) {
                say('  Updating with Homebrew...');
                spawnSync('brew', ['upgrade', 'cloudflared'], { stdio: 'inherit' });
            } else {
                await installMacDownload(bin);
            }
            if (state === 'running') {
                say('  Restarting the tunnel on the new version (enter this Mac\'s password if asked)...');
                runSudo(['launchctl', 'kickstart', '-k', `system/${MAC_LABEL}`], { quiet: true });
            }
        }
    } catch (err) {
        return say(`  ${hideTokens(err.message)}`);
    }
    const now = versionOf(findCloudflared() || bin);
    say(now !== installed ? `  OK  Updated: cloudflared ${now}` : `  Still cloudflared ${now} - try again later.`);
    if (state === 'running') {
        say((await waitForState('running')) ? '  OK  The tunnel is running.' : '  The tunnel did not come back - choose 2 (Start).');
    }
}

function showLog() {
    say('\n  Tunnel log (most recent last)\n');
    if (IS_MAC) {
        let shown = false;
        for (const file of MAC_LOGS) {
            let text;
            try {
                text = fs.readFileSync(file, 'utf8');
            } catch {
                continue;
            }
            say(`  --- ${file} ---`);
            for (const line of hideTokens(text).trim().split(/\r?\n/).slice(-25)) say(`  ${line}`);
            shown = true;
        }
        if (!shown) say('  No log files yet (the tunnel has not run on this Mac).');
        return;
    }
    const ps = [
        `$e = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = '${WIN_SERVICE}' } -MaxEvents 25 -ErrorAction SilentlyContinue;`,
        "if ($e) { $e | Sort-Object TimeCreated | ForEach-Object { '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f $_.TimeCreated, ($_.Message -split [Environment]::NewLine)[0] } }",
        "else { 'No tunnel entries in the Windows event log yet.' }",
    ].join(' ');
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
    for (const line of hideTokens(r.stdout || r.stderr).trim().split(/\r?\n/)) say(`  ${line}`);
    say();
    say('  Windows keeps only the tunnel\'s start and stop messages here (all of them: Event Viewer >');
    say('  Windows Logs > Application, source "Cloudflared"). Whether it is CONNECTED shows in');
    say(`  ${DASHBOARD}: your tunnel should say HEALTHY.`);
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
    if (bin) {
        // Cloudflare supports versions up to a year old; Windows never updates by itself.
        const [year, month] = versionNumbers(versionOf(bin));
        const ageDays = year ? (Date.now() - new Date(year, month - 1, 1).getTime()) / 86400000 : 0;
        if (ageDays > 300) check('warn', 'cloudflared is almost a year old (or older)', 'Menu option 7 updates it.');
    }

    const state = serviceState();
    check(state !== 'missing', state === 'missing' ? 'The tunnel is not connected on this computer' : 'The tunnel is connected on this computer',
        'Menu option 1 - paste the install command from Cloudflare.');
    if (state !== 'missing') {
        const program = serviceProgram();
        if (program && !fs.existsSync(program)) {
            check(false, `The tunnel service runs ${program}, which is no longer there`,
                `Choose 6 (Remove), then 1 (Connect) - copy the command again: ${DASHBOARD} > your tunnel > Overview > Add a replica.`);
        }
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
            : 'Put APP_URL=https://your-domain in server/.env (or let option 1 do it), then Stop AMA and Start AMA.');

    if (link) {
        const host = new URL(link).hostname;
        const route = `${DASHBOARD} > your tunnel > Routes > Add route > Published application: ${host === apexOf(host) ? 'no subdomain' : `subdomain ${host.slice(0, -apexOf(host).length - 1)}`}, Domain ${apexOf(host)}, Service URL http://localhost:${port}`;
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
        check(addresses.length > 0, addresses.length ? `${host} has an address` : `${host} has no address yet`, route);

        const remote = await healthAt(link, 10000);
        if (remote && local && remote.instance === local.instance) {
            check(true, `${link} reaches the system on this computer`);
        } else if (remote && local) {
            check(false, `${link} answers from ANOTHER computer`,
                'Two copies = two databases. Stop AMA and remove the tunnel (6) on one of the computers.');
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
                530: 'Cloudflare cannot reach the tunnel: no computer has it connected (error 530 / 1033).',
                502: 'The tunnel is connected, but nothing answers at localhost on that computer (error 502).',
                404: 'The tunnel has no route for this name (error 404).',
            }[code];
            let fix;
            if (code === 530) {
                fix = state === 'missing' ? 'Connect this computer (option 1) - or start the tunnel on the computer that runs the system.'
                    : state === 'stopped' ? 'Start the tunnel (option 2).'
                        : 'The tunnel runs here but is not connected: check the internet, that no firewall blocks cloudflared (port 7844), '
                            + `and that ${host} is a route of THIS tunnel (${DASHBOARD} > your tunnel > Routes). Then option 5 (log).`;
            } else if (code === 502) {
                fix = 'Start the system with Start AMA on the computer with the tunnel.';
            } else if (code === 404) {
                fix = route;
            } else {
                fix = state !== 'running' ? 'Start the tunnel (option 2).' : !local ? 'Start the system with Start AMA.' : `Check the route: ${route}`;
            }
            check(false, `${link} does not reach the system${why ? ` - ${why}` : ''}`, fix);
        }

        try {
            const res = await fetch(`http://${host}/`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
            const to = res.headers.get('location') || '';
            check(([301, 302, 307, 308].includes(res.status) && to.startsWith('https://')) || 'warn',
                to.startsWith('https://') ? 'http:// is sent on to https://' : 'http:// is NOT sent on to https://',
                'Cloudflare: your domain > SSL/TLS > Edge Certificates > turn on "Always Use HTTPS".');
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
        say('  7) Update cloudflared to the newest version');
        say('  0) Exit');
        const choice = await ask('\n  Choose a number: ');
        if (choice === '' || choice === '0') return;
        const action = { 1: connect, 2: start, 3: stop, 4: test, 5: showLog, 6: remove, 7: update }[choice];
        if (!action) {
            say('  Choose 0-7.');
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
    if (typeof fetch !== 'function') {
        console.error('\n  Node.js on this computer is too old. Install the LTS version from https://nodejs.org, then try again.\n');
        process.exit(2);
    }
    const commands = { connect, start, stop, test, log: showLog, status, remove, update, menu };
    const command = commands[process.argv[2] || 'menu'];
    if (!command) {
        console.error('usage: node scripts/tunnel.js [menu|connect|start|stop|test|status|log|remove|update]');
        process.exit(2);
    }
    Promise.resolve(command()).catch((err) => {
        console.error('\n  Unexpected error:', hideTokens(err.message || err));
        process.exitCode = 1;
    });
}

module.exports = {
    extractToken, hideTokens, adminCmdArgs, elevateScript,
    connect, start, stop, test, showLog, status, remove, update, menu,
};
