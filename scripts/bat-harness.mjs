#!/usr/bin/env node
// Control-flow harness for start.bat that runs on any operating system.
//
// It does NOT pretend to be cmd.exe. It parses the batch file and replays the
// exact constructs that file uses (@echo, setlocal, cd, title, set, where,
// the node invocation, if errorlevel / if [not] exist / if "a"=="b", set /p,
// goto, labels, pause, exit /b). `where` and `node` are stubbed so every
// branch can be driven deterministically. Any construct it does not
// understand throws, so unsupported syntax can never pass silently.
//
// This is a safety net, not a substitute for running start.bat on Windows --
// scripts/windows-start.mjs and .github/workflows/ci.yml cover the real thing.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Replays a batch file. Returns a description of what it did.
 * @param {object} options
 * @param {string} [options.batchPath] batch file to replay
 * @param {boolean} [options.node] whether `where node` succeeds
 * @param {boolean} [options.npm] whether `where npm` succeeds
 * @param {boolean} [options.repo] whether scripts/launch-setup.mjs exists
 * @param {string[]} [options.userInputs] answers returned by `set /p`
 * @param {number} [options.launcherExit] exit code of the Node launcher
 */
export function runBatch({
  batchPath = 'start.bat',
  node = true,
  npm = true,
  repo = true,
  userInputs = [],
  launcherExit = 0,
} = {}) {
  const raw = readFileSync(resolve(batchPath), 'utf8');
  // CRLF is required for reliable cmd.exe parsing; normalise before replaying.
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  const calls = [];
  const printed = [];
  const labels = new Map();
  const environment = new Map();
  let inputIndex = 0;
  let pc = 0;
  let stopped = false;

  lines.forEach((line, index) => {
    const label = /^:(\w+)\s*$/.exec(line.trim());
    if (label) labels.set(label[1].toLowerCase(), index);
  });

  if (!labels.size) throw new Error('No labels found; is this a batch file?');

  // In cmd.exe, ERRORLEVEL and the %ERRORLEVEL% variable are one register.
  // start.bat copies it into EXITCODE after the launcher; keep both in sync so
  // `if errorlevel N` and `exit /b %EXITCODE%` observe the same value.
  const currentCode = () => {
    const raw = environment.get(environment.has('ERRORLEVEL') ? 'ERRORLEVEL' : 'EXITCODE');
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  function expand(value) {
    return value.replace(/%([^%\s]+)%/g, (whole, name) => {
      const key = name.toUpperCase();
      if (key === 'ERRORLEVEL') return String(currentCode());
      if (key === '~DP0') return `${resolve('.')}\\`;
      if (key === 'COMSPEC') return 'C:\\Windows\\System32\\cmd.exe';
      if (environment.has(key)) return environment.get(key);
      return '';
    });
  }

  function prompt(question) {
    printed.push(question);
    if (inputIndex >= userInputs.length) {
      throw new Error('Batch asked for input but the harness supplied none.');
    }
    return userInputs[inputIndex++];
  }

  function labelJump(name) {
    const target = name.toLowerCase();
    if (!labels.has(target)) throw new Error(`goto to undefined label: ${target}`);
    return labels.get(target) - 1;
  }

  /**
   * Evaluates the subset of conditions start.bat uses.
   * Returns a boolean, or { goto } for conditions written with a trailing goto.
   */
  function evaluateCondition(condition) {
    const existsCheck = /^(not\s+)?exist\s+"?([^"]+)"?$/i.exec(condition);
    if (existsCheck) {
      const negate = Boolean(existsCheck[1]);
      const target = expand(existsCheck[2]);
      // The Node launcher is the only file whose presence is simulated.
      if (/launch-setup\.mjs/i.test(target)) return negate ? !repo : repo;
      const absolute = target.startsWith('/') || /^[a-zA-Z]:/.test(target) ? target : resolve('.', target);
      return negate ? !existsSync(absolute) : existsSync(absolute);
    }

    const errorlevel = /^errorlevel\s+(\d+)$/i.exec(condition);
    if (errorlevel) return currentCode() >= Number(errorlevel[1]);

    const compare = /^(?:\/i\s+)?"([^"]*)"=="([^"]*)"(?:\s+goto\s+:?(\w+))?$/i.exec(condition);
    if (compare) {
      const caseInsensitive = /^\/i/i.test(condition);
      const left = expand(compare[1]);
      const right = expand(compare[2]);
      const equal = caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
      if (!equal) return false;
      return compare[3] ? { goto: compare[3] } : true;
    }

    throw new Error(`Unsupported if condition: ${condition}`);
  }

  function runIf(line) {
    const body = /^if\s+(.*)$/i.exec(line)[1];
    const elseIndex = body.search(/\s+else\s+/i);
    const thenPart = elseIndex === -1 ? body : body.slice(0, elseIndex);
    const elsePart = elseIndex === -1 ? null : body.slice(elseIndex + 6).trim();

    const gotoMatch = /^(.*?)\s+goto\s+:?(\w+)$/i.exec(thenPart);
    const condition = gotoMatch ? gotoMatch[1] : thenPart;
    const result = evaluateCondition(condition);

    if (result && typeof result === 'object' && result.goto) {
      pc = labelJump(result.goto);
      return;
    }
    if (result) {
      if (gotoMatch) pc = labelJump(gotoMatch[2]);
      else calls.push(['if-true', line]);
      return;
    }
    if (elsePart) {
      const elseGoto = /^goto\s+:?(\w+)$/i.exec(elsePart);
      if (elseGoto) pc = labelJump(elseGoto[1]);
    }
  }

  for (; pc < lines.length && !stopped; pc += 1) {
    const original = lines[pc];
    const line = original.trim();

    if (line === '' || /^@?rem\b/i.test(line) || line.startsWith('::')) continue;
    if (/^:\w+$/.test(line)) continue; // label: no-op when reached in sequence
    if (/^@?echo\s+off$/i.test(line) || /^@?echo\s+on$/i.test(line)) continue;
    if (/^setlocal/i.test(line) || /^endlocal$/i.test(line) || /^title\s+/i.test(line)) continue;

    if (/^cd\s+\/d\s+"?%~dp0"?$/i.test(line)) {
      calls.push(['cd', '%~dp0']);
      continue;
    }
    if (/^@?echo\.$/i.test(line) || /^@?echo$/i.test(line)) {
      printed.push('');
      continue;
    }
    if (/^@?echo\s/i.test(line)) {
      printed.push(expand(original.replace(/^\s*@?echo\s?/i, '')));
      continue;
    }
    if (/^where\s+node\b/i.test(line)) {
      calls.push(['where', node ? 'node' : 'node (missing)']);
      environment.set('ERRORLEVEL', node ? '0' : '1');
      continue;
    }
    if (/^where\s+npm\b/i.test(line)) {
      calls.push(['where', npm ? 'npm' : 'npm (missing)']);
      environment.set('ERRORLEVEL', npm ? '0' : '1');
      continue;
    }
    if (/^set\s+\/p\s+/i.test(line)) {
      const match = /^set\s+\/p\s+"([^=]+)=(.*)"$/i.exec(line);
      if (!match) throw new Error(`Unsupported set /p syntax: ${line}`);
      environment.set(match[1].toUpperCase(), prompt(expand(match[2])));
      environment.set('ERRORLEVEL', '0');
      continue;
    }
    if (/^set\s+/i.test(line)) {
      const assignment = /^"([^=]+)=(.*)"$/.exec(line.slice(4).trim()) ?? /^([^=]+)=(.*)$/.exec(line.slice(4).trim());
      if (!assignment) throw new Error(`Unsupported set syntax: ${line}`);
      environment.set(assignment[1].trim().toUpperCase(), expand(assignment[2]));
      continue;
    }
    if (/^start\s+""\s+"https:\/\/nodejs\.org\/en\/download"$/i.test(line)) {
      calls.push(['open-node-download']);
      continue;
    }
    if (/^node\s+"?scripts[/\\]launch-setup\.mjs"?(\s+%\*)?$/i.test(line)) {
      calls.push(['launch-setup', line.includes('%*') ? 'args-passed-through' : 'no-args']);
      environment.set('EXITCODE', String(launcherExit));
      environment.set('ERRORLEVEL', String(launcherExit));
      continue;
    }
    const gotoLine = /^goto\s+:?(\w+)$/i.exec(line);
    if (gotoLine) {
      pc = labelJump(gotoLine[1]);
      continue;
    }
    if (/^if\s+/i.test(line)) {
      runIf(line);
      continue;
    }
    if (/^pause$/i.test(line)) {
      // pause waits for a key and then continues; only exit /b ends the script.
      calls.push(['pause']);
      continue;
    }
    const exitLine = /^exit\s+\/b\s*(.*)$/i.exec(line);
    if (exitLine) {
      if (exitLine[1].trim() !== '') {
        const code = Number(expand(exitLine[1]).trim());
        if (Number.isNaN(code)) throw new Error(`exit /b with non-numeric code: ${exitLine[1]}`);
        environment.set('EXITCODE', String(code));
        environment.set('ERRORLEVEL', String(code));
      }
      stopped = true;
      continue;
    }

    throw new Error(`Unsupported batch construct at line ${pc + 1}: ${original}`);
  }

  const output = printed.join('\n');
  return {
    exitCode: currentCode(),
    launched: calls.some((call) => call[0] === 'launch-setup'),
    passedArguments: calls.some((call) => call[0] === 'launch-setup' && call[1] === 'args-passed-through'),
    openedDownloadPage: calls.some((call) => call[0] === 'open-node-download'),
    askedForDownloadPage: /Open https:\/\/nodejs\.org\/en\/download now\?/.test(output),
    mentionsDownloadUrl: output.includes('https://nodejs.org/en/download'),
    printedPause: calls.some((call) => call[0] === 'pause'),
    output,
  };
}

// Allow `node scripts/bat-harness.mjs start.bat [flags]` for manual checks.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = process.argv.slice(3);
  const options = { batchPath: process.argv[2] ?? 'start.bat' };
  for (const flag of flags) {
    if (flag === '--no-node') options.node = false;
    else if (flag === '--no-npm') options.npm = false;
    else if (flag === '--no-repo') options.repo = false;
    else if (flag.startsWith('--input=')) (options.userInputs ??= []).push(flag.slice(8));
    else if (flag.startsWith('--exit=')) options.launcherExit = Number(flag.slice(7));
    else throw new Error(`Unknown harness flag: ${flag}`);
  }
  console.log(JSON.stringify(runBatch(options), null, 2));
}
