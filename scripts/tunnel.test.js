#!/usr/bin/env node
/**
 * Checks scripts/tunnel.js without touching this computer: every menu action
 * runs on a pretend Mac and a pretend Windows PC. Each command the script
 * would run (brew, sudo, launchctl, tar, winget, sc, msiexec, PowerShell) is
 * recorded and answered the way the real one would be; the system files it
 * looks at (/Library/..., /usr/local/..., C:\Program Files\...) and
 * server/.env are pretend; there is no network.
 *
 * On Windows it also runs, for real, the cmd.exe / PowerShell quoting behind
 * the administrator prompt (without the prompt), with paths that contain
 * spaces - the part a pretend run cannot prove.
 *
 * Run:  node scripts/tunnel.test.js
 */
'use strict';
process.env.AMA_TUNNEL_TEST = '1';
process.env['ProgramFiles(x86)'] = 'C:\\Program Files (x86)';
process.env.ProgramFiles = 'C:\\Program Files';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const dnsPromises = require('dns').promises;

const real = {
    spawnSync: childProcess.spawnSync,
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync,
    realpathSync: fs.realpathSync,
    log: console.log,
    platform: process.platform,
};

const TUNNEL = path.join(__dirname, 'tunnel.js');
const ENV_FILE = path.resolve(__dirname, '..', 'server', '.env');
const TOKEN = 'eyJhIjoiMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTAiLCJ0IjoiYWJjZGVmLTEyMzQiLCJzIjoic2VjcmV0c2VjcmV0In0=';
const RELEASES = 'https://github.com/cloudflare/cloudflared/releases/latest/download';
const LATEST_API = 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest';
const WIN_BIN = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
const MAC_PLIST = '/Library/LaunchDaemons/com.cloudflare.cloudflared.plist';
const MAC_ERR_LOG = '/Library/Logs/com.cloudflare.cloudflared.err.log';
const BREW_BIN = '/opt/homebrew/bin/cloudflared';
const MAC_BIN = '/usr/local/bin/cloudflared';
const MAC_PASTE = `sudo cloudflared service install ${TOKEN}`;
const WIN_PASTE = `cloudflared.exe service install ${TOKEN}`;

// ---------------------------------------------------------------------------
// The pretend computer

let world;

function newWorld(platform, over = {}) {
    const { files = {}, realpaths = {}, ...rest } = over;
    const w = {
        platform,
        env: 'DB_NAME=ama_order_system\n', // server/.env (no APP_URL yet)
        service: 'missing', // missing | running | stopped
        loaded: false, // Mac: the job is in launchd
        brew: false,
        winget: false,
        wingetWorks: true,
        admin: false,
        uac: 'yes',
        sudoOk: true,
        uninstallFails: false,
        installError: null,
        winServiceBin: WIN_BIN,
        localUp: true,
        remote: 'same', // 'same' | 'other' | 530 | 502 | 404
        httpsRedirect: true,
        version: '2026.10.7',
        latest: '2026.10.7',
        answers: [],
        commands: [],
        fetches: [],
        output: [],
        installedToken: null,
        tempDirs: [],
        ...rest,
        files: new Map(), // pretend path -> contents
        realpaths: {}, // pretend path -> where its symlink points
    };
    for (const [p, v] of Object.entries(files)) w.files.set(key(p), v);
    for (const [p, v] of Object.entries(realpaths)) w.realpaths[key(p)] = v;
    return w;
}

// One spelling for pretend paths, whatever slashes the code used.
const key = (p) => String(p).replace(/\\/g, '/');
const FAKE = ['/Library/', '/usr/local/', '/opt/homebrew/', 'C:/Program Files'];
const isFake = (p) => typeof p === 'string' && FAKE.some((x) => key(p).startsWith(x));
const isEnv = (p) => typeof p === 'string' && !p.startsWith('/') && path.resolve(p) === ENV_FILE;
const enoent = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });

