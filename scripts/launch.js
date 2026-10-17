#!/usr/bin/env node
/**
 * One-click start / stop / restore for the AMA Order System, on Windows and Mac.
 *
 * Behind the double-click files in the project folder:
 *   "Start AMA (Windows).cmd"   / "Start AMA (Mac).command"    -> node scripts/launch.js start
 *   "Stop AMA (Windows).cmd"    / "Stop AMA (Mac).command"     -> node scripts/launch.js stop
 *   "Restore AMA (Windows).cmd" / "Restore AMA (Mac).command"  -> node scripts/launch.js restore
 *
 * start: checks Node, creates server/.env if missing, installs packages and
 * builds the web client when needed, starts the server in the background,
 * waits until the database is ready, then opens the browser.
 *
 * The server keeps running after the window is closed. Its output goes to
 * .ama_runtime/server.log, and its process id to .ama_runtime/server.pid -
 * the same layout the Flutter project's start_ama.command uses.
 *
 * Uses only Node's built-in modules: it runs before `npm install` has.
 */
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server');
const CLIENT = path.join(ROOT, 'client');
const RUNTIME = path.join(ROOT, '.ama_runtime');
const PID_FILE = path.join(RUNTIME, 'server.pid');
const LOG_FILE = path.join(RUNTIME, 'server.log');
const ENV_FILE = path.join(SERVER, '.env');
const ENV_EXAMPLE = path.join(SERVER, '.env.example');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const MIN_NODE = [20, 19, 0]; // Vite 7, which builds the web client, needs 20.19+
const START_TIMEOUT_MS = 90_000;
const JWT_PLACEHOLDERS = new Set(['', 'change-me-to-a-long-random-string', 'your-secret-key']);

// ---------------------------------------------------------------------------
// Output

const say = (line = '') => console.log(line);
const step = (line) => console.log(`  - ${line}`);
const good = (line) => console.log(`  OK  ${line}`);
const warn = (line) => console.log(`  !   ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Stop extends Error {}
const stop = (lines) => {
    throw new Stop([].concat(lines).join('\n'));
};

/** Ask a question. If the input ends instead of an answer, the answer is "". */
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
            resolve(a.trim().toLowerCase());
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

/** Set KEY=value in server/.env, replacing the line if it exists. Never logs the value. */
function writeEnvValue(key, value) {
    const text = fs.readFileSync(ENV_FILE, 'utf8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
    const next = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.replace(/\s*$/, '')}${eol}${key}=${value}${eol}`;
    fs.writeFileSync(ENV_FILE, next);
}

function openInEditor(file) {
    if (IS_WIN) spawn('notepad.exe', [file], { detached: true, stdio: 'ignore' }).unref();
    else if (IS_MAC) spawn('open', ['-e', file], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [file], { detached: true, stdio: 'ignore' }).unref();
}

function ensureEnv() {
    if (!fs.existsSync(ENV_FILE)) {
        fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
        writeEnvValue('JWT_SECRET', crypto.randomBytes(48).toString('hex'));
        openInEditor(ENV_FILE);
        stop([
            'First run: created server/.env and opened it.',
            '  Fill in DB_PASSWORD (your MySQL password), save the file,',
            '  then run Start AMA again.',
        ]);
    }

    const env = readEnv();
    if (env.DB_PASSWORD === 'your_password') {
        openInEditor(ENV_FILE);
        stop([
            'server/.env still has the example MySQL password.',
            '  Put your MySQL password in DB_PASSWORD, save, and run Start AMA again.',
        ]);
    }
    // A missing or example JWT secret lets anyone forge a login. Replace it
    // with a random one; the only effect is that everyone logs in once more.
    if (JWT_PLACEHOLDERS.has(env.JWT_SECRET || '')) {
        writeEnvValue('JWT_SECRET', crypto.randomBytes(48).toString('hex'));
        warn('Generated a secure JWT_SECRET in server/.env (everyone will need to log in again once).');
    }
    return readEnv();
}

// ---------------------------------------------------------------------------
// Node, packages, build