fs.existsSync = (p) => (isEnv(p) ? world.env !== null : isFake(p) ? world.files.has(key(p)) : real.existsSync(p));
fs.readFileSync = (p, ...rest) => {
    if (isEnv(p)) {
        if (world.env === null) throw enoent(p);
        return world.env;
    }
    if (isFake(p)) {
        if (!world.files.has(key(p))) throw enoent(p);
        return world.files.get(key(p));
    }
    return real.readFileSync(p, ...rest);
};
fs.writeFileSync = (p, data, ...rest) => {
    if (isEnv(p)) world.env = String(data);
    else if (isFake(p)) world.files.set(key(p), String(data));
    else real.writeFileSync(p, data, ...rest);
};
fs.realpathSync = (p, ...rest) => (isFake(p) ? world.realpaths[key(p)] || p : real.realpathSync(p, ...rest));

const plist = (bin) => [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0"><dict>',
    '  <key>Label</key><string>com.cloudflare.cloudflared</string>',
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${bin}</string>`,
    '    <string>tunnel</string><string>run</string><string>--token-file</string>',
    '    <string>/Library/Application Support/com.cloudflare.cloudflared/token</string>',
    '  </array>',
    '  <key>RunAtLoad</key><true/>',
    '</dict></plist>',
].join('\n');

const result = (status, stdout = '', stderr = '') => ({ status, stdout, stderr, output: [null, stdout, stderr], pid: 0, signal: null });

/** What cmd.exe would do with runAsAdmin's arguments (elevated or not). */
function simulateCmd(cmdArgs) {
    const m = /^\/d \/s \/c ""([^"]+)" (.*) > "([^"]+)" 2>&1"$/.exec(cmdArgs);
    assert(m, `cmd.exe arguments in the expected shape: ${cmdArgs}`);
    const [, file, argText, log] = m;
    const argv = [...argText.matchAll(/"([^"]*)"|(\S+)/g)].map((x) => x[1] ?? x[2]);
    let code = 0;
    let text = '';
    const name = path.win32.basename(file).toLowerCase();
    if (key(file) === key(WIN_BIN)) {
        if (argv[0] === 'service' && argv[1] === 'install') {
            if (world.installError) {
                code = 1;
                text = world.installError;
            } else if (world.service !== 'missing') {
                code = 1;
                text = 'Cloudflared agent service is already installed';
            } else {
                world.installedToken = argv[2];
                world.service = 'running';
                text = 'Installing cloudflared Windows service\r\nAgent service for cloudflared installed successfully';
            }
        } else if (argv[0] === 'service' && argv[1] === 'uninstall') {
            if (world.service === 'missing') code = 1;
            else world.service = 'missing';
        } else {
            code = 1;
        }
    } else if (name === 'sc.exe') {
        if (world.service === 'missing') code = 1060;
        else if (argv[0] === 'start') world.service = 'running';
        else if (argv[0] === 'stop') world.service = 'stopped';
        else if (argv[0] === 'delete') world.service = 'missing';
    } else if (name === 'msiexec.exe') {
        assert.deepStrictEqual([argv[0], argv[2], argv[3]], ['/i', '/qn', '/norestart'], 'msiexec switches stay bare');
        assert(real.existsSync(argv[1]), 'the .msi was downloaded before msiexec runs');
        world.files.set(key(WIN_BIN), '');
        world.version = world.latest;
    } else if (name === 'update-cloudflared.cmd') {
        const script = real.readFileSync(file, 'utf8');
        for (const line of ['sc stop Cloudflared', 'msiexec /i "', '/qn /norestart', 'sc start Cloudflared']) {
            assert(script.includes(line), `the update script has: ${line}`);
        }
        world.version = world.latest;
    } else {
        code = 1;
        text = `unexpected program ${file}`;
    }
    real.writeFileSync(log, text);
    return code;
}

function fakeSpawnSync(cmd, args = []) {
    const line = [cmd, ...args].join(' ');
    world.commands.push(line.split(TOKEN).join('<TOKEN>'));
    const name = path.win32.basename(String(cmd)).toLowerCase();

    if (name === 'where') return result(args[0] === 'winget' && world.winget ? 0 : 1);
    if (name === 'which') return result(args[0] === 'brew' && world.brew ? 0 : 1);
    if (name === 'cloudflared' || name === 'cloudflared.exe') {
        return args[0] === '--version' ? result(0, `cloudflared version ${world.version} (built 2026-10-30-1711 UTC)\n`) : result(1);
    }
    if (name === 'brew') {
        if (args[0] === 'install') {
            world.files.set(BREW_BIN, '');
            world.realpaths[BREW_BIN] = `/opt/homebrew/Cellar/cloudflared/${world.latest}/bin/cloudflared`;
        }
        if (args[0] === 'upgrade') world.version = world.latest;
        return result(0);
    }
    if (name === 'winget') {
        if (world.wingetWorks) world.files.set(key(WIN_BIN), '');
        return result(world.wingetWorks ? 0 : 1);
    }
    if (name === 'sysctl') return result(0, '1\n');
    if (name === 'tar') {
        const dir = args[args.indexOf('-C') + 1];
        world.tempDirs.push(dir);
        fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true });
        real.writeFileSync(path.join(dir, 'pkg', 'cloudflared'), 'binary');
        return result(0);
    }
    if (name === 'pgrep') return result(world.service === 'running' ? 0 : 1);
    if (name === 'net') return result(world.admin ? 0 : 2);
    if (name === 'sudo') {
        if (!world.sudoOk) return result(1);
        const [what, ...rest] = args;
        if (path.posix.basename(what) === 'cloudflared' && rest[0] === 'service') {
            if (rest[1] === 'install') {
                if (world.service !== 'missing') return result(1);
                world.installedToken = rest[2];
                world.files.set(MAC_PLIST, plist(what));
                world.loaded = true;
                world.service = 'running';
                return result(0);
            }
            if (rest[1] === 'uninstall') {
                // As cloudflared does: "launchctl unload" first, give up if it fails.
                if (!world.loaded || world.uninstallFails) return result(1);
                world.files.delete(MAC_PLIST);
                world.loaded = false;
                world.service = 'missing';
                return result(0);
            }
        }
        if (what === 'launchctl') {
            if (rest[0] === 'bootstrap') {
                if (!world.files.has(MAC_PLIST)) return result(2);
                if (world.loaded) return result(5); // already loaded
                world.loaded = true;
                world.service = 'running'; // RunAtLoad
                return result(0);
            }
            if (rest[0] === 'kickstart') {
                if (!world.loaded) return result(113);
                world.service = 'running';
                return result(0);
            }
            if (rest[0] === 'bootout') {
                if (!world.loaded) return result(3);
                world.loaded = false;
                world.service = 'stopped';
                return result(0);
            }
        }
        if (what === 'rm' && rest[0] === '-f') {
            world.files.delete(key(rest[1]));
            if (key(rest[1]) === MAC_PLIST) {
                world.loaded = false;
                world.service = 'missing';
            }
            return result(0);
        }
        if (what === 'mkdir') return result(0);
        if (what === 'install') {
            world.files.set(key(rest[rest.length - 1]), '');
            world.version = world.latest;
            return result(0);
        }
        return result(1);
    }
    if (name === 'sc') {
        if (args[0] === 'query') {
            if (world.service === 'missing') {
                return result(1060, '[SC] EnumQueryServicesStatus:OpenService FAILED 1060:\r\n\r\nThe specified service does not exist as an installed service.\r\n');
            }
            return result(0, `SERVICE_NAME: Cloudflared\r\n        STATE              : ${world.service === 'running' ? '4  RUNNING' : '1  STOPPED'}\r\n`);
        }
        if (args[0] === 'qc') {
            return result(0, `SERVICE_NAME: Cloudflared\r\n        BINARY_PATH_NAME   : "${world.winServiceBin}" tunnel run --token ${TOKEN}\r\n`);
        }
        return result(1);
    }
    if (name === 'powershell') {
        const script = args[args.indexOf('-Command') + 1];
        if (script.includes('Get-WinEvent')) {
            assert(script.includes("ProviderName = 'Cloudflared'"), 'the event log is read under the name "Cloudflared"');
            return result(0, `2026-11-08 09:00:00  Cloudflared service starting\r\n2026-11-08 09:00:01  Cloudflared service arguments: [cloudflared.exe tunnel run --token ${TOKEN}]\r\n`);
        }
        if (script.includes('Start-Process')) {
            assert(script.includes('-Verb RunAs'), 'Windows is asked for administrator permission');
            if (world.uac === 'no') return result(1223);
            const m = /-ArgumentList '((?:[^']|'')*)'/.exec(script);
            assert(m, 'PowerShell passes one argument string to cmd.exe');
            return result(simulateCmd(m[1].replace(/''/g, "'")));
        }
        return result(1);
    }
    if (name === 'cmd.exe') return result(simulateCmd(args[0]));
    if (String(cmd) === process.execPath) return result(0); // launch.js stop / start
    return result(1, '', `unexpected command: ${line}`);
}
childProcess.spawnSync = fakeSpawnSync;

global.fetch = async (url) => {
    const u = String(url);
    world.fetches.push(u);
    const res = (status, body = '', headers = {}) => ({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k) => headers[k.toLowerCase()] ?? null },
        json: async () => JSON.parse(body),
        arrayBuffer: async () => Buffer.from(body),
    });
    if (u.startsWith(RELEASES)) return res(200, 'binary');
    if (u === LATEST_API) return res(200, JSON.stringify({ tag_name: world.latest }));
    if (u.startsWith('http://127.0.0.1:')) {
        if (!world.localUp) throw new Error('connection refused');
        return res(200, JSON.stringify({ ok: true, db: 'ready', instance: 'here' }));
    }
    if (u === 'https://amaorders.work/api/health') {
        if (world.remote === 'same' || world.remote === 'other') {
            return res(200, JSON.stringify({ ok: true, db: 'ready', instance: world.remote === 'same' ? 'here' : 'elsewhere' }));
        }
        return res(world.remote);
    }
    if (u === 'https://amaorders.work') return res(typeof world.remote === 'number' ? world.remote : 200);
    if (u === 'http://amaorders.work/') return world.httpsRedirect ? res(301, '', { location: 'https://amaorders.work/' }) : res(200);
    throw new Error(`unexpected fetch ${u}`);
};

dnsPromises.Resolver = class {
    setServers() {}
    async resolveNs() {
        return ['kolton.ns.cloudflare.com', 'maleah.ns.cloudflare.com'];
    }
    async resolve4() {
        return ['104.21.30.1'];
    }
};

readline.createInterface = () => ({
    question(q, cb) {
        world.output.push(q);
        const answer = world.answers.length ? world.answers.shift() : '';
        setImmediate(() => cb(answer));
    },
    on() {
        return this;
    },
    close() {},
});

// ---------------------------------------------------------------------------

function load(platform) {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    delete require.cache[require.resolve(TUNNEL)];
    try {
        return require(TUNNEL);
    } finally {
        Object.defineProperty(process, 'platform', { value: real.platform, configurable: true });
    }
}

const ran = (re) => world.commands.some((c) => re.test(c));
const said = (re) => world.output.some((l) => re.test(l));
const inOrder = (...res) => {
    let i = 0;
    for (const c of world.commands) if (i < res.length && res[i].test(c)) i++;
    return i === res.length;
};

let passed = 0;
let failed = 0;

async function scenario(name, platform, setup, run, checks) {
    world = newWorld(platform, setup);
    const tunnel = load(platform);
    console.log = (...a) => world.output.push(a.join(' '));
    let error = null;
    try {
        await run(tunnel);
        checks();
        const leak = world.output.find((l) => l.includes(TOKEN.slice(0, 24)));
        assert(!leak, `the token reached the screen: ${leak}`);
    } catch (err) {
        error = err;
    } finally {
        console.log = real.log;
        process.exitCode = 0;
    }
    if (!error) {
        passed++;
        console.log(`  ✓ ${name}`);
        return;
    }
    failed++;
    console.log(`  ✗ ${name}\n      ${error.message}`);
    console.log(`      commands:\n        ${world.commands.join('\n        ')}`);
    console.log(`      screen:\n        ${world.output.join('\n        ')}`);
}

const installedMac = (over = {}) => ({
    files: { [BREW_BIN]: '', [MAC_PLIST]: plist(BREW_BIN) },
    realpaths: { [BREW_BIN]: '/opt/homebrew/Cellar/cloudflared/2026.10.7/bin/cloudflared' },
    service: 'running',
    loaded: true,
    env: 'DB_NAME=ama_order_system\nAPP_URL=https://amaorders.work\n',
    ...over,
});
const installedWin = (over = {}) => ({
    files: { [WIN_BIN]: '' },
    service: 'running',
    env: 'DB_NAME=ama_order_system\nAPP_URL=https://amaorders.work\n',
    ...over,
});

async function main() {
    console.log('\nCloudflare tunnel script (scripts/tunnel.js) - pretend Mac\n');

    await scenario('Homebrew there: brew installs cloudflared, sudo installs the service by its full path, the link is saved, Test passes',
        'darwin', { brew: true, answers: [MAC_PASTE, 'https://amaorders.work', 'n'] },
        (t) => t.connect(),
        () => {
            assert(inOrder(/^which brew$/, /^brew install cloudflared$/, /^sudo \/opt\/homebrew\/bin\/cloudflared service install <TOKEN>$/), 'commands in order');
            assert.strictEqual(world.installedToken, TOKEN, 'the exact token reaches cloudflared');
            assert(/APP_URL=https:\/\/amaorders\.work/.test(world.env), 'APP_URL saved in server/.env');
            assert(said(/Everything works\. Staff can open https:\/\/amaorders\.work/), 'Test ends with "Everything works"');
        });

    await scenario('No Homebrew: Cloudflare\'s own download for Apple silicon goes to /usr/local/bin, temp files removed',
        'darwin', { brew: false, answers: [MAC_PASTE, '', ''] },
        (t) => t.connect(),
        () => {
            assert(world.fetches.includes(`${RELEASES}/cloudflared-darwin-arm64.tgz`), 'the arm64 .tgz is downloaded');
            assert(inOrder(/^tar -xzf .*download\.tgz -C /, /^sudo mkdir -p \/usr\/local\/bin$/,
                /^sudo install -m 755 .*cloudflared \/usr\/local\/bin\/cloudflared$/,
                /^sudo \/usr\/local\/bin\/cloudflared service install <TOKEN>$/), 'commands in order');
            assert(world.tempDirs.length === 1 && !real.existsSync(world.tempDirs[0]), 'the download folder is deleted');
        });

    await scenario('Stop, then Remove: loaded again first, because cloudflared\'s own uninstall gives up on a stopped tunnel',
        'darwin', installedMac({ answers: ['y'] }),
        async (t) => {
            await t.stop();
            await t.remove();
        },
        () => {
            assert(inOrder(/^sudo launchctl bootout system\/com\.cloudflare\.cloudflared$/,
                /^sudo launchctl bootstrap system \/Library\/LaunchDaemons\/com\.cloudflare\.cloudflared\.plist$/,
                /^sudo \/opt\/homebrew\/bin\/cloudflared service uninstall$/), 'commands in order');
            assert.strictEqual(world.service, 'missing');
            assert(!world.files.has(MAC_PLIST), 'the launchd file is gone');
            assert(said(/OK {2}Removed/));
        });

    await scenario('Remove when cloudflared\'s uninstall fails anyway: the launchd file is taken away directly',
        'darwin', installedMac({ uninstallFails: true, answers: ['y'] }),
        (t) => t.remove(),
        () => {
            assert(ran(/^sudo rm -f \/Library\/LaunchDaemons\/com\.cloudflare\.cloudflared\.plist$/));
            assert.strictEqual(world.service, 'missing');
            assert(said(/OK {2}Removed/));
        });

    await scenario('Start after Stop loads it again; Start when loaded but not running kick-starts it',
        'darwin', installedMac(),
        async (t) => {
            await t.stop();
            await t.start();
            world.service = 'stopped'; // exited by itself, still loaded
            await t.start();
        },
        () => {
            assert(inOrder(/launchctl bootout/, /launchctl bootstrap/, /launchctl bootstrap/, /^sudo launchctl kickstart -k system\/com\.cloudflare\.cloudflared$/));
            assert.strictEqual(world.service, 'running');
            assert(said(/OK {2}The tunnel is running/));
        });

    await scenario('A wrong Mac password: says so, claims nothing',
        'darwin', { files: { [BREW_BIN]: '' }, sudoOk: false, answers: [MAC_PASTE] },
        (t) => t.connect(),
        () => {
            assert(said(/did not start \(code 1 - a wrong password also ends here\)/));
            assert.strictEqual(world.service, 'missing');
        });

    await scenario('A paste without a token changes nothing',
        'darwin', { files: { [BREW_BIN]: '' }, answers: ['hello'] },
        (t) => t.connect(),
        () => {
            assert(said(/does not contain a tunnel token/));
            assert(!ran(/service install/));
        });

    await scenario('The log shows the last lines, token hidden',
        'darwin', installedMac({ files: { [BREW_BIN]: '', [MAC_PLIST]: plist(BREW_BIN), [MAC_ERR_LOG]: `INF Starting tunnel\nERR bad token ${TOKEN}\n` } }),
        (t) => t.showLog(),
        () => {
            assert(said(/INF Starting tunnel/) && said(/ERR bad token eyJ\.\.\.\(hidden\)/));
        });

    await scenario('Update with Homebrew: brew upgrade, then the tunnel restarts on the new version',
        'darwin', installedMac({ version: '2026.8.1', latest: '2026.10.7' }),
        (t) => t.update(),
        () => {
            assert(inOrder(/^brew upgrade cloudflared$/, /^sudo launchctl kickstart -k system\/com\.cloudflare\.cloudflared$/));
            assert(said(/OK {2}Updated: cloudflared 2026\.10\.7/) && said(/OK {2}The tunnel is running/));
        });

    await scenario('Update without Homebrew: the same file is replaced from Cloudflare\'s download',
        'darwin', installedMac({ files: { [MAC_BIN]: '', [MAC_PLIST]: plist(MAC_BIN) }, realpaths: {}, version: '2026.8.1', latest: '2026.10.7' }),
        (t) => t.update(),
        () => {
            assert(inOrder(/^sudo install -m 755 .*cloudflared \/usr\/local\/bin\/cloudflared$/, /kickstart -k/));
            assert(!ran(/^brew /));
        });

    await scenario('Update when it is already the newest: nothing is touched',
        'darwin', installedMac(),
        (t) => t.update(),
        () => {
            assert(said(/Already the newest version/));
            assert(!ran(/brew upgrade|sudo install|kickstart/));
        });

    await scenario('Test spots a service that points at a cloudflared that is gone (after an update)',
        'darwin', installedMac({ files: { [BREW_BIN]: '', [MAC_PLIST]: plist('/opt/homebrew/Cellar/cloudflared/2025.1.0/bin/cloudflared') } }),
        (t) => t.test(),
        () => {
            assert(said(/XX {3}The tunnel service runs \/opt\/homebrew\/Cellar\/cloudflared\/2025\.1\.0\/bin\/cloudflared, which is no longer there/));
            assert(said(/Overview > Add a replica/));
        });

    console.log('\nCloudflare tunnel script - what Test says about the link\n');

    await scenario('Error 530 while the tunnel runs here: internet / firewall port 7844 / route of THIS tunnel',
        'darwin', installedMac({ remote: 530, localUp: true }),
        (t) => t.test(),
        () => {
            assert(said(/error 530 \/ 1033/) && said(/port 7844/) && said(/route of THIS tunnel/));
        });

    await scenario('Error 502: start the system',
        'darwin', installedMac({ remote: 502 }),
        (t) => t.test(),
        () => assert(said(/error 502/) && said(/Start AMA/)));

    await scenario('Error 404: the exact route to add',
        'darwin', installedMac({ remote: 404 }),
        (t) => t.test(),
        () => assert(said(/Routes > Add route > Published application: no subdomain, Domain amaorders\.work, Service URL http:\/\/localhost:6001/)));

    await scenario('The link answers from another computer while this one runs too',
        'darwin', installedMac({ remote: 'other' }),
        (t) => t.test(),
        () => assert(said(/answers from ANOTHER computer/)));

    await scenario('http:// not sent on to https://',
        'darwin', installedMac({ httpsRedirect: false }),
        (t) => t.test(),
        () => assert(said(/http:\/\/ is NOT sent on to https:\/\//) && said(/Always Use HTTPS/)));

    await scenario('A cloudflared about a year old: Test suggests option 7',
        'darwin', installedMac({ version: '2025.9.1' }),
        (t) => t.test(),
        () => assert(said(/almost a year old/) && said(/Menu option 7/)));

    console.log('\nCloudflare tunnel script - pretend Windows PC\n');

    await scenario('winget there: installed without its questions, ONE permission prompt for the service, Test passes',
        'win32', { winget: true, answers: [WIN_PASTE, 'https://amaorders.work', 'n'] },
        (t) => t.connect(),
        () => {
            assert(inOrder(/^where winget$/, /^winget install --id Cloudflare\.cloudflared -e --accept-source-agreements --accept-package-agreements$/,
                /^powershell .*Start-Process -FilePath 'cmd\.exe' -ArgumentList .*""C:\\Program Files \(x86\)\\cloudflared\\cloudflared\.exe" "service" "install" "<TOKEN>" > ".*admin-command\.log" 2>&1".*-Verb RunAs/));
            assert.strictEqual(world.installedToken, TOKEN, 'the exact token reaches cloudflared');
            assert.strictEqual(world.commands.filter((c) => /Start-Process/.test(c)).length, 1, 'one permission prompt');
            assert(said(/Everything works/));
        });

    await scenario('No winget: Cloudflare\'s .msi is downloaded, installed as administrator, then deleted',
        'win32', { winget: false, answers: [WIN_PASTE, '', ''] },
        (t) => t.connect(),
        () => {
            assert(world.fetches.includes(`${RELEASES}/cloudflared-windows-amd64.msi`));
            assert(ran(/""msiexec\.exe" \/i ".*cloudflared-windows-amd64\.msi" \/qn \/norestart > /), 'msiexec with bare switches');
            assert(!real.existsSync(path.join(__dirname, '..', '.ama_runtime', 'cloudflared-windows-amd64.msi')), 'the .msi is deleted');
            assert.strictEqual(world.service, 'running');
        });

    await scenario('Choosing No at Windows\' question: said plainly, nothing changed',
        'win32', { files: { [WIN_BIN]: '' }, uac: 'no', answers: [WIN_PASTE] },
        (t) => t.connect(),
        () => {
            assert(said(/You chose No at Windows' question - nothing was changed/));
            assert.strictEqual(world.service, 'missing');
        });

    await scenario('cloudflared\'s own error message is shown when the install fails (the elevated window closes too fast to read)',
        'win32', { files: { [WIN_BIN]: '' }, installError: 'Cannot establish a connection to the service control manager', answers: [WIN_PASTE] },
        (t) => t.connect(),
        () => {
            assert(said(/Cannot establish a connection to the service control manager/));
            assert(said(/did not start \(code 1\)/));
        });

    await scenario('Stop, Start and Remove each go through the permission prompt',
        'win32', installedWin({ answers: ['y'] }),
        async (t) => {
            await t.stop();
            await t.start();
            await t.remove();
        },
        () => {
            assert(inOrder(/""sc\.exe" "stop" "Cloudflared"/, /""sc\.exe" "start" "Cloudflared"/, /cloudflared\.exe" "service" "uninstall"/));
            assert.strictEqual(world.service, 'missing');
            assert(said(/OK {2}Stopped/) && said(/OK {2}The tunnel is running/) && said(/OK {2}Removed/));
        });

    await scenario('Already running as administrator: no prompt, cmd.exe directly',
        'win32', { files: { [WIN_BIN]: '' }, admin: true, answers: [WIN_PASTE, '', ''] },
        (t) => t.connect(),
        () => {
            assert(ran(/^cmd\.exe \/d \/s \/c ""C:\\Program Files \(x86\)\\cloudflared\\cloudflared\.exe" "service" "install" "<TOKEN>" > ".*" 2>&1"$/));
            assert(!ran(/Start-Process/));
            assert.strictEqual(world.service, 'running');
        });

    await scenario('The log is read under "Cloudflared", token hidden',
        'win32', installedWin(),
        (t) => t.showLog(),
        () => assert(said(/Cloudflared service starting/) && said(/--token eyJ\.\.\.\(hidden\)/) && said(/HEALTHY/)));

    await scenario('Update while running: one prompt stops it, installs over it and starts it again',
        'win32', installedWin({ version: '2026.8.1', latest: '2026.10.7' }),
        (t) => t.update(),
        () => {
            assert.strictEqual(world.commands.filter((c) => /Start-Process/.test(c)).length, 1, 'one permission prompt');
            assert(ran(/update-cloudflared\.cmd/));
            assert(said(/OK {2}Updated: cloudflared 2026\.10\.7/) && said(/OK {2}The tunnel is running/));
        });

    await scenario('Test reads only the program path from the service (the rest of that line holds the token)',
        'win32', installedWin({ winServiceBin: 'C:\\Cloudflared\\bin\\cloudflared.exe' }),
        (t) => t.test(),
        () => assert(said(/XX {3}The tunnel service runs C:\\Cloudflared\\bin\\cloudflared\.exe, which is no longer there/)));

    const extract = load(real.platform).extractToken;
    assert.strictEqual(extract(WIN_PASTE), TOKEN);
    assert.strictEqual(extract(`  ${TOKEN}  `), TOKEN);
    assert.strictEqual(extract('nothing here'), null);
    passed++;
    console.log('  ✓ the token is found in a pasted command, alone, or not at all');

    if (real.platform === 'win32') await realQuoting();

    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    process.exitCode = failed ? 1 : 0;
}

/**
 * The quoting behind the administrator prompt, for real: cmd.exe (and
 * PowerShell's Start-Process, minus "-Verb RunAs") running a program whose
 * path has spaces, with a token-like argument, output to a folder with spaces.
 */
async function realQuoting() {
    childProcess.spawnSync = real.spawnSync;
    fs.existsSync = real.existsSync;
    fs.readFileSync = real.readFileSync;
    fs.writeFileSync = real.writeFileSync;
    fs.realpathSync = real.realpathSync;
    const { adminCmdArgs, elevateScript } = load('win32');
    console.log('\nCloudflare tunnel script - the real Windows quoting (no prompt)\n');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ama tunnel test '));
    const log = path.join(dir, 'admin command.log');
    const program = process.execPath; // e.g. C:\Program Files\nodejs\node.exe
    const args = ['-e', 'console.log(JSON.stringify(process.argv.slice(1)));process.exit(3)', 'service', 'install', TOKEN];
    const expected = JSON.stringify(['service', 'install', TOKEN]);
    const check = (label, ok, detail) => {
        if (ok) {
            passed++;
            console.log(`  ✓ ${label}`);
        } else {
            failed++;
            console.log(`  ✗ ${label}\n      ${detail}`);
        }
    };
    try {
        const direct = real.spawnSync('cmd.exe', [adminCmdArgs(program, args, log)], { windowsVerbatimArguments: true });
        const directOut = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() : '(no log)';
        check(`cmd.exe runs "${program}" with the token intact, output into a folder with spaces, exit code kept`,
            direct.status === 3 && directOut === expected, `status ${direct.status}, log ${directOut}`);
        fs.rmSync(log, { force: true });

        const ps = real.spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', elevateScript(adminCmdArgs(program, args, log), { elevate: false })], { encoding: 'utf8' });
        const psOut = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() : '(no log)';
        check('the same through PowerShell\'s Start-Process (what the permission prompt uses)',
            ps.status === 3 && psOut === expected, `status ${ps.status}, log ${psOut}, ${ps.stderr}`);

        const broken = elevateScript(adminCmdArgs(program, args, log), { elevate: false }).replace("-FilePath 'cmd.exe'", "-FilePath 'no-such-program-ama.exe'");
        const failedRun = real.spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', broken], { encoding: 'utf8' });
        check('a program that cannot start ends with code 1 (only choosing No gives 1223)',
            failedRun.status === 1, `status ${failedRun.status}, ${failedRun.stdout} ${failedRun.stderr}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

main().catch((err) => {
    console.log = real.log;
    console.error(err);
    process.exitCode = 1;
});