function checkNode() {
    const have = process.versions.node.split('.').map(Number);
    const ok = have[0] > MIN_NODE[0] || (have[0] === MIN_NODE[0] && (have[1] > MIN_NODE[1] || (have[1] === MIN_NODE[1] && have[2] >= MIN_NODE[2])));
    if (!ok) {
        stop([
            `Node.js ${MIN_NODE.join('.')} or newer is needed - this computer has ${process.versions.node}.`,
            '  Install the current LTS version from https://nodejs.org and run Start AMA again.',
        ]);
    }
}

/** Run npm in `cwd`, showing its output. `args` are fixed words - never user input. */
function npm(args, cwd) {
    // On Windows npm is a .cmd file, which Node only runs through a shell -
    // given as one command line, which is what Node expects with a shell.
    const result = IS_WIN
        ? spawnSync(`npm ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true })
        : spawnSync('npm', args, { cwd, stdio: 'inherit' });
    if (result.error) stop(`Could not run npm (${result.error.message}). Is Node.js installed correctly?`);
    if (result.status !== 0) stop(`"npm ${args.join(' ')}" failed in ${path.basename(cwd)}/ - see the messages above.`);
}

const mtime = (file) => {
    try {
        return fs.statSync(file).mtimeMs;
    } catch {
        return 0;
    }
};

function ensurePackages(dir) {
    const name = path.basename(dir);
    const installed = path.join(dir, 'node_modules', '.package-lock.json');
    const lock = path.join(dir, 'package-lock.json');
    const pkg = path.join(dir, 'package.json');
    if (!fs.existsSync(installed)) {
        step(`Installing ${name} packages (first run - this takes a minute)...`);
        npm(['install', '--no-audit', '--no-fund'], dir);
    } else if (Math.max(mtime(lock), mtime(pkg)) > mtime(installed)) {
        step(`Updating ${name} packages...`);
        npm(['install', '--no-audit', '--no-fund'], dir);
    }
}

function newestFile(target) {
    let newest = 0;
    const walk = (p) => {
        let stat;
        try {
            stat = fs.statSync(p);
        } catch {
            return;
        }
        if (stat.isDirectory()) {
            if (path.basename(p) === 'node_modules') return;
            for (const child of fs.readdirSync(p)) walk(path.join(p, child));
        } else if (stat.mtimeMs > newest) {
            newest = stat.mtimeMs;
        }
    };
    walk(target);
    return newest;
}

function ensureClientBuild() {
    const built = mtime(path.join(CLIENT, 'dist', 'index.html'));
    const sources = Math.max(
        ...['src', 'public', 'index.html', 'package.json', 'vite.config.js'].map((p) => newestFile(path.join(CLIENT, p)))
    );
    if (!built || sources > built) {
        step(built ? 'The web client changed - rebuilding it...' : 'Building the web client (first run)...');
        npm(['run', 'build'], CLIENT);
    }
}

// ---------------------------------------------------------------------------
// The server process

// The server reads PORT from its environment first, then server/.env.
const serverPort = (env) => Number(process.env.PORT || env.PORT) || 6001;

async function health(port) {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}

const readPid = () => {
    const n = Number(fs.existsSync(PID_FILE) ? fs.readFileSync(PID_FILE, 'utf8').trim() : NaN);
    return Number.isInteger(n) && n > 0 ? n : null;
};

const alive = (pid) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err.code === 'EPERM';
    }
};

/** Is `pid` a Node process? Checked before killing anything, so a recycled pid is never touched. */
function isNodeProcess(pid) {
    if (IS_WIN) {
        const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
        return /"node(\.exe)?"/i.test(r.stdout || '');
    }
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
    return /(^|\/)node\s*$/i.test((r.stdout || '').trim());
}

/** Process ids listening on `port`. */
function listenersOn(port) {
    if (IS_WIN) {
        const r = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
        const pids = new Set();
        for (const line of (r.stdout || '').split(/\r?\n/)) {
            const cols = line.trim().split(/\s+/);
            if (cols.length >= 5 && /LISTEN/i.test(cols[3]) && cols[1].endsWith(`:${port}`)) pids.add(Number(cols[4]));
        }
        return [...pids].filter((p) => p > 0);
    }
    const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
    return (r.stdout || '').split(/\s+/).map(Number).filter((p) => p > 0);
}

async function kill(pid) {
    if (IS_WIN) {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
        try {
            process.kill(pid, 'SIGTERM');
        } catch {
            /* already gone */
        }
        for (let i = 0; i < 25 && alive(pid); i++) await sleep(200);
        if (alive(pid)) {
            try {
                process.kill(pid, 'SIGKILL');
            } catch {
                /* already gone */
            }
        }
    }
    for (let i = 0; i < 25 && alive(pid); i++) await sleep(200);
    return !alive(pid);
}

function tail(file, lines = 40) {
    try {
        return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
    } catch {
        return '(no log yet)';
    }
}

/** The part of the log written since `offset` bytes - i.e. by this start. */
function logSince(offset) {
    try {
        const all = fs.readFileSync(LOG_FILE);
        return all.subarray(offset).toString('utf8').trim();
    } catch {
        return '';
    }
}

// Adapters a phone on the Wi-Fi can never reach: virtual machines, WSL,
// Docker, VPNs. Listing their addresses only invites typing the wrong one.
// Windows often names them just "Ethernet 2", so the hardware address prefix
// of the common virtual adapters is checked too (VirtualBox, VMware, Hyper-V).
const VIRTUAL_ADAPTER = /virtualbox|vmware|vethernet|hyper-v|wsl|docker|vboxnet|bridge|utun|tailscale|zerotier|loopback/i;
const VIRTUAL_MAC = /^(0a:00:27|08:00:27|00:50:56|00:0c:29|00:05:69|00:1c:14|00:15:5d)/i;

function lanAddresses() {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
        if (VIRTUAL_ADAPTER.test(name)) continue;
        for (const a of list || []) {
            if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.') || VIRTUAL_MAC.test(a.mac || '')) continue;
            out.push(a.address);
        }
    }
    return out;
}

function openBrowser(url) {
    // AMA_NO_BROWSER=1 for a server with no screen (or a scripted check).
    if (process.env.AMA_NO_BROWSER === '1') return;
    // explorer.exe hands a URL to the default browser, with none of the
    // quoting traps of `cmd /c start "" <url>`.
    if (IS_WIN) spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' }).unref();
    else if (IS_MAC) spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

function printAddresses(port) {
    say();
    say(`  On this computer:  http://localhost:${port}`);
    for (const ip of lanAddresses()) say(`  On phones (same Wi-Fi):  http://${ip}:${port}`);
    say();
}

const DB_ADVICE = {
    ECONNREFUSED: IS_MAC
        ? 'MySQL is not running. Start it (System Settings > MySQL, or: brew services start mysql), then run Start AMA again.'
        : 'MySQL is not running. Start it (Win+R > services.msc > MySQL > Start), then run Start AMA again.',
    ER_ACCESS_DENIED_ERROR: 'MySQL refused the password. Check DB_USER and DB_PASSWORD in server/.env.',
    ER_BAD_DB_ERROR: 'The database does not exist yet. In server/, run "npm run db:create", then Start AMA again.',
};

async function start() {
    say('\nAMA Order System - starting\n');
    checkNode();
    const env = ensureEnv();
    const port = serverPort(env);

    const running = await health(port);
    if (running) {
        good(`Already running on port ${port}.`);
        printAddresses(port);
        openBrowser(`http://localhost:${port}`);
        return;
    }
    const squatters = listenersOn(port);
    if (squatters.length) {
        if (squatters.includes(readPid())) {
            stop([
                'The system seems to be running, but it is not answering.',
                '  Run Stop AMA, then Start AMA again.',
            ]);
        }
        stop([
            `Port ${port} is in use by another program (process ${squatters.join(', ')}).`,
            '  Close that program (or run Stop AMA), or change PORT in server/.env, then run Start AMA again.',
        ]);
    }

    ensurePackages(SERVER);
    ensurePackages(CLIENT);
    ensureClientBuild();

    fs.mkdirSync(RUNTIME, { recursive: true });
    if (mtime(LOG_FILE) && fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) {
        fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
    }
    fs.appendFileSync(LOG_FILE, `\n===== Started ${new Date().toLocaleString()} =====\n`);
    const logStart = fs.statSync(LOG_FILE).size;
    const log = fs.openSync(LOG_FILE, 'a');

    step('Starting the server...');
    const child = spawn(process.execPath, ['index.js'], {
        cwd: SERVER,
        detached: true, // keeps running after this window closes
        windowsHide: true,
        stdio: ['ignore', log, log],
    });
    child.unref();
    fs.writeFileSync(PID_FILE, String(child.pid));

    let exited = false;
    child.on('exit', () => {
        exited = true;
    });

    const deadline = Date.now() + START_TIMEOUT_MS;
    let state = null;
    while (Date.now() < deadline) {
        if (exited) break;
        state = await health(port);
        if (state && state.db !== 'starting') break;
        await sleep(500);
    }

    if (exited || !state || state.db !== 'ready') {
        const output = logSince(logStart);
        say();
        say('  ---- server output ----');
        say(output.split(/\r?\n/).slice(-30).map((l) => `  ${l}`).join('\n') || '  (nothing)');
        say('  -----------------------');
        if (!exited) await kill(child.pid);
        try {
            fs.unlinkSync(PID_FILE);
        } catch {
            /* fine */
        }
        const advice = state?.dbCode && DB_ADVICE[state.dbCode];
        stop(advice || (exited
            ? 'The server stopped right after starting - the reason is in the output above.'
            : 'The server did not become ready in time - see the output above.'));
    }

    good(`Running (process ${child.pid}). The database is ready.`);
    printAddresses(port);
    say('  You can close this window - the system keeps running.');
    say('  To stop it, use Stop AMA. The server log is in .ama_runtime/server.log');
    openBrowser(`http://localhost:${port}`);
}

async function stopServer({ quiet = false } = {}) {
    if (!quiet) say('\nAMA Order System - stopping\n');
    const port = serverPort(readEnv());
    const stopped = [];

    const pid = readPid();
    if (pid && alive(pid) && isNodeProcess(pid)) {
        if (await kill(pid)) stopped.push(pid);
    }
    try {
        fs.unlinkSync(PID_FILE);
    } catch {
        /* none */
    }

    // Also catch a server started some other way (npm start, an old window).
    for (const other of listenersOn(port)) {
        if (stopped.includes(other)) continue;
        if (isNodeProcess(other)) {
            if (await kill(other)) stopped.push(other);
        } else {
            warn(`Port ${port} is used by a program that is not this system (process ${other}) - left alone.`);
        }
    }

    for (let i = 0; i < 20 && (await health(port)); i++) await sleep(250);
    if (await health(port)) stop(`Something is still answering on port ${port}. Restart the computer if it does not go away.`);

    if (stopped.length) good('Stopped. Phones and browsers can no longer reach the system.');
    else good('It was not running.');
}

async function restore() {
    say('\nAMA Order System - restore a backup\n');
    checkNode();
    ensureEnv();
    ensurePackages(SERVER);
    const port = serverPort(readEnv());

    let wasRunning = false;
    if (await health(port)) {
        say('  The system is running. It has to be stopped while a backup is restored.');
        const answer = await ask('  Stop it now? (y/n): ');
        if (answer !== 'y' && answer !== 'yes') stop('Cancelled - nothing was changed.');
        await stopServer({ quiet: true });
        wasRunning = true;
    }

    const result = spawnSync(process.execPath, ['restore-db.js'], { cwd: SERVER, stdio: 'inherit' });
    const restored = result.status === 0;
    if (!restored) process.exitCode = 1;
    if (!restored && !wasRunning) return;

    const again = await ask(restored
        ? '  Start the system again now? (y/n): '
        : '  Nothing was restored. Start the system again? (y/n): ');
    if (again === 'y' || again === 'yes' || again === '') await start();
    else say('\n  The system is stopped. Use Start AMA when you are ready.');
}

// ---------------------------------------------------------------------------

const commands = { start, stop: () => stopServer(), restore };
const command = commands[process.argv[2]];
if (!command) {
    console.error('usage: node scripts/launch.js start|stop|restore');
    process.exit(2);
}

command().catch((err) => {
    if (err instanceof Stop) {
        say();
        say(`  ${err.message}`);
        say();
    } else {
        console.error('\n  Unexpected error:', err);
    }
    process.exitCode = 1;
});
